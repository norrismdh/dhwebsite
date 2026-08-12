/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * Ops Pricing page logic — tiered-pricing calculator with three views:
 * Admin (full rate-card controls + chart/table), Rep (CRM customer lookup),
 * and Partner (free-text customer name). All three share one set of
 * users/months inputs and the same compute() — Rep/Partner just can't touch
 * price/rate/tier/cap, which stay pinned to the standard rate card (DEFAULTS).
 *
 * Flow: initOps() (Azure AD gate) → reveal shell → compute + render from the
 * input fields. Pricing math is client-side; the only network call is the
 * CRM account-name search behind Rep's customer field.
 * ─────────────────────────────────────────────────────────────────────────── */

import { initOps, opsFetch } from './dhops.js';
import { chartBox, attachChartTooltip, ORANGE, COMPARE } from './ops-charts.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = { users: 0, price: 5.00, rate: 10, tier: 1000, months: 12, capOn: true, cap: 15000 };
const MAX_TIERS = 200000; // safety guard against runaway loops
const MIN_USERS = 250;

// Reseller/channel margin rate card — from "Reseller Margin Calculator July
// 2026" (Margin Calc Worksheet). Fixed business terms, not user-editable:
//   Reseller Base Margin:  new subscriptions 31%, renewals 21%
//   Multi-yr Contract:     +3% on new subscriptions when the committed term
//                          is 3+ years (locked in for every year of that term)
//   Sales Level Accelerator: +2% one-time, when this deal pushes the
//                          reseller's YTD attainment to 100%+ of their annual
//                          new-logo target
const MARGIN_RATES = { newSubBase: 0.31, renewalBase: 0.21, multiYearBonus: 0.03, salesAccelBonus: 0.02 };
const MULTI_YEAR_MONTHS = 36;

// Rep/Partner are read-only views over the standard rate card — they see the
// same four result tiles as Admin, but can't touch price/rate/tier/cap, and
// never see the chart or tier-by-tier table.
let currentView = 'admin';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtInt   = (n) => Math.round(n ?? 0).toLocaleString('en-US');
const fmtUSD0  = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n ?? 0);
// Per-user price needs up to 4 decimal places (fractional cents at deep
// discount tiers) with trailing zeros trimmed — Intl's currency formatter
// can't do the latter, so this stays a manual formatter.
const price2 = (n) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const ceilCent = (x) => Math.ceil(x * 100 - 1e-6) / 100; // always round UP to the nearest cent

// Shown everywhere results are withheld — every KPI tile, table, and the
// chart share this one message rather than each writing its own.
const EMPTY_NOTE = 'Enter number of users and contract length above';

/** One result tile, shared by the client-price and margin KPI rows so a
 * blank/invalid state and a computed state render through the same markup. */
function kpiTile({ i, label, value, note, hero, accent }) {
  const cls = ['admin-stat-card', 'ops-kpi', hero && 'ops-kpi--hero', accent && 'ops-kpi--margin'].filter(Boolean).join(' ');
  const valCls = hero ? ' ops-kpi__value--hero' : '';
  return `<div class="${cls}" style="--i:${i}"><div class="admin-stat-card__label">${label}</div><div class="ops-kpi__value${valCls}">${value}</div><div class="ops-kpi__note">${note}</div></div>`;
}

// ── Compute ─────────────────────────────────────────────────────────────────

function readInputs() {
  return {
    users:  Math.floor(+$('pr-users').value || 0),
    price:  +$('pr-price').value || 0,
    rate:   Math.min(1, Math.max(0, (+$('pr-rate').value || 0) / 100)),
    tier:   Math.floor(+$('pr-tier').value || 0),
    months: Math.floor(+$('pr-months').value || 0),
    capOn:  $('pr-cap-on').checked,
    capVal: Math.max(0, Math.floor(+$('pr-cap').value || 0)),
  };
}

/** Required fields, all views: users must clear the 250 minimum, contract
 * length and starting price must be positive, and tier size must be at
 * least 1 (0 would spin compute()'s tier loop forever). Nothing is shown
 * until every one of these holds. */
function isValid(raw) {
  return raw.users >= MIN_USERS && raw.months >= 1 && raw.price > 0 && raw.tier >= 1;
}

function compute(inputs) {
  const { users, price, rate, tier, months, capOn, capVal } = inputs;
  // Number of tiers that keep decaying before the floor kicks in
  const maxDiscTiers = (capOn && capVal > 0) ? Math.ceil(capVal / tier) : Infinity;

  let remaining = users, idx = 0, total = 0, capped = false;
  const rows = [];
  while (remaining > 0 && idx < MAX_TIERS) {
    idx++;
    const u = Math.min(tier, remaining);
    const level = Math.min(idx - 1, maxDiscTiers - 1);
    const isFloor = (idx - 1) > (maxDiscTiers - 1);
    if (isFloor) capped = true;
    // Floor price (charged to users over the max count) is always rounded UP
    // to the nearest cent
    const ppu = isFloor ? ceilCent(price * Math.pow(1 - rate, level)) : price * Math.pow(1 - rate, level);
    const cost = u * ppu * months;
    total += cost;
    rows.push({ idx, u, ppu, cost, isFloor, cum: users - remaining + u });
    remaining -= u;
  }
  return { users, price, rate, tier, months, capOn, capVal, total, rows, capped };
}

/**
 * Reseller margin for this deal (Partner view only).
 * @param {{acv:number, termMonths:number, annualTarget:number, ytdSold:number}} inputs
 *   acv          — this deal's Annual Contract Value (the "Annualized" tile)
 *   termMonths   — committed contract length in months
 *   annualTarget — reseller's annual new-logo ACV quota (0 = unknown)
 *   ytdSold      — reseller's ACV sold so far this year, before this deal
 */
function computeMargin({ acv, termMonths, annualTarget, ytdSold }) {
  const isMultiYear = termMonths >= MULTI_YEAR_MONTHS;
  const baseMargin = MARGIN_RATES.newSubBase + (isMultiYear ? MARGIN_RATES.multiYearBonus : 0);

  const ytdAttainment = annualTarget > 0 ? ytdSold / annualTarget : null;
  const attainmentWithDeal = annualTarget > 0 ? (ytdSold + acv) / annualTarget : null;
  // The sales accelerator rewards the attainment MOMENT this deal creates —
  // it's a one-time bonus on year one, not a permanent rate increase
  const accelerated = attainmentWithDeal !== null && attainmentWithDeal >= 1;
  const effectiveMargin = baseMargin + (accelerated ? MARGIN_RATES.salesAccelBonus : 0);
  const yearOneMargin = acv * effectiveMargin;

  // Multi-year (3+ yr) commitments pay the SAME base rate for every year of
  // the initial term. A shorter deal that still spans more than one year
  // (e.g. a 24-month term) isn't a committed multi-year contract, so its
  // second year is a separate, uncommitted renewal at the flat renewal rate.
  const termYears = Math.max(1, Math.round(termMonths / 12));
  const years = [];
  for (let y = 1; y <= termYears; y++) {
    const rate = y === 1 ? effectiveMargin : (isMultiYear ? baseMargin : MARGIN_RATES.renewalBase);
    years.push({ year: y, acv, rate, margin: acv * rate });
  }
  const totalMargin = years.reduce((sum, y) => sum + y.margin, 0);

  return { isMultiYear, baseMargin, ytdAttainment, attainmentWithDeal, accelerated, effectiveMargin, yearOneMargin, termYears, years, totalMargin };
}

// ── Render ──────────────────────────────────────────────────────────────────

function render() {
  const raw = readInputs();
  const valid = isValid(raw);
  const d = valid ? compute(raw) : null;

  const annual = d ? (d.months ? d.total / d.months * 12 : 0) : 0;
  const blended = d && d.users > 0 ? d.total / d.users / d.months : 0;
  const undiscounted = d ? d.users * d.price * d.months : 0;
  const disc = d && undiscounted > 0 ? (1 - d.total / undiscounted) : 0;

  renderKpis(d, annual, blended, disc, undiscounted);
  // The tier table and chart are Admin-only and hidden for Rep/Partner — skip
  // them there so the chart isn't measured at zero width behind [hidden]
  if (currentView === 'admin') {
    renderTable(d);
    renderChart(d);
  }
  if (currentView === 'partner') {
    const m = d ? computeMargin({
      acv: annual,
      termMonths: d.months,
      annualTarget: Math.max(0, +$('pr-quota').value || 0),
      ytdSold: Math.max(0, +$('pr-ytd').value || 0),
    }) : null;
    renderMarginKpis(m, annual);
    renderMarginTable(m);
  }
}

function renderKpis(d, annual, blended, disc, undiscounted) {
  if (!d) {
    $('pr-kpis').innerHTML = [
      kpiTile({ i: 0, label: 'Total contract cost', value: '—', note: EMPTY_NOTE, hero: true }),
      kpiTile({ i: 1, label: 'Annualized', value: '—', note: EMPTY_NOTE }),
      kpiTile({ i: 2, label: 'Blended price', value: '—', note: EMPTY_NOTE }),
      kpiTile({ i: 3, label: 'Effective discount', value: '—', note: EMPTY_NOTE }),
    ].join('');
    return;
  }

  const totalNote = `${fmtInt(d.users)} users · ${d.months} months`;
  const discNote = `${fmtUSD0(undiscounted - d.total)} saved vs. ${price2(d.price)}/user`;

  $('pr-kpis').innerHTML = [
    kpiTile({ i: 0, label: 'Total contract cost', value: fmtUSD0(d.total), note: totalNote, hero: true }),
    kpiTile({ i: 1, label: 'Annualized', value: fmtUSD0(annual), note: 'per 12 months' }),
    kpiTile({ i: 2, label: 'Blended price', value: price2(blended), note: 'avg / user / month' }),
    kpiTile({ i: 3, label: 'Effective discount', value: `${(disc * 100).toFixed(1)}%`, note: discNote }),
  ].join('');
}

function renderTable(d) {
  const tb = $('pr-tbody');
  if (!d) {
    tb.innerHTML = '';
    $('pr-f-users').textContent = '—';
    $('pr-f-total').textContent = '—';
    $('pr-foot-note').textContent = `${EMPTY_NOTE} to see the tier breakdown.`;
    return;
  }
  tb.innerHTML = '';

  // Group trailing floor tiers into one row — a 15-tier floor run would
  // otherwise be 15 near-identical rows
  const display = [];
  let floorRun = null;
  for (const r of d.rows) {
    if (r.isFloor) {
      if (!floorRun) floorRun = { ...r, count: 1, uSum: r.u, cost: r.cost, firstIdx: r.idx };
      else { floorRun.count++; floorRun.uSum += r.u; floorRun.cost += r.cost; floorRun.idx = r.idx; floorRun.cum = r.cum; }
    } else {
      display.push(r);
    }
  }

  let running = 0;
  let i = 0;
  const push = (label, users, cum, ppu, cost, floor) => {
    running += cost;
    const tr = document.createElement('tr');
    tr.className = 'ops-row-in' + (floor ? ' ops-price-floor' : '');
    tr.style.setProperty('--i', i++);
    tr.innerHTML = `<td>${label}</td><td class="ops-num">${fmtInt(users)}</td><td class="ops-num">${fmtInt(cum)}</td>` +
      `<td class="ops-num">${price2(ppu)}</td><td class="ops-num">${fmtUSD0(cost)}</td><td class="ops-num">${fmtUSD0(running)}</td>`;
    tb.appendChild(tr);
  };
  for (const r of display) push('Tier ' + r.idx, r.u, r.cum, r.ppu, r.cost, false);
  if (floorRun) {
    const lbl = floorRun.count > 1 ? `Tiers ${floorRun.firstIdx}–${floorRun.idx}` : `Tier ${floorRun.firstIdx}`;
    const tr = document.createElement('tr');
    tr.className = 'ops-row-in ops-price-floor';
    tr.style.setProperty('--i', i++);
    running += floorRun.cost;
    tr.innerHTML = `<td>${lbl}<span class="ops-price-floor-pill">Floor</span></td><td class="ops-num">${fmtInt(floorRun.uSum)}</td>` +
      `<td class="ops-num">${fmtInt(floorRun.cum)}</td><td class="ops-num">${price2(floorRun.ppu)}</td><td class="ops-num">${fmtUSD0(floorRun.cost)}</td><td class="ops-num">${fmtUSD0(running)}</td>`;
    tb.appendChild(tr);
  }

  $('pr-f-users').textContent = fmtInt(d.users);
  $('pr-f-total').textContent = fmtUSD0(d.total);

  let note = '';
  if (d.capped) {
    note = `Discounting stops after ${fmtInt(d.capVal)} users — every user beyond that is billed at the floor price of ${price2(d.rows.find((r) => r.isFloor).ppu)}/user/month (rounded up to the nearest cent).`;
  } else if (d.capOn) {
    note = `The ${fmtInt(d.users)} users don't reach the ${fmtInt(d.capVal)}-user discount cap, so every tier is still decaying.`;
  } else {
    note = `No discount cap — each additional ${fmtInt(d.tier)}-user tier keeps decaying by ${(d.rate * 100).toFixed(1)}%.`;
  }
  if (d.rows.length >= MAX_TIERS) note += ' (Display truncated at the tier limit.)';
  $('pr-foot-note').textContent = note;
}

function renderChart(d) {
  const wrap = $('pr-chart-wrap');
  if (!d || d.rows.length === 0) {
    wrap.innerHTML = `<p class="ops-empty">${EMPTY_NOTE} to see pricing.</p>`;
    return;
  }

  const box = chartBox(wrap, { height: 260 });
  const m = { t: 18, r: 14, b: 34, l: 56 };
  const iw = box.w - m.l - m.r, ih = box.h - m.t - m.b;

  // Cap the number of bars drawn for readability — a 60-tier contract would
  // otherwise render as an unreadable comb of hairline bars
  const MAXBARS = 60;
  let bars = d.rows;
  const truncated = bars.length > MAXBARS;
  if (truncated) bars = bars.slice(0, MAXBARS);

  const maxP = Math.max(...d.rows.map((r) => r.ppu), d.price);
  const yMax = maxP * 1.08 || 1;
  const x = (i) => m.l + (iw / bars.length) * i;
  const bw = Math.max(2, (iw / bars.length) * 0.68);
  const gap = (iw / bars.length - bw) / 2;
  const y = (v) => m.t + ih - (v / yMax) * ih;

  // Gridlines + y-axis ticks
  let ticks = '';
  const TICKS = 4;
  for (let i = 0; i <= TICKS; i++) {
    const val = yMax * i / TICKS, yy = y(val);
    ticks += `<line x1="${m.l}" x2="${box.w - m.r}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="ops-chart__axis" style="opacity:${i === 0 ? 1 : 0.5}" />`;
    ticks += `<text x="${(m.l - 8).toFixed(1)}" y="${(yy + 3).toFixed(1)}" text-anchor="end" class="ops-chart__lbl">$${val.toFixed(2)}</text>`;
  }

  // Bars, with a full-height hover target per tier carrying tooltip data —
  // same {title, rows} shape attachChartTooltip() already knows how to render
  let barEls = '';
  bars.forEach((r, i) => {
    const bx = x(i) + gap, by = y(r.ppu), bh = m.t + ih - by;
    const color = r.isFloor ? COMPARE : ORANGE;
    const payload = {
      title: `Tier ${r.idx}${r.isFloor ? ' (floor)' : ''}`,
      rows: [
        { name: 'Price', value: price2(r.ppu) + '/user/mo', color },
        { name: 'Users', value: fmtInt(r.u) },
        { name: 'Tier cost', value: fmtUSD0(r.cost) },
      ],
    };
    barEls += `<g class="ops-chart__slot" data-slot="${i}" data-tip="${esc(JSON.stringify(payload))}">
      <rect class="ops-chart__hit-bg" x="${bx.toFixed(1)}" y="${m.t}" width="${bw.toFixed(1)}" height="${ih}" rx="3" />
      <rect class="ops-chart__bar" style="--i:${i}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}" fill="${color}" />
      <rect class="ops-chart__hit" x="${bx.toFixed(1)}" y="${m.t}" width="${bw.toFixed(1)}" height="${ih}" />
    </g>`;
  });

  // X-axis tier labels (sparse — one per ~12 bars, plus the last)
  let xLabels = '';
  const step = Math.ceil(bars.length / 12);
  bars.forEach((r, i) => {
    if (i % step === 0 || i === bars.length - 1) {
      xLabels += `<text x="${(x(i) + iw / bars.length / 2).toFixed(1)}" y="${box.h - 12}" text-anchor="middle" class="ops-chart__lbl">${r.idx}</text>`;
    }
  });
  xLabels += `<text x="${(m.l + iw / 2).toFixed(1)}" y="${box.h - 1}" text-anchor="middle" class="ops-chart__lbl">Tier${truncated ? ` (first ${MAXBARS} shown)` : ''} →</text>`;

  wrap.innerHTML = `
    <svg class="ops-chart" style="height:${box.h}px" viewBox="0 0 ${box.w} ${box.h}" role="img" aria-label="Per-user monthly price by tier">
      ${ticks}${barEls}${xLabels}
    </svg>
    <div class="ops-legend-row">
      <span class="ops-legend-key"><span class="ops-legend-key__bar" style="background:${ORANGE}"></span>Discounted tier</span>
      <span class="ops-legend-key"><span class="ops-legend-key__bar" style="background:${COMPARE}"></span>Floor price (discount stopped)</span>
    </div>`;

  attachChartTooltip(wrap);
}

function renderMarginKpis(m, acv) {
  if (!m) {
    $('pr-margin-kpis').innerHTML = [
      kpiTile({ i: 0, label: 'Effective margin', value: '—', note: EMPTY_NOTE }),
      kpiTile({ i: 1, label: 'Your margin (year 1)', value: '—', note: EMPTY_NOTE, accent: true }),
      kpiTile({ i: 2, label: 'Attainment with this deal', value: '—', note: EMPTY_NOTE }),
    ].join('');
    $('pr-attainment-note').textContent = `${EMPTY_NOTE} to see margin.`;
    return;
  }

  const accelNote = m.accelerated
    ? 'Base + multi-year + sales accelerator'
    : m.isMultiYear ? 'Base + multi-year accelerator' : 'Base margin — flat renewal rate after year 1';

  const attainmentNote = m.attainmentWithDeal == null
    ? 'Enter your target and YTD sold above'
    : `${(m.ytdAttainment * 100).toFixed(0)}% YTD → ${(m.attainmentWithDeal * 100).toFixed(0)}% with this deal`;

  const tiles = [
    kpiTile({ i: 0, label: 'Effective margin', value: `${(m.effectiveMargin * 100).toFixed(1)}%`, note: accelNote }),
    kpiTile({ i: 1, label: 'Your margin (year 1)', value: fmtUSD0(m.yearOneMargin), note: `${fmtUSD0(acv)} ACV &times; ${(m.effectiveMargin * 100).toFixed(1)}%`, accent: true }),
  ];
  if (m.termYears > 1) {
    tiles.push(kpiTile({
      i: tiles.length,
      label: `Your margin (${m.termYears}-yr total)`,
      value: fmtUSD0(m.totalMargin),
      note: m.isMultiYear ? `Same rate locked in for all ${m.termYears} years` : 'Year 1 new + flat-rate renewal after',
      accent: true,
    }));
  }
  tiles.push(kpiTile({
    i: tiles.length,
    label: 'Attainment with this deal',
    value: m.attainmentWithDeal != null ? (m.attainmentWithDeal * 100).toFixed(0) + '%' : '—',
    note: attainmentNote,
  }));

  $('pr-margin-kpis').innerHTML = tiles.join('');
  $('pr-attainment-note').textContent = m.attainmentWithDeal == null
    ? 'Enter your target and YTD sold to see whether this deal reaches 100% attainment.'
    : `${attainmentNote}${m.accelerated ? ' — reaches 100%, sales accelerator applied.' : '.'}`;
}

function renderMarginTable(m) {
  const noTable = !m || m.years.length <= 1;
  $('pr-margin-table-section').hidden = noTable;
  if (noTable) return;

  $('pr-margin-tbody').innerHTML = m.years.map((y, i) => {
    const label = y.year === 1 ? 'Year 1 (new)' : `Year ${y.year} (renewal)`;
    return `<tr class="ops-row-in" style="--i:${i}"><td>${label}</td><td class="ops-num">${fmtUSD0(y.acv)}</td>` +
      `<td class="ops-num">${(y.rate * 100).toFixed(1)}%</td><td class="ops-num">${fmtUSD0(y.margin)}</td></tr>`;
  }).join('');

  const totalAcv = m.years.reduce((sum, y) => sum + y.acv, 0);
  $('pr-margin-f-acv').textContent = fmtUSD0(totalAcv);
  $('pr-margin-f-rate').textContent = totalAcv > 0 ? (m.totalMargin / totalAcv * 100).toFixed(1) + '%' : '—';
  $('pr-margin-f-total').textContent = fmtUSD0(m.totalMargin);
}

// ── View toggle (Admin / Rep / Partner) ──────────────────────────────────────

function applyView(view) {
  currentView = view;

  document.querySelectorAll('#pr-view-toggle .ops-period__btn').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  const isAdmin = view === 'admin';
  document.querySelectorAll('.pr-admin-only').forEach((el) => { el.hidden = !isAdmin; });
  document.querySelectorAll('.pr-partner-only').forEach((el) => { el.hidden = view !== 'partner'; });

  $('pr-customer-group').hidden = isAdmin;
  $('pr-customer-rep-wrap').hidden = view !== 'rep';
  $('pr-customer-partner').hidden = view !== 'partner';

  if (!isAdmin) {
    // Rep/Partner always quote off the standard rate card, never whatever
    // Admin happens to be testing at the moment
    $('pr-price').value = DEFAULTS.price.toFixed(2);
    $('pr-rate').value = DEFAULTS.rate;
    $('pr-tier').value = DEFAULTS.tier;
    $('pr-cap-on').checked = DEFAULTS.capOn;
    $('pr-cap').value = DEFAULTS.cap;
    $('pr-cap').disabled = !DEFAULTS.capOn;
  }

  render();
}

function wireViewToggle() {
  $('pr-view-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.ops-period__btn');
    if (!btn || btn.dataset.view === currentView) return;
    applyView(btn.dataset.view);
  });
}

// ── Customer lookup (Rep view — CRM account search) ──────────────────────────

let searchTimer = null;

function renderCustomerList(accounts) {
  const list = $('pr-customer-list');
  if (!accounts.length) {
    list.innerHTML = `<li class="ops-price-combo__empty">No matching accounts</li>`;
    list.hidden = false;
    return;
  }
  list.innerHTML = accounts.map((a) =>
    `<li class="ops-price-combo__item" data-name="${esc(a.name)}">${esc(a.name)}</li>`).join('');
  list.hidden = false;
  list.querySelectorAll('.ops-price-combo__item').forEach((li) => {
    // mousedown (not click) fires before the input's blur hides the list
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      $('pr-customer-rep').value = li.dataset.name;
      list.hidden = true;
    });
  });
}

function wireCustomerSearch(auth) {
  const input = $('pr-customer-rep');
  const list = $('pr-customer-list');

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { list.hidden = true; list.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const res = await opsFetch(`/api/ops/accounts?q=${encodeURIComponent(q)}`, auth);
      if (!res || !res.ok) return;
      const { accounts } = await res.json();
      // The field may have been cleared or the view switched away while the
      // request was in flight — don't resurrect a list nobody's looking at
      if (input.value.trim() === q && currentView === 'rep') renderCustomerList(accounts || []);
    }, 250);
  });

  input.addEventListener('focus', () => { if (list.innerHTML) list.hidden = false; });
  input.addEventListener('blur', () => {
    // Delay so a mousedown on a list item lands before the list disappears
    setTimeout(() => { list.hidden = true; }, 150);
  });
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function resetDefaults() {
  $('pr-users').value = DEFAULTS.users;
  $('pr-price').value = DEFAULTS.price.toFixed(2);
  $('pr-rate').value = DEFAULTS.rate;
  $('pr-tier').value = DEFAULTS.tier;
  $('pr-months').value = DEFAULTS.months;
  $('pr-cap-on').checked = DEFAULTS.capOn;
  $('pr-cap').value = DEFAULTS.cap;
  $('pr-cap').disabled = !DEFAULTS.capOn;
  $('pr-customer-rep').value = '';
  $('pr-customer-partner').value = '';
  $('pr-customer-list').hidden = true;
  $('pr-quota').value = '';
  $('pr-ytd').value = '';
  render();
}

function wireEvents() {
  ['pr-users', 'pr-price', 'pr-rate', 'pr-tier', 'pr-months', 'pr-cap-on', 'pr-cap', 'pr-quota', 'pr-ytd'].forEach((id) => {
    $(id).addEventListener('input', render);
  });
  $('pr-cap-on').addEventListener('change', () => { $('pr-cap').disabled = !$('pr-cap-on').checked; render(); });
  $('pr-reset').addEventListener('click', resetDefaults);
  wireViewToggle();
  // Chart redraws on resize — it's measured off the container's pixel width
  window.addEventListener('resize', render);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const auth = await initOps();
    if (!auth) return; // redirect in progress

    $('ops-user-email').textContent = auth.account.username;
    $('ops-signout').addEventListener('click', () => auth.signOut());

    $('ops-loading').hidden = true;
    $('ops-app').hidden = false;

    wireEvents();
    wireCustomerSearch(auth);
    render();
  } catch (err) {
    console.error('[ops]', err);
    $('ops-loading-msg').textContent = `Error: ${err.message}`;
    $('ops-loading').querySelector('.admin-loading__spinner')?.remove();
  }
}

main();
