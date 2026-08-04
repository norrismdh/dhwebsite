/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * GET /api/ops/desk?period=month|quarter|year
 *
 * Support metrics for the /ops Support tab, read from Zoho Desk. Gated by
 * requireOps (OPS_ALLOWED_EMAILS). Returns one aggregated JSON payload.
 *
 * Strategy: Desk's list endpoints have no reliable created-date range filter, so
 * we page /tickets sorted by -createdTime and stop once rows fall outside the
 * trailing trend window; open tickets are swept separately. Everything is
 * aggregated in JS. Each sub-fetch (agents, articles) is guarded so one failing
 * section degrades instead of sinking the whole page.
 *
 * Required env vars:
 *   ZOHO_DESK_REFRESH_TOKEN   Desk-scoped refresh token
 *                             (Desk.tickets.READ, Desk.basic.READ,
 *                              Desk.search.READ, Desk.articles.READ)
 *   ZOHO_DESK_ORG_ID          Desk organization id (orgId header)
 * OAuth client (first match wins):
 *   ZOHO_DESK_CLIENT_ID/SECRET → ZOHO_REPORTING_CLIENT_ID/SECRET → ZOHO_CLIENT_ID/SECRET
 * Optional dev seed:
 *   ZOHO_DESK_ACCESS_TOKEN
 * ─────────────────────────────────────────────────────────────────────────── */

import { requireOps } from '../_auth.js';

const DESK_API   = 'https://desk.zoho.com/api/v1';
const ZOHO_OAUTH = 'https://accounts.zoho.com/oauth/v2/token';
const PAGE_SIZE  = 99;    // Desk caps `limit` at 99 for /tickets and /agents
const KB_PAGE    = 50;    // …but /articles caps at 50
const MAX_PAGES  = 30;    // safety cap → ~3000 tickets per sweep
const FR_MAX     = 40;    // max tickets probed for first-response (1 API call each)

// How many trailing calendar months the MoM trend spans, per period.
const TREND_MONTHS = { month: 6, quarter: 12, year: 12 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Desk access token ───────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (process.env.ZOHO_DESK_ACCESS_TOKEN && process.env.NODE_ENV !== 'production') {
    return process.env.ZOHO_DESK_ACCESS_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const res = await fetch(ZOHO_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.ZOHO_DESK_CLIENT_ID     || process.env.ZOHO_REPORTING_CLIENT_ID     || process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_DESK_CLIENT_SECRET || process.env.ZOHO_REPORTING_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_DESK_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    console.error('Zoho Desk token error:', data);
    throw new Error(`Could not obtain Zoho Desk access token${data.error ? ` (${data.error})` : ''}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

// ── Desk REST helpers ───────────────────────────────────────────────────────

async function deskGet(path, token) {
  const res = await fetch(`${DESK_API}${path}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId: process.env.ZOHO_DESK_ORG_ID,
    },
  });

  if (res.status === 204) return {};
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }

  if (!res.ok) {
    throw new Error(json?.message || json?.errorCode || `Desk HTTP ${res.status}`);
  }
  return json;
}

/**
 * Page a Desk list endpoint. `stop(row)` may return true to end paging early
 * (used with sortBy=-createdTime to stop once rows predate the window).
 * `pathFor(from, size)` builds the path for a given 1-based offset + page size.
 * Page size differs per endpoint (tickets/agents 99, articles 50).
 */
async function deskPage(pathFor, token, { stop, pageSize = PAGE_SIZE } = {}) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await deskGet(pathFor(page * pageSize + 1, pageSize), token);
    const batch = json.data ?? [];
    if (!batch.length) return { rows, capped: false };

    for (const row of batch) {
      if (stop && stop(row)) return { rows, capped: false };
      rows.push(row);
    }
    if (batch.length < pageSize) return { rows, capped: false };
  }
  return { rows, capped: true };
}

// ── Time windows (calendar periods, America/Toronto) ────────────────────────

function tzParts(instant) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const g = (t) => p.find((x) => x.type === t).value;
  return { y: +g('year'), m: +g('month'), d: +g('day') };
}

function minusMonths(y, m, n) {
  const idx = y * 12 + (m - 1) - n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Current + prior period-to-date windows, as epoch-ms bounds. */
function windows(period) {
  const now = new Date();
  const { y, m } = tzParts(now);

  let cur, prev;
  if (period === 'year') {
    cur = { y, m: 1 }; prev = { y: y - 1, m: 1 };
  } else if (period === 'quarter') {
    const qm = m - ((m - 1) % 3);
    cur = { y, m: qm }; prev = minusMonths(y, qm, 3);
  } else {
    cur = { y, m }; prev = minusMonths(y, m, 1);
  }

  const startOf = (p) => new Date(`${p.y}-${String(p.m).padStart(2, '0')}-01T00:00:00`).getTime();
  const curStart = startOf(cur);
  const nowMs = now.getTime();
  const prevStart = startOf(prev);

  return {
    cur:  { startMs: curStart,  endMs: nowMs },
    prev: { startMs: prevStart, endMs: prevStart + (nowMs - curStart) },
  };
}

/** Trailing `n` month buckets (oldest → current) + the window start in ms. */
function trendBuckets(n) {
  const now = new Date();
  const { y, m } = tzParts(now);
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    const b = minusMonths(y, m, i);
    buckets.push({ key: `${b.y}-${String(b.m).padStart(2, '0')}`, label: MONTHS[b.m - 1], year: b.y });
  }
  const first = minusMonths(y, m, n - 1);
  return {
    buckets,
    startMs: new Date(`${first.y}-${String(first.m).padStart(2, '0')}-01T00:00:00`).getTime(),
  };
}

// ── Aggregation helpers ─────────────────────────────────────────────────────

const ms = (v) => { const t = Date.parse(v ?? ''); return Number.isNaN(t) ? null : t; };
const inWin = (t, w) => t != null && t >= w.startMs && t <= w.endMs;

function delta(value, prev) {
  if (!prev) return null;
  return (value - prev) / prev;
}

function tallyBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const raw = String(keyFn(r) ?? '').trim() || 'Unspecified';
    const k = raw.toLowerCase();
    const cur = map.get(k) ?? { label: raw, count: 0 };
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

const avg = (nums) => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null);

/** Desk marks resolution differently across setups — try the usual suspects. */
function resolvedAt(t) {
  return ms(t.closedTime) ?? ms(t.resolvedTime) ?? ms(t.customFields?.resolvedTime);
}

/** A ticket counts as "open" unless its status is a closed-ish one. */
function isOpen(t) {
  const s = String(t.status ?? '').toLowerCase();
  return !(s === 'closed' || s === 'resolved' || s === 'merged' || s === 'spam');
}

/** First-response time in ms straight off the ticket, when the plan exposes it. */
function firstResponseMsFromTicket(t) {
  const created = ms(t.createdTime);
  const fr = ms(t.firstResponseTime) ?? ms(t.customFields?.firstResponseTime);
  if (created == null || fr == null) return null;
  const d = fr - created;
  return d >= 0 ? d : null;
}

/**
 * First-response time via the ticket's threads: the first outbound (agent)
 * thread after creation. Desk's ticket list doesn't expose first-response time
 * on all plans, so this is the fallback — one extra API call per ticket, which
 * is fine at this org's volumes and is capped by FR_MAX.
 */
async function firstResponseMsFromThreads(ticket, token) {
  const created = ms(ticket.createdTime);
  if (created == null) return null;

  const json = await deskGet(`/tickets/${ticket.id}/threads?limit=50`, token);
  const threads = json.data ?? [];

  const replies = threads
    .filter((th) => String(th.direction ?? '').toLowerCase() === 'out')
    .map((th) => ms(th.createdTime))
    .filter((t) => t != null && t >= created);

  if (!replies.length) return null;
  return Math.min(...replies) - created;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireOps(req, res);
  if (!user) return; // 401 already sent

  const hasToken = process.env.ZOHO_DESK_REFRESH_TOKEN || process.env.ZOHO_DESK_ACCESS_TOKEN;
  if (!hasToken || !process.env.ZOHO_DESK_ORG_ID) {
    return res.status(503).json({
      error: 'Zoho Desk is not configured. Set ZOHO_DESK_REFRESH_TOKEN and ZOHO_DESK_ORG_ID.',
    });
  }

  const period = ['month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const w = windows(period);
  const tb = trendBuckets(TREND_MONTHS[period] ?? 6);
  const notes = [];

  try {
    const token = await getAccessToken();

    // ── Created-tickets sweep: newest first, stop once older than the trend window
    const created = await deskPage(
      (from, size) => `/tickets?from=${from}&limit=${size}&sortBy=-createdTime`,
      token,
      { stop: (t) => { const c = ms(t.createdTime); return c != null && c < tb.startMs; } },
    );
    if (created.capped) notes.push(`Ticket history truncated at ${MAX_PAGES * PAGE_SIZE} rows`);
    const tickets = created.rows;

    // ── Open-tickets sweep (backlog can predate the trend window)
    let openTickets = [];
    try {
      const open = await deskPage(
        (from, size) => `/tickets?from=${from}&limit=${size}&status=Open&sortBy=-createdTime`,
        token,
      );
      openTickets = open.rows;
    } catch (e) {
      // Status filter naming varies by setup — fall back to filtering the sweep
      notes.push('Open-ticket filter unavailable; backlog derived from recent tickets');
      openTickets = tickets.filter(isOpen);
    }

    // ── Agents (for analyst names)
    const agentName = new Map();
    let activeAgents = 0;
    try {
      const a = await deskGet(`/agents?from=1&limit=${PAGE_SIZE}`, token);
      for (const ag of a.data ?? []) {
        const name = [ag.firstName, ag.lastName].filter(Boolean).join(' ').trim() || ag.emailId || ag.id;
        agentName.set(String(ag.id), name);
        if (String(ag.status ?? '').toLowerCase() !== 'disabled') activeAgents += 1;
      }
    } catch (e) {
      notes.push('Agent names unavailable');
    }
    const nameFor = (id) => agentName.get(String(id)) || (id ? 'Unassigned/Unknown' : 'Unassigned');

    // ── Period slices
    const newCur  = tickets.filter((t) => inWin(ms(t.createdTime), w.cur));
    const newPrev = tickets.filter((t) => inWin(ms(t.createdTime), w.prev));
    const resolvedCur  = tickets.filter((t) => inWin(resolvedAt(t), w.cur));
    const resolvedPrev = tickets.filter((t) => inWin(resolvedAt(t), w.prev));

    const nowMs = Date.now();
    const overdue = openTickets.filter((t) => { const d = ms(t.dueDate); return d != null && d < nowMs; });

    // Durations (hours)
    const resHours = resolvedCur
      .map((t) => { const c = ms(t.createdTime), r = resolvedAt(t); return (c != null && r != null && r >= c) ? (r - c) / 36e5 : null; })
      .filter((n) => n != null);
    const resHoursPrev = resolvedPrev
      .map((t) => { const c = ms(t.createdTime), r = resolvedAt(t); return (c != null && r != null && r >= c) ? (r - c) / 36e5 : null; })
      .filter((n) => n != null);

    // First response: prefer the ticket field; otherwise derive from threads
    // (one call per ticket, capped — Desk doesn't expose it on all plans).
    let frHours = newCur.map(firstResponseMsFromTicket).filter((n) => n != null).map((n) => n / 36e5);
    if (!frHours.length && newCur.length) {
      const probe = newCur.slice(0, FR_MAX);
      try {
        // Small batches rather than one big burst — keeps us clear of Desk rate limits.
        const derived = [];
        for (let i = 0; i < probe.length; i += 5) {
          const batch = await Promise.all(probe.slice(i, i + 5).map(async (t) => {
            try { return await firstResponseMsFromThreads(t, token); } catch { return null; }
          }));
          derived.push(...batch);
        }
        frHours = derived.filter((n) => n != null).map((n) => n / 36e5);
        if (newCur.length > FR_MAX) {
          notes.push(`First response sampled from the ${FR_MAX} most recent tickets`);
        }
        if (!frHours.length) notes.push('No agent replies found to measure first response');
      } catch (e) {
        notes.push(`First-response time unavailable (${e.message})`);
      }
    }

    // ── MoM trend (by status)
    const monthIdx = new Map(tb.buckets.map((b, i) => [b.key, i]));
    const blank = () => new Array(tb.buckets.length).fill(0);
    const keyOf = (t) => { const p = tzParts(new Date(t)); return `${p.y}-${String(p.m).padStart(2, '0')}`; };

    const series = {}, total = blank();
    for (const t of tickets) {
      const c = ms(t.createdTime);
      if (c == null) continue;
      const idx = monthIdx.get(keyOf(c));
      if (idx == null) continue;
      const cat = String(t.status ?? 'Unspecified').trim() || 'Unspecified';
      (series[cat] ??= blank())[idx] += 1;
      total[idx] += 1;
    }
    const categories = Object.keys(series)
      .sort((a, b) => series[b].reduce((s, n) => s + n, 0) - series[a].reduce((s, n) => s + n, 0));

    // ── Analyst leaderboard
    const board = new Map();
    const seed = (id) => {
      const k = String(id ?? 'unassigned');
      if (!board.has(k)) board.set(k, { agentId: k, name: nameFor(id), taken: 0, resolved: 0, open: 0, avgResolutionHours: null, _res: [] });
      return board.get(k);
    };
    for (const t of newCur) seed(t.assigneeId).taken += 1;
    for (const t of resolvedCur) {
      const b = seed(t.assigneeId);
      b.resolved += 1;
      const c = ms(t.createdTime), r = resolvedAt(t);
      if (c != null && r != null && r >= c) b._res.push((r - c) / 36e5);
    }
    for (const t of openTickets) seed(t.assigneeId).open += 1;
    const leaderboard = [...board.values()]
      .map((b) => { b.avgResolutionHours = avg(b._res); delete b._res; return b; })
      .filter((b) => b.taken || b.resolved || b.open)
      .sort((a, b) => b.taken - a.taken || b.resolved - a.resolved);

    const analystCount = activeAgents || leaderboard.length;

    // ── Knowledge base (guarded — a KB failure must not sink tickets metrics)
    let kb = null;
    try {
      const arts = await deskPage(
        (from, size) => `/articles?from=${from}&limit=${size}&sortBy=-createdTime`,
        token,
        { pageSize: KB_PAGE },   // /articles caps limit at 50
      );
      const isPub = (a) => String(a.status ?? '').toLowerCase() === 'published';
      const pubAt = (a) => ms(a.publishedTime) ?? ms(a.modifiedTime) ?? ms(a.createdTime);

      // Author attribution — Desk exposes this under different keys by setup.
      const authorOf = (a) => {
        const id = a.author?.id ?? a.authorId ?? a.createdBy?.id ?? a.ownerId;
        const named = a.author?.name
          ?? [a.author?.firstName, a.author?.lastName].filter(Boolean).join(' ').trim()
          ?? null;
        return { id: id != null ? String(id) : null, name: named || (id != null ? nameFor(id) : 'Unknown') };
      };

      // Per-analyst KB counts (all-time authored, plus this period's activity)
      const kbBoard = new Map();
      for (const a of arts.rows) {
        const { id, name } = authorOf(a);
        const key = id ?? name;
        const row = kbBoard.get(key) ?? { name, authored: 0, published: 0, createdInPeriod: 0, publishedInPeriod: 0 };
        row.authored += 1;
        if (isPub(a)) row.published += 1;
        if (inWin(ms(a.createdTime), w.cur)) row.createdInPeriod += 1;
        if (isPub(a) && inWin(pubAt(a), w.cur)) row.publishedInPeriod += 1;
        kbBoard.set(key, row);
      }

      kb = {
        createdInPeriod:   arts.rows.filter((a) => inWin(ms(a.createdTime), w.cur)).length,
        publishedInPeriod: arts.rows.filter((a) => isPub(a) && inWin(pubAt(a), w.cur)).length,
        totalPublished:    arts.rows.filter(isPub).length,
        drafts:            arts.rows.filter((a) => !isPub(a)).length,
        byStatus:          tallyBy(arts.rows, (a) => a.status).map((x) => ({ status: x.label, count: x.count })),
        byAnalyst:         [...kbBoard.values()].sort((a, b) => b.authored - a.authored || b.published - a.published),
      };
    } catch (e) {
      notes.push(`Knowledge base unavailable (${e.message})`);
    }

    return res.status(200).json({
      period,
      generatedAt: new Date().toISOString(),
      kpis: {
        newTickets:   { value: newCur.length,      prev: newPrev.length,      delta: delta(newCur.length, newPrev.length) },
        resolved:     { value: resolvedCur.length, prev: resolvedPrev.length, delta: delta(resolvedCur.length, resolvedPrev.length) },
        openBacklog:  { value: openTickets.length },
        overdue:      { value: overdue.length },
        firstResponseHours: { value: avg(frHours) },
        resolutionHours:    { value: avg(resHours), prev: avg(resHoursPrev), delta: delta(avg(resHours) ?? 0, avg(resHoursPrev) ?? 0) },
      },
      byStatus:   tallyBy(newCur, (t) => t.status).map((x) => ({ status: x.label, count: x.count })),
      byPriority: tallyBy(newCur, (t) => t.priority).map((x) => ({ priority: x.label, count: x.count })),
      byChannel:  tallyBy(newCur, (t) => t.channel).map((x) => ({ channel: x.label, count: x.count })),
      trend: { months: tb.buckets, tickets: { categories, series, total } },
      leaderboard,
      analystSummary: {
        analysts: analystCount,
        avgTicketsPerAnalyst: analystCount ? newCur.length / analystCount : null,
      },
      kb,
      meta: { notes },
    });
  } catch (err) {
    console.error('ops/desk error:', err.message);
    return res.status(502).json({ error: 'Could not load Desk data.', detail: err.message });
  }
}
