/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * Ops → Support page logic (Zoho Desk metrics).
 *
 * Mirrors scripts/ops.js: initOps() gate → load /api/ops/desk for the selected
 * period → render KPIs, trend, breakdowns and the analyst leaderboard. Data
 * reloads ONLY on an explicit Refresh click or a period change — no timers.
 *
 * ?demo=1 renders sample data (still behind sign-in) for design review before
 * the Desk token is provisioned.
 * ─────────────────────────────────────────────────────────────────────────── */

import { initOps, opsFetch } from './dhops.js';
import { comboChart, stackedChart, NAVY, ORANGE } from './ops-charts.js';

const YELLOW = '#FAB400';

const PERIOD_PREV = { month: 'last month', quarter: 'last quarter', year: 'last year' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let currentData = null;

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtInt = (n) => (n ?? 0).toLocaleString('en-US');

/** Hours → compact human duration (2.4h, 1.8d, 35m). */
function fmtDuration(hours) {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const $ = (id) => document.getElementById(id);

/** Delta line. `invert` = lower is better (durations). */
function deltaHtml(delta, period, invert = false) {
  const prevLbl = PERIOD_PREV[period] ?? 'prior period';
  if (delta == null || !isFinite(delta)) {
    return `<span class="ops-kpi__delta ops-kpi__delta--flat">— <small>vs ${prevLbl}</small></span>`;
  }
  const flat = delta === 0;
  const good = invert ? delta < 0 : delta > 0;
  const cls = flat ? 'flat' : good ? 'up' : 'down';
  const arrow = flat ? '' : delta > 0 ? '▲' : '▼';
  return `<span class="ops-kpi__delta ops-kpi__delta--${cls}">${arrow} ${Math.abs(delta * 100).toFixed(1)}% <small>vs ${prevLbl}</small></span>`;
}

// ── Renderers ───────────────────────────────────────────────────────────────

function renderKpis(k, period) {
  const flat = (txt) => `<span class="ops-kpi__delta ops-kpi__delta--flat"><small>${txt}</small></span>`;
  const cards = [
    { label: 'New tickets',      value: fmtInt(k.newTickets.value),   delta: deltaHtml(k.newTickets.delta, period) },
    { label: 'Resolved',         value: fmtInt(k.resolved.value),     delta: deltaHtml(k.resolved.delta, period) },
    { label: 'Open backlog',     value: fmtInt(k.openBacklog.value),  delta: flat('current snapshot') },
    { label: 'Overdue',          value: fmtInt(k.overdue.value),      delta: flat('past due date') },
    { label: 'Avg first response', value: fmtDuration(k.firstResponseHours?.value), delta: flat('this period') },
    { label: 'Avg resolution',   value: fmtDuration(k.resolutionHours?.value), delta: deltaHtml(k.resolutionHours?.delta, period, true) },
  ];
  $('ops-kpis').innerHTML = cards.map((c) => `
    <div class="admin-stat-card ops-kpi">
      <div class="admin-stat-card__label">${c.label}</div>
      <div class="ops-kpi__value">${c.value}</div>
      ${c.delta}
    </div>`).join('');
}

function renderBars(el, items, color) {
  if (!items.length) { el.innerHTML = `<p class="ops-empty">No data for this period</p>`; return; }
  const max = Math.max(...items.map((i) => i.weight), 1);
  el.innerHTML = `<div class="ops-bars">${items.map((i) => `
    <div class="ops-bar">
      <div class="ops-bar__top">
        <span class="ops-bar__label">${esc(i.label)}</span>
        <span class="ops-bar__value">${i.primary}</span>
      </div>
      <div class="ops-bar__track">
        <div class="ops-bar__fill" style="background:${color};transform:scaleX(${(i.weight / max).toFixed(4)})"></div>
      </div>
    </div>`).join('')}</div>`;
}

const toBars = (rows, key) => rows.map((r) => ({ label: r[key], primary: fmtInt(r.count), weight: r.count }));

function renderKb(kb) {
  const el = $('ops-kb');
  if (!kb) { el.innerHTML = `<p class="ops-empty">Knowledge base data unavailable</p>`; return; }

  // Contributors over time — a stacked chart reads better than a flat list at
  // this headcount, and shows who wrote what, when.
  const months = currentData?.trend?.months ?? [];
  const kbTrend = kb.trend;
  const contributors = kbTrend?.contributors ?? [];
  const chart = (months.length && contributors.length)
    ? stackedChart({ months, keys: contributors, series: kbTrend.series, label: 'Articles created per month by contributor' })
    : `<p class="ops-note">No per-contributor article history available</p>`;

  el.innerHTML = `
    <div class="ops-activity">
      <div class="ops-activity__cell"><div class="ops-activity__num">${fmtInt(kb.createdInPeriod)}</div><div class="ops-activity__lbl">Created</div></div>
      <div class="ops-activity__cell"><div class="ops-activity__num">${fmtInt(kb.publishedInPeriod)}</div><div class="ops-activity__lbl">Published</div></div>
      <div class="ops-activity__cell"><div class="ops-activity__num">${fmtInt(kb.drafts)}</div><div class="ops-activity__lbl">Drafts</div></div>
    </div>
    <p class="ops-note">${fmtInt(kb.totalPublished)} published articles in total · Articles created per month by contributor</p>
    ${chart}`;
}

// ── Trend ───────────────────────────────────────────────────────────────────

function momDelta(latest, prev) {
  if (prev == null || !prev) {
    return `<span class="ops-mom__delta ops-mom__delta--flat">— <small>vs prev month</small></span>`;
  }
  const d = (latest - prev) / prev, flat = d === 0;
  const cls = flat ? 'flat' : d > 0 ? 'up' : 'down';
  const arrow = flat ? '' : d > 0 ? '▲' : '▼';
  return `<span class="ops-mom__delta ops-mom__delta--${cls}">${arrow} ${Math.abs(d * 100).toFixed(1)}% <small>MoM</small></span>`;
}

function populateFilter() {
  const el = $('ops-tickets-filter');
  const cats = currentData?.trend?.tickets?.categories ?? [];
  const prev = el.value;
  el.innerHTML = `<option value="all">All statuses</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  el.value = prev && [...el.options].some((o) => o.value === prev) ? prev : 'all';
}

function renderTrend() {
  const body = $('ops-tickets-trend');
  const t = currentData?.trend;
  const months = t?.months ?? [];
  if (!months.length) { body.innerHTML = `<p class="ops-empty">No data for this period</p>`; return; }

  const part = t.tickets;
  const sel = $('ops-tickets-filter').value || 'all';
  const zeros = months.map(() => 0);
  const vals = sel === 'all' ? part.total : (part.series?.[sel] || zeros);
  const prevVals = sel === 'all' ? (part.prevTotal || zeros) : (part.prevSeries?.[sel] || zeros);

  const latest = vals[vals.length - 1] ?? 0;
  const prevMonth = vals.length > 1 ? vals[vals.length - 2] : null;
  const lastYear = prevVals[prevVals.length - 1] ?? 0;

  const yoy = lastYear
    ? (() => {
        const d = (latest - lastYear) / lastYear;
        const cls = d === 0 ? 'flat' : d > 0 ? 'up' : 'down';
        const arrow = d === 0 ? '' : d > 0 ? '▲' : '▼';
        return `<span class="ops-mom__delta ops-mom__delta--${cls}">${arrow} ${Math.abs(d * 100).toFixed(1)}% <small>vs last year</small></span>`;
      })()
    : '';

  body.innerHTML = `
    <div class="ops-mom">
      <span class="ops-mom__num">${fmtInt(latest)}</span>
      ${momDelta(latest, prevMonth)}
      ${yoy}
    </div>
    ${comboChart({ months, bars: vals, line: prevVals, label: 'Tickets per month with last year overlaid' })}`;
}

function renderLeaderboard(rows, summary) {
  const tb = $('ops-leaderboard');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="5" class="ops-empty">No analyst activity in this period</td></tr>`;
  } else {
    tb.innerHTML = rows.map((r) => `
      <tr>
        <td style="font-weight:var(--fw-medium)">${esc(r.name)}</td>
        <td class="ops-num">${fmtInt(r.taken)}</td>
        <td class="ops-num">${fmtInt(r.resolved)}</td>
        <td class="ops-num">${fmtInt(r.open)}</td>
        <td class="ops-num">${fmtDuration(r.avgResolutionHours)}</td>
      </tr>`).join('');
  }
  const s = summary ?? {};
  $('ops-analyst-summary').textContent = s.avgTicketsPerAnalyst != null
    ? `${s.avgTicketsPerAnalyst.toFixed(1)} tickets per analyst · ${fmtInt(s.analysts)} analysts`
    : '';
}

function renderAll(data, period) {
  currentData = data;
  renderKpis(data.kpis, period);
  populateFilter();
  renderTrend();
  renderKb(data.kb);
  renderBars($('ops-by-status'), toBars(data.byStatus ?? [], 'status'), NAVY);
  renderBars($('ops-by-priority'), toBars(data.byPriority ?? [], 'priority'), ORANGE);
  renderBars($('ops-by-channel'), toBars(data.byChannel ?? [], 'channel'), YELLOW);
  renderLeaderboard(data.leaderboard ?? [], data.analystSummary);

  const when = data.generatedAt ? new Date(data.generatedAt) : new Date();
  $('ops-updated').textContent = `Updated ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

  const note = data.meta?.notes?.length ? data.meta.notes.join(' · ') : '';
  showState(note ? `<span class="ops-note">${esc(note)}</span>` : '', 'note');
}

function showState(html, kind) {
  const el = $('ops-state');
  if (!html) { el.hidden = true; el.innerHTML = ''; return; }
  el.className = kind === 'error' ? 'ops-state ops-state--error' : 'ops-state';
  el.innerHTML = html;
  el.hidden = false;
}

function showLoading() {
  const ph = `<p class="ops-empty">Loading&hellip;</p>`;
  ['ops-tickets-trend', 'ops-kb', 'ops-by-status', 'ops-by-priority', 'ops-by-channel'].forEach((id) => { $(id).innerHTML = ph; });
  $('ops-leaderboard').innerHTML = `<tr><td colspan="5" class="ops-empty">Loading&hellip;</td></tr>`;
  $('ops-updated').textContent = 'Updating…';
  $('ops-analyst-summary').textContent = '';
}

// ── Demo + empty data ───────────────────────────────────────────────────────

function trendMonths(n) {
  const now = new Date(), out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0');
    out.push({ key: `${y}-${mm}`, prevKey: `${y - 1}-${mm}`, label: MONTHS[d.getMonth()], year: y });
  }
  return out;
}

function demoData(period) {
  const scale = period === 'year' ? 8 : period === 'quarter' ? 3 : 1;
  const months = trendMonths(period === 'month' ? 6 : 12);
  const open = months.map((_, i) => 6 + ((i * 5) % 7));
  const closed = months.map((_, i) => 14 + ((i * 3) % 9));
  const total = months.map((_, i) => open[i] + closed[i]);
  // Same months a year earlier — the comparison line
  const prevOpen = months.map((_, i) => 4 + ((i * 3) % 5));
  const prevClosed = months.map((_, i) => 11 + ((i * 4) % 7));
  const prevTotal = months.map((_, i) => prevOpen[i] + prevClosed[i]);
  // Four KB contributors, monthly output
  const kbNames = ['Nicole', 'Louis', 'Priya', 'Sam'];
  const kbSeries = {};
  kbNames.forEach((n, ni) => { kbSeries[n] = months.map((_, i) => Math.max(0, (i + ni) % 4 === 0 ? 0 : ((i * (ni + 2)) % 3))); });
  const kbTotal = months.map((_, i) => kbNames.reduce((s, n) => s + kbSeries[n][i], 0));
  return {
    period, generatedAt: new Date().toISOString(),
    kpis: {
      newTickets:  { value: 34 * scale, prev: 29 * scale, delta: 0.172 },
      resolved:    { value: 31 * scale, prev: 27 * scale, delta: 0.148 },
      openBacklog: { value: 12 },
      overdue:     { value: 3 },
      firstResponseHours: { value: 2.4 },
      resolutionHours:    { value: 19.6, prev: 23.1, delta: -0.151 },
    },
    byStatus:   [{ status: 'Closed', count: 31 * scale }, { status: 'Open', count: 9 * scale }, { status: 'On Hold', count: 3 * scale }],
    byPriority: [{ priority: 'Medium', count: 18 * scale }, { priority: 'High', count: 9 * scale }, { priority: 'Low', count: 5 * scale }, { priority: 'Urgent', count: 2 * scale }],
    byChannel:  [{ channel: 'Email', count: 24 * scale }, { channel: 'Web', count: 8 * scale }, { channel: 'Phone', count: 2 * scale }],
    trend: {
      months,
      tickets: {
        categories: ['Closed', 'Open'],
        series: { Closed: closed, Open: open }, total,
        prevSeries: { Closed: prevClosed, Open: prevOpen }, prevTotal,
      },
    },
    leaderboard: [
      { agentId: '1', name: 'Support Analyst A', taken: 15 * scale, resolved: 14 * scale, open: 5, avgResolutionHours: 16.2 },
      { agentId: '2', name: 'Support Analyst B', taken: 12 * scale, resolved: 11 * scale, open: 4, avgResolutionHours: 21.8 },
      { agentId: '3', name: 'Support Analyst C', taken: 7 * scale, resolved: 6 * scale, open: 3, avgResolutionHours: 27.4 },
    ],
    analystSummary: { analysts: 3, avgTicketsPerAnalyst: (34 * scale) / 3 },
    kb: {
      createdInPeriod: 4 * scale, publishedInPeriod: 3 * scale, totalPublished: 42, drafts: 7,
      byStatus: [{ status: 'Published', count: 42 }, { status: 'Draft', count: 7 }],
      byAnalyst: [
        { name: 'Support Analyst A', authored: 24, published: 22, createdInPeriod: 2 * scale, publishedInPeriod: 2 * scale },
        { name: 'Support Analyst B', authored: 15, published: 14, createdInPeriod: 2 * scale, publishedInPeriod: 1 * scale },
        { name: 'Support Analyst C', authored: 10, published: 6, createdInPeriod: 0, publishedInPeriod: 0 },
      ],
      trend: { contributors: kbNames, series: kbSeries, total: kbTotal },
    },
    meta: { notes: [] },
  };
}

function emptyData(period) {
  return {
    period, generatedAt: new Date().toISOString(),
    kpis: {
      newTickets: { value: 0, delta: null }, resolved: { value: 0, delta: null },
      openBacklog: { value: 0 }, overdue: { value: 0 },
      firstResponseHours: { value: null }, resolutionHours: { value: null, delta: null },
    },
    byStatus: [], byPriority: [], byChannel: [],
    trend: { months: [], tickets: { categories: [], series: {}, total: [] } },
    leaderboard: [], analystSummary: null, kb: null, meta: { notes: [] },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === '1';
  let period = ['month', 'quarter', 'year'].includes(params.get('period')) ? params.get('period') : 'month';
  let auth = null;

  function setPeriodButtons() {
    document.querySelectorAll('.ops-period__btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.period === period);
    });
  }

  async function load() {
    const btn = $('ops-refresh');
    btn.disabled = true;
    btn.classList.add('is-loading');
    showLoading();
    showState('', 'note');

    try {
      if (isDemo) {
        renderAll(demoData(period), period);
      } else {
        const res = await opsFetch(`/api/ops/desk?period=${period}`, auth);
        if (!res) return; // token refresh triggered a redirect

        if (res.status === 503) {
          const body = await res.json().catch(() => ({}));
          renderAll(emptyData(period), period);
          showState(`<strong>Zoho Desk isn't connected yet.</strong><br>${esc(body.error || '')}<br>Add <code>ZOHO_DESK_REFRESH_TOKEN</code> and <code>ZOHO_DESK_ORG_ID</code> in Vercel, redeploy, then refresh.`, 'error');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || body.error || `HTTP ${res.status}`);
        }
        renderAll(await res.json(), period);
      }
    } catch (err) {
      console.error('[ops-support]', err);
      renderAll(emptyData(period), period);
      showState(`Couldn't load Desk data (${esc(err.message)}). Please try Refresh again.`, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  }

  // Controls — no timers, data loads only on these actions
  $('ops-refresh').addEventListener('click', load);
  $('ops-period').addEventListener('click', (e) => {
    const btn = e.target.closest('.ops-period__btn');
    if (!btn || btn.dataset.period === period) return;
    period = btn.dataset.period;
    setPeriodButtons();
    load();
  });
  $('ops-tickets-filter').addEventListener('change', renderTrend);

  try {
    // Auth required in all modes, including demo
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
    console.error('[ops-support]', err);
    $('ops-loading-msg').textContent = `Error: ${err.message}`;
    $('ops-loading').querySelector('.admin-loading__spinner')?.remove();
  }
}

main();
