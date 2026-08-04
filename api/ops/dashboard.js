/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * GET /api/ops/dashboard?period=month|quarter|year|rolling12
 *
 * Sales activity dashboard data for the /ops section. Gated by requireOps
 * (OPS_ALLOWED_EMAILS). Reads the Zoho CRM with a READ-scoped refresh token and
 * returns one aggregated JSON payload — the browser does no CRM calls.
 *
 * Query strategy — deliberately simple:
 *   This org's COQL endpoint reliably parses only up to two WHERE conditions
 *   (three+ conditions, OR-groups, and `IN (...)` all error), and COQL
 *   aggregates (GROUP BY / SUM / COUNT) are rejected. So every query here uses
 *   ≤2 conditions and we aggregate in JS. Volumes are tiny (the whole Deals
 *   module is well under a hundred rows) and this is a manual-refresh tool, so
 *   the extra rows are cheap. Deals are pulled in full and classified against
 *   the live Stage picklist (open / won / lost by forecast category).
 *
 * Required env vars:
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET   (shared with the lead-create flow)
 *   ZOHO_REPORTING_REFRESH_TOKEN         READ-scoped refresh token (separate
 *                                        from the create-only ZOHO_REFRESH_TOKEN)
 *   OPS_ALLOWED_EMAILS                   auth allow-list (see _auth.js)
 * Optional dev seed:
 *   ZOHO_REPORTING_ACCESS_TOKEN          skip the token endpoint in dev
 * ─────────────────────────────────────────────────────────────────────────── */

import { requireOps } from '../_auth.js';

const ZOHO_API   = 'https://www.zohoapis.com/crm/v2';
const ZOHO_OAUTH = 'https://accounts.zoho.com/oauth/v2/token';
const PAGE_SIZE  = 200;      // Zoho COQL hard cap per call
const MAX_PAGES  = 25;       // safety cap → 5000 rows per dataset

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Fallback stage classification if the live picklist metadata can't be read.
const FALLBACK_WON  = ['Closed Won'];
const FALLBACK_LOST = ['Closed Lost', 'Closed-Lost to Competition'];

// ── Zoho access token (reporting / read scope) ──────────────────────────────
// Cached for the function-instance lifetime; refreshed 5 min early.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (process.env.ZOHO_REPORTING_ACCESS_TOKEN && process.env.NODE_ENV !== 'production') {
    return process.env.ZOHO_REPORTING_ACCESS_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const tokenRes = await fetch(ZOHO_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      // Prefer a dedicated read-only reporting client; fall back to the shared one.
      client_id:     process.env.ZOHO_REPORTING_CLIENT_ID     || process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_REPORTING_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REPORTING_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('Zoho reporting token error:', tokenData);
    throw new Error('Could not obtain Zoho access token');
  }

  cachedToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

// ── COQL helpers ────────────────────────────────────────────────────────────

/** Run a single COQL query and return { data, more }. */
async function coql(selectQuery, token) {
  const res = await fetch(`${ZOHO_API}/coql`, {
    method: 'POST',
    headers: {
      Authorization:  `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ select_query: selectQuery }),
  });

  if (res.status === 204) return { data: [], more: false };
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || `COQL HTTP ${res.status}`);
  return { data: json.data ?? [], more: Boolean(json.info?.more_records) };
}

/**
 * Run a COQL query paginated to completion (up to MAX_PAGES).
 * `baseQuery` must NOT include a LIMIT clause — we append `limit offset, size`.
 * Returns { rows, capped }.
 */
async function coqlAll(baseQuery, token) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, more } = await coql(`${baseQuery} limit ${page * PAGE_SIZE}, ${PAGE_SIZE}`, token);
    rows.push(...data);
    if (!more) return { rows, capped: false };
  }
  return { rows, capped: true };
}

// ── Time-window maths (calendar periods in America/Toronto) ─────────────────

function tzParts(instant) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t) => p.find((x) => x.type === t).value;
  return { y: +get('year'), m: +get('month'), d: +get('day') };
}

function tzOffset(instant) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto', timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const v = p.find((x) => x.type === 'timeZoneName')?.value || 'GMT+00:00';
  return v.replace('GMT', '') || '+00:00';
}

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const midnightISO = (y, m, d, off) => `${y}-${pad(m)}-${pad(d)}T00:00:00${off}`;

/**
 * Format an instant as a Zoho-COQL-safe datetime in America/Toronto:
 * `YYYY-MM-DDTHH:MM:SS±HH:MM`. COQL rejects JS's `.toISOString()` output
 * ("...T00:00:00.000Z") — it wants an offset and no milliseconds.
 */
function zohoDateTime(instant) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant);
  const g = (t) => p.find((x) => x.type === t).value;
  let hh = g('hour');
  if (hh === '24') hh = '00'; // some ICU builds emit 24 for midnight
  return `${g('year')}-${g('month')}-${g('day')}T${hh}:${g('minute')}:${g('second')}${tzOffset(instant)}`;
}

function minusMonths(y, m, n) {
  const idx = y * 12 + (m - 1) - n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/**
 * Build the current + prior comparison windows for a period.
 * Prior window is "period-to-date": same elapsed span into the previous period,
 * so mid-period deltas compare like with like. Each window carries both ms
 * bounds (for datetime fields) and date strings (for date-only fields).
 */
function windows(period) {
  const now = new Date();
  const off = tzOffset(now);
  const { y, m } = tzParts(now);

  let curStart, prevStart;
  if (period === 'rolling12') {
    // Trailing 12 months from the start of the month 11 months back, compared
    // with the 12 months before that.
    const s = minusMonths(y, m, 11);
    curStart  = { y: s.y, m: s.m, d: 1 };
    prevStart = { y: s.y - 1, m: s.m, d: 1 };
  } else if (period === 'year') {
    curStart  = { y, m: 1, d: 1 };
    prevStart = { y: y - 1, m: 1, d: 1 };
  } else if (period === 'quarter') {
    const qm = m - ((m - 1) % 3);
    curStart  = { y, m: qm, d: 1 };
    const pq  = minusMonths(y, qm, 3);
    prevStart = { y: pq.y, m: pq.m, d: 1 };
  } else { // month (default)
    curStart  = { y, m, d: 1 };
    const pm  = minusMonths(y, m, 1);
    prevStart = { y: pm.y, m: pm.m, d: 1 };
  }

  const curStartMs  = Date.parse(midnightISO(curStart.y, curStart.m, curStart.d, off));
  const prevStartMs = Date.parse(midnightISO(prevStart.y, prevStart.m, prevStart.d, off));
  const nowMs       = now.getTime();
  const elapsed     = nowMs - curStartMs;
  const prevEndMs   = prevStartMs + elapsed;

  const nowD     = tzParts(now);
  const prevEndD = tzParts(new Date(prevEndMs));

  return {
    off,
    cur: {
      startMs: curStartMs, endMs: nowMs,
      fromISO: midnightISO(curStart.y, curStart.m, curStart.d, off), toISO: zohoDateTime(now),
      fromDate: dateStr(curStart.y, curStart.m, curStart.d), toDate: dateStr(nowD.y, nowD.m, nowD.d),
    },
    prev: {
      startMs: prevStartMs, endMs: prevEndMs,
      fromISO: midnightISO(prevStart.y, prevStart.m, prevStart.d, off), toISO: zohoDateTime(new Date(prevEndMs)),
      fromDate: dateStr(prevStart.y, prevStart.m, prevStart.d), toDate: dateStr(prevEndD.y, prevEndD.m, prevEndD.d),
    },
  };
}

/**
 * Month buckets for the trend charts, aligned to the SELECTED period so the
 * date filter actually drives them:
 *   quarter    → the current quarter's months, up to this month
 *   year       → January through this month (year to date)
 *   rolling12  → the trailing 12 months
 *   month      → this month plus 5 trailing, since one bar is not a trend
 * Returns the buckets plus the ISO span [firstMonthStart, now] for querying.
 */
function trendBuckets(period) {
  const now = new Date();
  const off = tzOffset(now);
  const { y, m } = tzParts(now);

  let list = [];
  let spanLabel;
  if (period === 'year') {
    for (let mm = 1; mm <= m; mm++) list.push({ y, m: mm });
    spanLabel = `${y} year to date`;
  } else if (period === 'quarter') {
    const qStart = m - ((m - 1) % 3);
    for (let mm = qStart; mm <= m; mm++) list.push({ y, m: mm });
    spanLabel = `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  } else if (period === 'rolling12') {
    for (let i = 11; i >= 0; i--) list.push(minusMonths(y, m, i));
    spanLabel = 'Last 12 months';
  } else {
    for (let i = 5; i >= 0; i--) list.push(minusMonths(y, m, i));
    spanLabel = 'Last 6 months';
  }

  const buckets = list.map((b) => ({ key: `${b.y}-${pad(b.m)}`, label: MONTHS[b.m - 1], year: b.y }));
  const first = list[0];
  return {
    buckets,
    spanLabel,
    startISO: midnightISO(first.y, first.m, 1, off),
    endISO: zohoDateTime(now),
  };
}

// ── Small aggregation helpers ───────────────────────────────────────────────

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const ownerId = (r) => r.Owner?.id ?? 'unknown';

/** % change vs a baseline; null when there's no baseline to compare against. */
function delta(value, prev) {
  if (!prev) return null;
  return (value - prev) / prev;
}

/** Count rows by a key, case-insensitively grouped, keeping a display label. */
function tallyBy(rows, keyFn) {
  const map = new Map(); // lowerKey → { label, count }
  for (const r of rows) {
    const raw = (keyFn(r) || 'Unspecified').trim();
    const k = raw.toLowerCase();
    const cur = map.get(k) ?? { label: raw, count: 0 };
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ── Deal stage classification (from the live Stage picklist) ────────────────

/**
 * Read the Deals Stage picklist and split option names into won / lost sets by
 * forecast category (Closed → won, Omitted → lost, everything else → open).
 * Falls back to the known stage names if the metadata call fails.
 */
async function stageSets(token) {
  try {
    const res = await fetch(`${ZOHO_API}/settings/fields?module=Deals`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const json = await res.json();
    const stage = (json.fields ?? []).find((f) => f.api_name === 'Stage');
    const opts = stage?.pick_list_values ?? [];
    if (!opts.length) throw new Error('no stage options');

    const won = new Set(), lost = new Set();
    for (const o of opts) {
      const cat = (o.forecast_category?.name ?? '').toLowerCase();
      if (cat === 'closed') won.add(o.display_value);
      else if (cat === 'omitted') lost.add(o.display_value);
    }
    if (!won.size && !lost.size) throw new Error('no closed categories');
    return { won, lost };
  } catch (e) {
    return { won: new Set(FALLBACK_WON), lost: new Set(FALLBACK_LOST) };
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth gate — must be in OPS_ALLOWED_EMAILS
  const user = await requireOps(req, res);
  if (!user) return; // 401 already sent

  if (!process.env.ZOHO_REPORTING_REFRESH_TOKEN && !process.env.ZOHO_REPORTING_ACCESS_TOKEN) {
    return res.status(503).json({
      error: 'Zoho reporting token not configured. Set ZOHO_REPORTING_REFRESH_TOKEN (read scope).',
    });
  }

  const period = ['month', 'quarter', 'year', 'rolling12'].includes(req.query.period) ? req.query.period : 'month';
  const w = windows(period);
  const tb = trendBuckets(period);
  const notes = [];
  let capped = false;

  try {
    const token = await getAccessToken();

    // Owner id → display name. AllUsers so historical/deactivated owners resolve too.
    const userMap = new Map();
    try {
      const uRes = await fetch(`${ZOHO_API}/users?type=AllUsers&per_page=200`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      const uJson = await uRes.json();
      for (const u of uJson.users ?? []) {
        userMap.set(u.id, u.full_name || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim());
      }
    } catch (e) {
      notes.push('User names unavailable — showing IDs');
    }
    const nameFor = (id) => userMap.get(id) || 'Unknown';

    const pull = async (q) => {
      const { rows, capped: c } = await coqlAll(q, token);
      if (c) capped = true;
      return rows;
    };

    // ── Fetch datasets (each query ≤2 WHERE conditions) ─────────────────────
    const [
      stages,
      allDeals,
      leadsCur, leadsPrev,
      leadTrendRows,
      callsCur, callsPrev,
      eventsCur, eventsPrev,
      tasksCur, tasksPrev,
    ] = await Promise.all([
      stageSets(token),
      // Entire Deals module — classified in JS (open/won/lost, per window, trend)
      pull('select Deal_Name, Stage, Amount, Closing_Date, Owner, Created_Time from Deals where id is not null'),
      // Leads created per window
      pull(`select Created_Time, Lead_Source, Lead_Status, Owner from Leads where Created_Time >= '${w.cur.fromISO}' and Created_Time <= '${w.cur.toISO}'`),
      pull(`select id from Leads where Created_Time >= '${w.prev.fromISO}' and Created_Time <= '${w.prev.toISO}'`),
      // Leads across the trailing trend window (month-over-month buckets)
      pull(`select Created_Time, Lead_Status from Leads where Created_Time >= '${tb.startISO}' and Created_Time <= '${tb.endISO}'`),
      // Calls per window
      pull(`select Owner from Calls where Call_Start_Time >= '${w.cur.fromISO}' and Call_Start_Time <= '${w.cur.toISO}'`),
      pull(`select id from Calls where Call_Start_Time >= '${w.prev.fromISO}' and Call_Start_Time <= '${w.prev.toISO}'`),
      // Events / meetings per window (by start time)
      pull(`select Owner from Events where Start_DateTime >= '${w.cur.fromISO}' and Start_DateTime <= '${w.cur.toISO}'`),
      pull(`select id from Events where Start_DateTime >= '${w.prev.fromISO}' and Start_DateTime <= '${w.prev.toISO}'`),
      // Tasks per window — Status filtered in JS (3-condition queries error here)
      pull(`select Status, Owner from Tasks where Created_Time >= '${w.cur.fromISO}' and Created_Time <= '${w.cur.toISO}'`),
      pull(`select Status from Tasks where Created_Time >= '${w.prev.fromISO}' and Created_Time <= '${w.prev.toISO}'`),
    ]);

    const isWon  = (d) => stages.won.has(d.Stage);
    const isLost = (d) => stages.lost.has(d.Stage);
    const isOpen = (d) => !isWon(d) && !isLost(d);
    const isCompleted = (t) => (t.Status ?? '').toLowerCase() === 'completed';

    // Won/lost attributed to a window by Closing_Date (date-string compare).
    const closedInWin = (d, win) => d.Closing_Date && d.Closing_Date >= win.fromDate && d.Closing_Date <= win.toDate;
    // New deals attributed by Created_Time (datetime compare).
    const createdInWin = (d, win) => {
      const t = Date.parse(d.Created_Time);
      return t >= win.startMs && t <= win.endMs;
    };

    // ── Deals: revenue won + win rate (cur & prev) ──────────────────────────
    const wonCur  = allDeals.filter((d) => isWon(d)  && closedInWin(d, w.cur));
    const lostCur = allDeals.filter((d) => isLost(d) && closedInWin(d, w.cur));
    const wonPrev = allDeals.filter((d) => isWon(d)  && closedInWin(d, w.prev));
    const lostPrev= allDeals.filter((d) => isLost(d) && closedInWin(d, w.prev));

    const revenueWon     = wonCur.reduce((s, d) => s + num(d.Amount), 0);
    const revenueWonPrev = wonPrev.reduce((s, d) => s + num(d.Amount), 0);
    const winRate     = (wonCur.length + lostCur.length)   ? wonCur.length  / (wonCur.length + lostCur.length)   : null;
    const winRatePrev = (wonPrev.length + lostPrev.length) ? wonPrev.length / (wonPrev.length + lostPrev.length) : null;

    // ── Deals: new-created counts (cur & prev) ──────────────────────────────
    const newDealsCur  = allDeals.filter((d) => createdInWin(d, w.cur)).length;
    const newDealsPrev = allDeals.filter((d) => createdInWin(d, w.prev)).length;

    // ── Deals: open pipeline snapshot ───────────────────────────────────────
    const openDeals = allDeals.filter(isOpen);
    const openPipeline = openDeals.reduce((s, d) => s + num(d.Amount), 0);

    const stageMap = new Map();
    for (const d of openDeals) {
      const st = d.Stage || 'Unspecified';
      const cur = stageMap.get(st) ?? { stage: st, count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += num(d.Amount);
      stageMap.set(st, cur);
    }
    const pipelineByStage = [...stageMap.values()].sort((a, b) => b.amount - a.amount);

    // ── Activities ──────────────────────────────────────────────────────────
    const tasksCurDone  = tasksCur.filter(isCompleted);
    const tasksPrevDone = tasksPrev.filter(isCompleted).length;
    const activities     = callsCur.length + eventsCur.length + tasksCurDone.length;
    const activitiesPrev = callsPrev.length + eventsPrev.length + tasksPrevDone;

    // ── Leaderboard (per rep) ───────────────────────────────────────────────
    const board = new Map();
    const seed = (id) => {
      if (!board.has(id)) board.set(id, { ownerId: id, name: nameFor(id), revenueWon: 0, dealsWon: 0, openPipeline: 0, activities: 0 });
      return board.get(id);
    };
    for (const d of wonCur)    { const b = seed(ownerId(d)); b.revenueWon += num(d.Amount); b.dealsWon += 1; }
    for (const d of openDeals) { seed(ownerId(d)).openPipeline += num(d.Amount); }
    for (const r of callsCur)      seed(ownerId(r)).activities += 1;
    for (const r of eventsCur)     seed(ownerId(r)).activities += 1;
    for (const r of tasksCurDone)  seed(ownerId(r)).activities += 1;
    const leaderboard = [...board.values()]
      .filter((b) => b.revenueWon || b.openPipeline || b.activities)
      .sort((a, b) => b.revenueWon - a.revenueWon || b.openPipeline - a.openPipeline);

    // ── Closing soon (open deals closing today or later, nearest first) ─────
    // Excludes stale past-dated deals (e.g. old renewals never marked closed),
    // which would otherwise dominate an ascending sort.
    const today = w.cur.toDate;
    const closingSoon = openDeals
      .filter((d) => d.Closing_Date && d.Closing_Date >= today)
      .sort((a, b) => a.Closing_Date.localeCompare(b.Closing_Date))
      .slice(0, 8)
      .map((d) => ({
        name: d.Deal_Name,
        stage: d.Stage,
        amount: num(d.Amount),
        closingDate: d.Closing_Date,
        owner: nameFor(ownerId(d)),
      }));

    // ── Month-over-month trends (leads by status · deals by stage) ──────────
    const monthIdx = new Map(tb.buckets.map((b, i) => [b.key, i]));
    const monthKeyOf = (iso) => { const p = tzParts(new Date(iso)); return `${p.y}-${pad(p.m)}`; };
    const blank = () => new Array(tb.buckets.length).fill(0);

    function buildTrend(rows, catFn, timeFn) {
      const series = {};
      const total = blank();
      for (const r of rows) {
        const idx = monthIdx.get(monthKeyOf(timeFn(r)));
        if (idx == null) continue;
        const cat = (catFn(r) || 'Unspecified').trim();
        (series[cat] ??= blank())[idx] += 1;
        total[idx] += 1;
      }
      const categories = Object.keys(series)
        .sort((a, b) => series[b].reduce((s, n) => s + n, 0) - series[a].reduce((s, n) => s + n, 0));
      return { categories, series, total };
    }

    const trend = {
      months: tb.buckets.map((b) => ({ key: b.key, label: b.label, year: b.year })),
      spanLabel: tb.spanLabel,
      leads: buildTrend(leadTrendRows, (r) => r.Lead_Status, (r) => r.Created_Time),
      deals: buildTrend(allDeals, (d) => d.Stage, (d) => d.Created_Time),
    };

    if (capped) notes.push(`A dataset exceeded ${MAX_PAGES * PAGE_SIZE} rows and was truncated`);

    return res.status(200).json({
      period,
      generatedAt: new Date().toISOString(),
      currency: 'USD',
      window: { from: w.cur.fromISO, to: w.cur.toISO },
      kpis: {
        newLeads:     { value: leadsCur.length, prev: leadsPrev.length, delta: delta(leadsCur.length, leadsPrev.length) },
        newDeals:     { value: newDealsCur,     prev: newDealsPrev,     delta: delta(newDealsCur, newDealsPrev) },
        revenueWon:   { value: revenueWon,      prev: revenueWonPrev,   delta: delta(revenueWon, revenueWonPrev) },
        winRate:      { value: winRate,         prev: winRatePrev,      delta: (winRate != null && winRatePrev) ? winRate - winRatePrev : null },
        openPipeline: { value: openPipeline },
        activities:   { value: activities,      prev: activitiesPrev,   delta: delta(activities, activitiesPrev) },
      },
      pipelineByStage,
      leadsBySource: tallyBy(leadsCur, (r) => r.Lead_Source).map((x) => ({ source: x.label, count: x.count })),
      leadsByStatus: tallyBy(leadsCur, (r) => r.Lead_Status).map((x) => ({ status: x.label, count: x.count })),
      activityBreakdown: { calls: callsCur.length, meetings: eventsCur.length, tasks: tasksCurDone.length },
      leaderboard,
      closingSoon,
      trend,
      meta: { capped, notes },
    });
  } catch (err) {
    console.error('ops/dashboard error:', err.message);
    // Endpoint is auth-gated to the ops allow-list, so it's safe to surface the
    // underlying Zoho error to the (authorised) caller for diagnosis.
    return res.status(502).json({ error: 'Could not load CRM data.', detail: err.message });
  }
}
