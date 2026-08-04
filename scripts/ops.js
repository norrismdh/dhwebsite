/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * Ops dashboard page logic.
 *
 * Flow: initOps() (Azure AD gate) → reveal shell → load /api/ops/dashboard for
 * the selected period → render KPIs, charts and tables. Data reloads ONLY on an
 * explicit Refresh click or a period change — there is no auto-refresh timer.
 *
 * A clearly-labelled demo mode (?demo=1) renders representative sample data
 * without auth or a CRM call, so the design can be reviewed before the Zoho
 * reporting token and Azure /ops redirect URI are provisioned.
 * ─────────────────────────────────────────────────────────────────────────── */

import { initOps, opsFetch } from './dhops.js';
import { comboChart, attachChartTooltip, chartBox, PALETTE, NAVY, ORANGE } from './ops-charts.js';

// Matches the Support tab so the two pages' trend panels are the same object
const CHART_H = 240;

const PERIOD_PREV = { month: 'last month', quarter: 'last quarter', year: 'last year', rolling12: 'previous 12 months' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Last payload rendered — lets the trend filters re-render without a refetch.
let currentData = null;

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtInt     = (n) => (n ?? 0).toLocaleString('en-US');
const fmtMoney   = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n ?? 0);
const fmtMoneyK  = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n ?? 0);
const fmtPct     = (f) => `${((f ?? 0) * 100).toFixed(0)}%`;

function fmtDateStr(d) {
  if (!d) return '-';
  const [y, m, day] = d.split('-').map(Number);
  return `${MONTHS[(m - 1) % 12]} ${day}, ${y}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

/** Build the delta line for a KPI. `mode` = 'pct' (relative) | 'points' (win rate). */
function deltaHtml(delta, period, mode = 'pct') {
  const prevLbl = PERIOD_PREV[period] ?? 'prior period';
  if (delta == null) {
    return `<span class="ops-kpi__delta ops-kpi__delta--flat">— <small>vs ${prevLbl}</small></span>`;
  }
  const up = delta > 0, flat = delta === 0;
  const cls = flat ? 'flat' : up ? 'up' : 'down';
  const arrow = flat ? '' : up ? '▲' : '▼';
  const mag = mode === 'points'
    ? `${Math.abs(delta * 100).toFixed(1)} pts`
    : `${Math.abs(delta * 100).toFixed(1)}%`;
  return `<span class="ops-kpi__delta ops-kpi__delta--${cls}">${arrow} ${mag} <small>vs ${prevLbl}</small></span>`;
}

// ── Renderers ───────────────────────────────────────────────────────────────

function renderKpis(k, period) {
  const cards = [
    { label: 'New leads',      value: fmtInt(k.newLeads.value),        delta: deltaHtml(k.newLeads.delta, period) },
    { label: 'New deals',      value: fmtInt(k.newDeals.value),        delta: deltaHtml(k.newDeals.delta, period) },
    { label: 'Revenue won',    value: fmtMoneyK(k.revenueWon.value),   delta: deltaHtml(k.revenueWon.delta, period) },
    { label: 'Win rate',       value: k.winRate.value == null ? '—' : fmtPct(k.winRate.value), delta: deltaHtml(k.winRate.delta, period, 'points') },
    { label: 'Open pipeline',  value: fmtMoneyK(k.openPipeline.value), delta: `<span class="ops-kpi__delta ops-kpi__delta--flat"><small>current snapshot</small></span>` },
    { label: 'Activities',     value: fmtInt(k.activities.value),      delta: deltaHtml(k.activities.delta, period) },
  ];
  $('ops-kpis').innerHTML = cards.map((c, i) => `
    <div class="admin-stat-card ops-kpi" style="--i:${i}">
      <div class="admin-stat-card__label">${c.label}</div>
      <div class="ops-kpi__value">${c.value}</div>
      ${c.delta}
    </div>`).join('');
}

/** Horizontal bar list. items: [{label, primary, sub, weight}] */
function renderBars(el, items, color) {
  if (!items.length) { el.innerHTML = `<p class="ops-empty">No data for this period</p>`; return; }
  const max = Math.max(...items.map((i) => i.weight), 1);
  el.innerHTML = `<div class="ops-bars">${items.map((i) => `
    <div class="ops-bar">
      <div class="ops-bar__top">
        <span class="ops-bar__label">${esc(i.label)}</span>
        <span class="ops-bar__value">${i.primary}${i.sub ? ` <span class="ops-bar__sub">${i.sub}</span>` : ''}</span>
      </div>
      <div class="ops-bar__track">
        <div class="ops-bar__fill" style="background:${color};transform:scaleX(${(i.weight / max).toFixed(4)})"></div>
      </div>
    </div>`).join('')}</div>`;
}

function renderPipeline(stages) {
  renderBars($('ops-pipeline'),
    stages.map((s) => ({ label: s.stage, primary: fmtMoney(s.amount), sub: `· ${s.count}`, weight: s.amount })),
    NAVY);
}

function renderSources(sources) {
  renderBars($('ops-sources'),
    sources.slice(0, 8).map((s) => ({ label: s.source, primary: fmtInt(s.count), weight: s.count })),
    ORANGE);
}

function renderStatuses(statuses) {
  const el = $('ops-statuses');
  const total = statuses.reduce((s, x) => s + x.count, 0);
  if (!total) { el.innerHTML = `<p class="ops-empty">No leads in this period</p>`; return; }

  const R = 42, C = 2 * Math.PI * R;
  let cum = 0;
  const segs = statuses.map((s, idx) => {
    const frac = s.count / total;
    const len = frac * C;
    const seg = `<circle class="ops-donut__seg" cx="50" cy="50" r="${R}" fill="none"
      stroke="${PALETTE[idx % PALETTE.length]}" stroke-width="12"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-cum).toFixed(2)}" />`;
    cum += len;
    return seg;
  }).join('');

  const legend = statuses.map((s, idx) => `
    <div class="ops-legend__item">
      <span class="ops-legend__dot" style="background:${PALETTE[idx % PALETTE.length]}"></span>
      <span class="ops-legend__label">${esc(s.status)}</span>
      <span class="ops-legend__val">${fmtInt(s.count)}</span>
    </div>`).join('');

  el.innerHTML = `
    <div class="ops-donut-wrap">
      <svg class="ops-donut" viewBox="0 0 100 100" width="150" height="150" role="img" aria-label="Leads by status">
        <g transform="rotate(-90 50 50)">
          <circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--border-2)" stroke-width="12" />
          ${segs}
        </g>
        <text x="50" y="48" text-anchor="middle" class="ops-donut__center-num">${fmtInt(total)}</text>
        <text x="50" y="60" text-anchor="middle" class="ops-donut__center-lbl">leads</text>
      </svg>
      <div class="ops-legend">${legend}</div>
    </div>`;
}

function renderActivity(a) {
  $('ops-activity').innerHTML = `
    <div class="ops-activity">
      <div class="ops-activity__cell"><div class="ops-activity__num">${fmtInt(a.calls)}</div><div class="ops-activity__lbl">Calls</div></div>
      <div class="ops-activity__cell"><div class="ops-activity__num">${fmtInt(a.meetings)}</div><div class="ops-activity__lbl">Meetings</div></div>
      <div class="ops-activity__cell"><div class="ops-activity__num">${fmtInt(a.tasks)}</div><div class="ops-activity__lbl">Tasks done</div></div>
    </div>`;
}

function renderLeaderboard(rows) {
  const tb = $('ops-leaderboard');
  const COLS = 8;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="${COLS}" class="ops-empty">No activity in this period</td></tr>`;
    $('ops-leaders').textContent = '';
    return;
  }

  // Highest value per column, so the leader is visible whatever the sort order.
  // Only counts a leader when someone is actually ahead — an all-zero column, or
  // a tie, would otherwise decorate rows arbitrarily.
  const leaderIn = (key) => {
    const max = Math.max(...rows.map((r) => r[key] ?? 0));
    if (!max) return null;
    const top = rows.filter((r) => (r[key] ?? 0) === max);
    return top.length === 1 ? top[0] : null;
  };

  const leads = {
    revenueWon: leaderIn('revenueWon'), dealsWon: leaderIn('dealsWon'),
    openPipeline: leaderIn('openPipeline'), calls: leaderIn('calls'),
    meetings: leaderIn('meetings'), tasks: leaderIn('tasks'),
    activities: leaderIn('activities'),
  };

  /* Bold plus a visually-hidden "highest" — weight alone is a weak signal and
     colour alone would fail anyone who can't distinguish it. */
  const cell = (r, key, text) => {
    const isLead = leads[key] === r;
    return `<td class="ops-num${isLead ? ' ops-lead' : ''}">${text}${
      isLead ? '<span class="sr-only"> (highest)</span>' : ''}</td>`;
  };

  tb.innerHTML = rows.map((r, i) => `
    <tr class="ops-row-in" style="--i:${i}">
      <td style="font-weight:var(--fw-medium)">${esc(r.name)}</td>
      ${cell(r, 'revenueWon', fmtMoney(r.revenueWon))}
      ${cell(r, 'dealsWon', fmtInt(r.dealsWon))}
      ${cell(r, 'openPipeline', fmtMoney(r.openPipeline))}
      ${cell(r, 'calls', fmtInt(r.calls))}
      ${cell(r, 'meetings', fmtInt(r.meetings))}
      ${cell(r, 'tasks', fmtInt(r.tasks))}
      ${cell(r, 'activities', fmtInt(r.activities))}
    </tr>`).join('');

  // Plain-language summary of who leads each key activity
  const firstName = (n) => String(n ?? '').split(' ')[0];
  const summary = [
    ['Calls', leads.calls, 'calls'],
    ['Meetings', leads.meetings, 'meetings'],
    ['Tasks', leads.tasks, 'tasks'],
  ].filter(([, who]) => who)
   .map(([label, who, key]) => `${label}: ${esc(firstName(who.name))} (${fmtInt(who[key])})`);

  $('ops-leaders').textContent = summary.length ? `Leading — ${summary.join(' · ')}` : '';
}

function renderClosing(rows) {
  const tb = $('ops-closing');
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="5" class="ops-empty">No open deals with a closing date</td></tr>`; return; }
  tb.innerHTML = rows.map((r, i) => `
    <tr class="ops-row-in" style="--i:${i}">
      <td style="font-weight:var(--fw-medium)">${esc(r.name)}</td>
      <td style="color:var(--fg-2)">${esc(r.stage)}</td>
      <td style="color:var(--fg-2)">${esc(r.owner)}</td>
      <td style="color:var(--fg-3)">${fmtDateStr(r.closingDate)}</td>
      <td class="ops-num">${fmtMoney(r.amount)}</td>
    </tr>`).join('');
}

// ── Month-over-month trends ─────────────────────────────────────────────────

function momDelta(latest, prev) {
  if (prev == null || !prev) {
    return `<span class="ops-mom__delta ops-mom__delta--flat">— <small>vs prev month</small></span>`;
  }
  const d = (latest - prev) / prev, up = d > 0, flat = d === 0;
  const cls = flat ? 'flat' : up ? 'up' : 'down';
  const arrow = flat ? '' : up ? '▲' : '▼';
  return `<span class="ops-mom__delta ops-mom__delta--${cls}">${arrow} ${Math.abs(d * 100).toFixed(1)}% <small>MoM</small></span>`;
}

/** Populate a trend filter <select> (All + categories), preserving selection. */
function populateFilter(kind) {
  const t = currentData?.trend;
  const el = $(kind === 'leads' ? 'ops-leads-filter' : 'ops-deals-filter');
  const cats = t?.[kind]?.categories ?? [];
  const allLabel = kind === 'leads' ? 'All statuses' : 'All stages';
  const prev = el.value;
  el.innerHTML = `<option value="all">${allLabel}</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  el.value = prev && [...el.options].some((o) => o.value === prev) ? prev : 'all';
}

/** Render one trend chart for the currently selected filter value. */
function renderTrend(kind) {
  const t = currentData?.trend;
  const body = $(kind === 'leads' ? 'ops-leads-trend' : 'ops-deals-trend');
  const months = t?.months ?? [];
  if (!months.length) { body.innerHTML = `<p class="ops-empty">No data for this period</p>`; return; }

  const part = t[kind];
  const sel = $(kind === 'leads' ? 'ops-leads-filter' : 'ops-deals-filter').value || 'all';
  const zeros = months.map(() => 0);
  const vals = sel === 'all' ? part.total : (part.series?.[sel] || zeros);
  const latest = vals[vals.length - 1] ?? 0;
  const prev = vals.length > 1 ? vals[vals.length - 2] : null;

  body.innerHTML = `
    <div class="ops-chart-lead">
      <div class="ops-mom">
        <span class="ops-mom__num">${fmtInt(latest)}</span>
        ${momDelta(latest, prev)}
      </div>
      <p class="ops-chart-lead__caption">${esc(t.spanLabel ?? '')}</p>
    </div>
    ${comboChart({
      months, bars: vals,
      label: `${kind === 'leads' ? 'Leads' : 'Deals'} per month`,
      box: chartBox(body, { height: CHART_H }),
    })}`;
}

function renderTrends() {
  populateFilter('leads');
  populateFilter('deals');
  renderTrend('leads');
  renderTrend('deals');
  // Charts are rebuilt above, so (re)wire their tooltips
  attachChartTooltip($('ops-leads-trend'));
  attachChartTooltip($('ops-deals-trend'));
}

function renderAll(data, period) {
  currentData = data;
  renderKpis(data.kpis, period);
  renderTrends();
  renderPipeline(data.pipelineByStage ?? []);
  renderSources(data.leadsBySource ?? []);
  renderStatuses(data.leadsByStatus ?? []);
  renderActivity(data.activityBreakdown ?? { calls: 0, meetings: 0, tasks: 0 });
  renderLeaderboard(data.leaderboard ?? []);
  renderClosing(data.closingSoon ?? []);

  const when = data.generatedAt ? new Date(data.generatedAt) : new Date();
  $('ops-updated').textContent = `Updated ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  const note = data.meta?.notes?.length ? data.meta.notes.join(' · ') : '';
  showState(note ? `<span class="ops-note">${esc(note)}</span>` : '', 'note');
}

// ── State banner ────────────────────────────────────────────────────────────
function showState(html, kind) {
  const el = $('ops-state');
  if (!html) { el.hidden = true; el.innerHTML = ''; return; }
  el.className = kind === 'error' ? 'ops-state ops-state--error' : 'ops-state';
  el.innerHTML = html;
  el.hidden = false;
}

// ── Loading placeholders ────────────────────────────────────────────────────
function showLoading() {
  const ph = `<p class="ops-empty">Loading&hellip;</p>`;
  ['ops-leads-trend', 'ops-deals-trend', 'ops-pipeline', 'ops-activity', 'ops-sources', 'ops-statuses'].forEach((id) => { $(id).innerHTML = ph; });
  $('ops-leaderboard').innerHTML = `<tr><td colspan="5" class="ops-empty">Loading&hellip;</td></tr>`;
  $('ops-closing').innerHTML = `<tr><td colspan="5" class="ops-empty">Loading&hellip;</td></tr>`;
  $('ops-updated').textContent = 'Updating…';
}

// ── Demo data (design review only) ──────────────────────────────────────────
function demoTrend(period) {
  const n = period === 'month' ? 6 : 12;
  const now = new Date();
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()], year: d.getFullYear() });
  }
  const ramp = (base, wobble) => months.map((_, i) => Math.max(0, Math.round(base + i * base * 0.09 + ((i * 7 + wobble) % 5 - 2) * base * 0.12)));
  const nurture = ramp(58, 1), suspect = ramp(24, 3), junk = ramp(6, 2);
  const leadTotal = months.map((_, i) => nurture[i] + suspect[i] + junk[i]);
  const renewal = months.map((_, i) => (i % 3 === 0 ? 2 : i % 2 === 0 ? 1 : 0));
  const proposal = months.map((_, i) => (i % 4 === 0 ? 1 : 0));
  const won = months.map((_, i) => (i % 3 === 1 ? 1 : 0));
  const dealTotal = months.map((_, i) => renewal[i] + proposal[i] + won[i]);
  return {
    months,
    leads: { categories: ['Nurture', 'New Suspect', 'Junk/Disqualified Lead'], series: { Nurture: nurture, 'New Suspect': suspect, 'Junk/Disqualified Lead': junk }, total: leadTotal },
    deals: { categories: ['Renewal', 'Proposal/Price Quote', 'Closed Won'], series: { Renewal: renewal, 'Proposal/Price Quote': proposal, 'Closed Won': won }, total: dealTotal },
  };
}

function demoData(period) {
  const scale = period === 'year' ? 8 : period === 'quarter' ? 3 : 1;
  return {
    period,
    generatedAt: new Date().toISOString(),
    kpis: {
      newLeads:     { value: 107 * scale, prev: 90 * scale, delta: 0.189 },
      newDeals:     { value: 3 * scale,   prev: 5 * scale,  delta: -0.4 },
      revenueWon:   { value: 64_072 * scale, prev: 40_303 * scale, delta: 0.59 },
      winRate:      { value: 0.62, prev: 0.55, delta: 0.07 },
      openPipeline: { value: 486_540 },
      activities:   { value: 42 * scale, prev: 31 * scale, delta: 0.355 },
    },
    pipelineByStage: [
      { stage: 'Renewal', count: 6, amount: 312_540 },
      { stage: 'Proposal/Price Quote', count: 2, amount: 96_000 },
      { stage: 'Negotiation/Review', count: 1, amount: 48_000 },
      { stage: 'Needs Analysis', count: 2, amount: 30_000 },
    ],
    leadsBySource: [
      { source: 'Apollo.io', count: 78 * scale },
      { source: 'Website Contact', count: 14 * scale },
      { source: '3rd Party Biz Dev Company', count: 12 * scale },
      { source: 'Referral', count: 3 * scale },
    ],
    leadsByStatus: [
      { status: 'Nurture', count: 71 * scale },
      { status: 'New Suspect', count: 28 * scale },
      { status: 'Junk/Disqualified Lead', count: 8 * scale },
    ],
    activityBreakdown: { calls: 18 * scale, meetings: 6 * scale, tasks: 18 * scale },
    leaderboard: [
      { name: 'Scott Masson',   revenueWon: 38_036, dealsWon: 2, openPipeline: 312_540, calls: 4,  meetings: 3, tasks: 5,  activities: 12 },
      { name: 'Gonzalo Mendez', revenueWon: 0,      dealsWon: 0, openPipeline: 0,       calls: 14, meetings: 1, tasks: 6,  activities: 21 },
      { name: 'Doug Bonanno',   revenueWon: 26_036, dealsWon: 1, openPipeline: 174_000, calls: 2,  meetings: 5, tasks: 2,  activities: 9 },
    ],
    closingSoon: [
      { name: 'RCMP - Motio CI 2026 Renewal', stage: 'Renewal', owner: 'Scott Masson', closingDate: '2026-08-15', amount: 152_133 },
      { name: 'VAC - Motio Soterre', stage: 'Proposal/Price Quote', owner: 'Scott Masson', closingDate: '2026-08-29', amount: 13_475 },
      { name: 'Froneri - 2026 DH Renewal', stage: 'Renewal', owner: 'Mike Norris', closingDate: '2026-09-30', amount: 95_087 },
    ],
    trend: demoTrend(period),
    meta: { capped: false, notes: [] },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === '1';
  // Year to date by default: a single month is a narrow read of pipeline, and it
  // matches the Support tab's default. "This month" stays available.
  let period = ['month', 'quarter', 'year', 'rolling12'].includes(params.get('period')) ? params.get('period') : 'year';
  let auth = null;

  function setPeriodButtons() {
    document.querySelectorAll('.ops-period__btn').forEach((b) => {
      const on = b.dataset.period === period;
      b.classList.toggle('is-active', on);
      // Colour alone doesn't tell a screen reader which period is selected
      b.setAttribute('aria-pressed', String(on));
    });
  }

  async function load() {
    const refreshBtn = $('ops-refresh');
    refreshBtn.disabled = true;
    refreshBtn.classList.add('is-loading');
    showLoading();
    showState('', 'note');

    try {
      if (isDemo) {
        renderAll(demoData(period), period);
      } else {
        const res = await opsFetch(`/api/ops/dashboard?period=${period}`, auth);
        if (!res) return; // token refresh triggered a redirect

        if (res.status === 503) {
          const body = await res.json().catch(() => ({}));
          // Render the empty shell first — renderAll() resets the state banner,
          // so the config message must be set AFTER it or it gets wiped.
          renderAll(emptyData(period), period);
          showState(`<strong>CRM reporting isn't configured yet.</strong><br>${esc(body.error || 'Set the Zoho reporting token.')}<br>Add a read-scoped <code>ZOHO_REPORTING_REFRESH_TOKEN</code> in Vercel, then refresh.`, 'error');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || body.error || `HTTP ${res.status}`);
        }
        renderAll(await res.json(), period);
      }
    } catch (err) {
      console.error('[ops]', err);
      renderAll(emptyData(period), period);
      showState(`Couldn't load CRM data (${esc(err.message)}). Please try Refresh again.`, 'error');
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('is-loading');
    }
  }

  // Wire controls (no timers — data loads only on these actions)
  $('ops-refresh').addEventListener('click', load);
  $('ops-period').addEventListener('click', (e) => {
    const btn = e.target.closest('.ops-period__btn');
    if (!btn || btn.dataset.period === period) return;
    period = btn.dataset.period;
    setPeriodButtons();
    load();
  });

  // Trend filters re-render from the loaded data — no refetch, no auto-refresh
  $('ops-leads-filter').addEventListener('change', () => renderTrend('leads'));
  $('ops-deals-filter').addEventListener('change', () => renderTrend('deals'));

  try {
    // Auth is required in all modes — including demo. Demo only changes whether
    // we render sample data or call the CRM; it never bypasses sign-in.
    auth = await initOps();
    if (!auth) return; // redirect in progress
    $('ops-user-email').textContent = auth.account.username;
    $('ops-signout').addEventListener('click', () => auth.signOut());
    if (isDemo) $('ops-demo-badge').hidden = false;

    $('ops-loading').hidden = true;
    $('ops-app').hidden = false;
    setPeriodButtons();
    await load();
  } catch (err) {
    console.error('[ops]', err);
    $('ops-loading-msg').textContent = `Error: ${err.message}`;
    $('ops-loading').querySelector('.admin-loading__spinner')?.remove();
  }
}

function emptyData(period) {
  return {
    period, generatedAt: new Date().toISOString(),
    kpis: {
      newLeads: { value: 0, delta: null }, newDeals: { value: 0, delta: null },
      revenueWon: { value: 0, delta: null }, winRate: { value: null, delta: null },
      openPipeline: { value: 0 }, activities: { value: 0, delta: null },
    },
    pipelineByStage: [], leadsBySource: [], leadsByStatus: [],
    activityBreakdown: { calls: 0, meetings: 0, tasks: 0 },
    leaderboard: [], closingSoon: [],
    trend: { months: [], leads: { categories: [], series: {}, total: [] }, deals: { categories: [], series: {}, total: [] } },
    meta: { notes: [] },
  };
}

main();
