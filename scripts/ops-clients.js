/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * Ops → Clients page logic (client health).
 *
 * Health is a hypothesis, not a measurement: CSAT/feedback isn't collected yet,
 * so we infer it from engagement recency (Desk tickets, commercial milestones,
 * meetings, inbound calls). Thresholds come from the server payload.
 *
 * Snapshot view — no period selector. Data loads on sign-in and on Refresh only;
 * there are no timers.
 * ─────────────────────────────────────────────────────────────────────────── */

import { initOps, opsFetch } from './dhops.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const HEALTH_LABEL = { healthy: 'Healthy', warning: 'Warning', risk: 'At risk', unknown: 'No contact on record' };
const VIA_LABEL = { ticket: 'Support ticket', meeting: 'Meeting', call: 'Inbound call', milestone: 'Renewal / won deal' };

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtInt   = (n) => (n ?? 0).toLocaleString('en-US');
const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n ?? 0);

function fmtDate(msVal) {
  if (msVal == null) return '—';
  const d = new Date(msVal);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtAgo(days) {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} months ago`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const $ = (id) => document.getElementById(id);

// ── Renderers ───────────────────────────────────────────────────────────────

function renderKpis(s, thresholds) {
  const t = thresholds ?? { warnDays: 30, riskDays: 90 };
  const cards = [
    { label: 'Clients',   value: fmtInt(s.total),   sub: 'with a won deal' },
    { label: 'Healthy',   value: fmtInt(s.healthy), sub: `contact within ${t.warnDays} days`, tone: 'up' },
    { label: 'Warning',   value: fmtInt(s.warning), sub: `${t.warnDays + 1}–${t.riskDays} days`, tone: 'warn' },
    { label: 'At risk',   value: fmtInt(s.risk),    sub: `over ${t.riskDays} days`, tone: 'down' },
  ];
  if (s.unknown) cards.push({ label: 'No contact', value: fmtInt(s.unknown), sub: 'nothing on record' });

  $('ops-kpis').innerHTML = cards.map((c) => `
    <div class="admin-stat-card ops-kpi">
      <div class="admin-stat-card__label">${c.label}</div>
      <div class="ops-kpi__value${c.tone ? ` ops-kpi__value--${c.tone}` : ''}">${c.value}</div>
      <span class="ops-kpi__delta ops-kpi__delta--flat"><small>${esc(c.sub)}</small></span>
    </div>`).join('');
}

function healthPill(health) {
  return `<span class="ops-health ops-health--${health}"><span class="admin-status__dot"></span>${HEALTH_LABEL[health] ?? health}</span>`;
}

function renderClients(rows) {
  const tb = $('ops-clients');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="8" class="ops-empty">No clients found (no won deals)</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map((c) => {
    const via = c.lastContactKind
      ? `${VIA_LABEL[c.lastContactKind] ?? c.lastContactKind}${c.lastContactLabel ? `<br><small style="color:var(--fg-3)">${esc(c.lastContactLabel)}</small>` : ''}`
      : '—';
    return `
    <tr>
      <td style="font-weight:var(--fw-medium)">${esc(c.name)}</td>
      <td>${healthPill(c.health)}</td>
      <td>${fmtDate(c.lastContactAt)}${c.daysSince != null ? `<br><small style="color:var(--fg-3)">${fmtAgo(c.daysSince)}</small>` : ''}</td>
      <td style="color:var(--fg-2)">${via}</td>
      <td style="color:var(--fg-2)">${esc(c.owner ?? '—')}</td>
      <td class="ops-num">${c.openTickets ? fmtInt(c.openTickets) : '—'}</td>
      <td style="color:var(--fg-2)">${c.nextRenewalAt ? fmtDate(c.nextRenewalAt) : '—'}</td>
      <td class="ops-num">${fmtMoney(c.lifetimeValue)}</td>
    </tr>`;
  }).join('');
}

function renderAll(data) {
  renderKpis(data.summary ?? {}, data.thresholds);
  renderClients(data.clients ?? []);

  const t = data.thresholds ?? { warnDays: 30, riskDays: 90 };
  const sources = data.deskConnected
    ? 'support tickets, renewals/won deals, meetings and inbound calls'
    : 'renewals/won deals, meetings and inbound calls';
  $('ops-method').innerHTML =
    `Health is inferred from engagement recency (${sources}) — automated outbound marketing is excluded. ` +
    `Healthy ≤${t.warnDays} days · Warning ${t.warnDays + 1}–${t.riskDays} · At risk >${t.riskDays}. ` +
    `Not a satisfaction measurement`;

  $('ops-client-count').textContent = `${fmtInt((data.clients ?? []).length)} clients · worst first`;

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
  $('ops-clients').innerHTML = `<tr><td colspan="8" class="ops-empty">Loading&hellip;</td></tr>`;
  $('ops-updated').textContent = '';
  $('ops-client-count').textContent = '';
}

// ── Demo + empty ────────────────────────────────────────────────────────────

function demoData() {
  const day = 86400000, now = Date.now();
  const mk = (name, owner, days, kind, opts = {}) => ({
    accountId: name, name, owner,
    lastContactAt: days == null ? null : now - days * day,
    daysSince: days,
    lastContactKind: kind,
    lastContactLabel: opts.label ?? null,
    health: days == null ? 'unknown' : days > 90 ? 'risk' : days > 30 ? 'warning' : 'healthy',
    openTickets: opts.openTickets ?? 0,
    ticketsTotal: opts.ticketsTotal ?? 0,
    nextRenewalAt: opts.renewal ? now + opts.renewal * day : null,
    nextRenewalName: null,
    lifetimeValue: opts.ltv ?? 0,
    dealsWon: opts.dealsWon ?? 1,
    openPipeline: 0,
  });

  const clients = [
    mk('Parkingeye Limited', 'Mike Norris', null, null, { ltv: 31295 }),
    mk('Metagenics Belgium BV', 'Scott Masson', 620, 'milestone', { label: 'Metagenics - DH 2023 Renewal', ltv: 13000 }),
    mk('MagellanRx Management', 'Scott Masson', 410, 'milestone', { label: 'Magellan - DH 2023 Renewal', ltv: 42750 }),
    mk('University of Denver', 'Scott Masson', 180, 'milestone', { label: 'DU - DH 2024 Renewal', ltv: 77544 }),
    mk('HCSC', 'Scott Masson', 96, 'ticket', { openTickets: 1, ticketsTotal: 6, ltv: 740227 }),
    mk('Pattison Outdoor', 'Mike Norris', 62, 'ticket', { ticketsTotal: 3, ltv: 91860 }),
    mk('CBSA', 'Scott Masson', 21, 'milestone', { label: 'CBSA Motio CI 2026 Renewal', renewal: 300, ltv: 74406 }),
    mk('Veterans Affairs Canada', 'Scott Masson', 3, 'ticket', { openTickets: 2, ticketsTotal: 14, renewal: 3, ltv: 233054 }),
  ];

  return {
    generatedAt: new Date().toISOString(),
    thresholds: { warnDays: 30, riskDays: 90 },
    deskConnected: true,
    summary: {
      total: clients.length,
      healthy: clients.filter((c) => c.health === 'healthy').length,
      warning: clients.filter((c) => c.health === 'warning').length,
      risk: clients.filter((c) => c.health === 'risk').length,
      unknown: clients.filter((c) => c.health === 'unknown').length,
    },
    clients,
    meta: { notes: [] },
  };
}

const emptyData = () => ({
  generatedAt: new Date().toISOString(),
  thresholds: { warnDays: 30, riskDays: 90 },
  deskConnected: false,
  summary: { total: 0, healthy: 0, warning: 0, risk: 0, unknown: 0 },
  clients: [], meta: { notes: [] },
});

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === '1';
  let auth = null;

  async function load() {
    const btn = $('ops-refresh');
    btn.disabled = true;
    btn.classList.add('is-loading');
    showLoading();
    showState('', 'note');

    try {
      if (isDemo) {
        renderAll(demoData());
      } else {
        const res = await opsFetch('/api/ops/clients', auth);
        if (!res) return; // token refresh triggered a redirect

        if (res.status === 503) {
          const body = await res.json().catch(() => ({}));
          renderAll(emptyData());
          showState(`<strong>CRM reporting isn't configured yet.</strong><br>${esc(body.error || '')}`, 'error');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || body.error || `HTTP ${res.status}`);
        }
        renderAll(await res.json());
      }
    } catch (err) {
      console.error('[ops-clients]', err);
      renderAll(emptyData());
      showState(`Couldn't load client data (${esc(err.message)}). Please try Refresh again.`, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  }

  $('ops-refresh').addEventListener('click', load);

  try {
    // Auth required in all modes, including demo
    auth = await initOps();
    if (!auth) return; // redirect in progress
    $('ops-user-email').textContent = auth.account.username;
    $('ops-signout').addEventListener('click', () => auth.signOut());
    if (isDemo) $('ops-demo-badge').hidden = false;

    $('ops-loading').hidden = true;
    $('ops-app').hidden = false;
    await load();
  } catch (err) {
    console.error('[ops-clients]', err);
    $('ops-loading-msg').textContent = `Error: ${err.message}`;
    $('ops-loading').querySelector('.admin-loading__spinner')?.remove();
  }
}

main();
