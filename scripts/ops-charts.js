/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * Small SVG chart builders for the Ops pages.
 *
 * Deliberately dependency-free: these return SVG markup strings, so pages stay
 * self-contained (no CDN charting library, nothing for the CSP to allow) and
 * match the hand-rolled donut already used on the CRM dashboard.
 * Styling hooks live in styles/ops.css (.ops-chart*, .ops-legend-*).
 *
 * Charts carry per-slot hover targets with a JSON breakdown, which
 * attachChartTooltip() turns into a styled tooltip. Native SVG <title> is not
 * used: it is slow to appear, unstyleable, and can only show a single line, so
 * it cannot list every contributor behind a stacked bar.
 *
 * Exports: PALETTE, NAVY, ORANGE, comboChart, stackedChart, attachChartTooltip
 * ─────────────────────────────────────────────────────────────────────────── */

// Categorical palette (brand tokens resolved to hex for SVG fills)
export const PALETTE = ['#193359', '#F39235', '#FAB400', '#3C5A88', '#708795', '#FFCF00', '#A4B2BC', '#0E1F39'];
export const NAVY   = '#193359';
export const ORANGE = '#F39235';

const CHART = { w: 640, h: 190, padX: 10, padTop: 26, padBottom: 24 };

const fmtInt = (n) => (n ?? 0).toLocaleString('en-US');

/**
 * Measure a container so charts can be drawn at 1 SVG unit = 1 CSS pixel.
 * Without this the viewBox has to be stretched to fit, which distorts the
 * label text; sizing to the container keeps text crisp AND lets the chart use
 * the full height it has been given.
 */
export function chartBox(el, { height } = {}) {
  // clientWidth includes padding, but the SVG renders at 100% of the CONTENT
  // box — using the padded width would squash the viewBox horizontally and
  // distort the label text, so subtract the padding.
  let w = el?.clientWidth || 0;
  if (el) {
    const cs = getComputedStyle(el);
    w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  }
  return {
    w: Math.max(Math.round(w), 280),
    h: Math.max(Math.round(height || CHART.h), 120),
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Shared geometry for a categorical chart with `n` slots. */
function chartGeom(n, box) {
  const { padX, padTop, padBottom } = CHART;
  const w = box?.w ?? CHART.w;
  const h = box?.h ?? CHART.h;
  const plotW = w - padX * 2;
  const plotH = h - padTop - padBottom;
  const slot = plotW / Math.max(n, 1);
  return { w, h, padX, padTop, plotH, slot, centre: (i) => padX + slot * (i + 0.5) };
}

/** A line + dots overlay for a comparison series (e.g. same months last year). */
function overlayLine(months, g, values, y) {
  if (!values.some((v) => v > 0)) return '';
  const pts = months.map((m, i) => `${g.centre(i).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ');
  return `<polyline class="ops-chart__line" style="--i:${months.length}" points="${pts}" fill="none"
      stroke="${ORANGE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${months.map((m, i) => `<circle class="ops-chart__dot" style="--i:${i}" cx="${g.centre(i).toFixed(1)}"
      cy="${y(values[i]).toFixed(1)}" r="3" fill="var(--bg-2)" stroke="${ORANGE}" stroke-width="2" />`).join('')}`;
}

function monthLabels(months, g) {
  return months.map((m, i) => `<text x="${g.centre(i).toFixed(1)}" y="${g.h - 8}"
    text-anchor="middle" class="ops-chart__lbl${i === months.length - 1 ? ' is-current' : ''}">${esc(m.label)}</text>`).join('');
}

const baseline = (g) =>
  `<line x1="${g.padX}" y1="${g.padTop + g.plotH}" x2="${g.w - g.padX}" y2="${g.padTop + g.plotH}" class="ops-chart__axis" />`;

/**
 * Full-height, invisible hover target per slot. `rows` is the breakdown shown in
 * the tooltip: [{ name, value, color }]. Stored as JSON on the element so the
 * tooltip needs no closure over chart state.
 */
function hitSlots(months, g, rowsFor) {
  return months.map((m, i) => {
    const payload = {
      title: `${m.label} ${m.year}`,
      rows: rowsFor(i),
    };
    return `<g class="ops-chart__slot" data-slot="${i}" data-tip="${esc(JSON.stringify(payload))}">
      <rect class="ops-chart__hit-bg" x="${(g.padX + g.slot * i).toFixed(1)}" y="${g.padTop}"
            width="${g.slot.toFixed(1)}" height="${g.plotH}" rx="3" />
      <rect class="ops-chart__hit" x="${(g.padX + g.slot * i).toFixed(1)}" y="${g.padTop}"
            width="${g.slot.toFixed(1)}" height="${g.plotH}" />
    </g>`;
  }).join('');
}

/**
 * Bars for the selected period with a line overlaid for the same period a year
 * earlier. One SVG, so the line lands exactly on the bar centres.
 *
 * @param {{months: Array<{label:string,year:number}>, bars:number[], line:number[], label:string}} o
 * @returns {string} SVG + legend markup
 */
export function comboChart({ months, bars, line, label, box }) {
  const g = chartGeom(months.length, box);
  const safeBars = months.map((_, i) => Number(bars?.[i]) || 0);
  const safeLine = months.map((_, i) => Number(line?.[i]) || 0);
  const max = Math.max(...safeBars, ...safeLine, 1);
  const y = (v) => g.padTop + g.plotH * (1 - v / max);
  const barW = Math.min(g.slot * 0.5, 34);

  const barEls = months.map((m, i) => {
    const vy = y(safeBars[i]);
    return `<rect class="ops-chart__bar" style="--i:${i}" x="${(g.centre(i) - barW / 2).toFixed(1)}" y="${vy.toFixed(1)}"
      width="${barW.toFixed(1)}" height="${(g.padTop + g.plotH - vy).toFixed(1)}"
      rx="3" fill="${NAVY}" />`;
  }).join('');

  const valEls = months.map((m, i) => safeBars[i]
    ? `<text class="ops-chart__val" style="--i:${i}" x="${g.centre(i).toFixed(1)}" y="${(y(safeBars[i]) - 6).toFixed(1)}" text-anchor="middle">${fmtInt(safeBars[i])}</text>`
    : '').join('');

  const hasLine = safeLine.some((v) => v > 0);
  const lineEls = overlayLine(months, g, safeLine, y);

  const hits = hitSlots(months, g, (i) => [
    { name: 'This period', value: fmtInt(safeBars[i]), color: NAVY },
    ...(hasLine ? [{ name: 'Same month last year', value: fmtInt(safeLine[i]), color: ORANGE }] : []),
  ]);

  return `
    <svg class="ops-chart" style="height:${g.h}px" viewBox="0 0 ${g.w} ${g.h}" role="img" aria-label="${esc(label)}">
      ${baseline(g)}${barEls}${valEls}${lineEls}${monthLabels(months, g)}${hits}
    </svg>
    <div class="ops-legend-row">
      <span class="ops-legend-key"><span class="ops-legend-key__bar" style="background:${NAVY}"></span>This period</span>
      ${hasLine ? `<span class="ops-legend-key"><span class="ops-legend-key__line" style="background:${ORANGE}"></span>Same period last year</span>` : ''}
    </div>`;
}

/**
 * Stacked bars per month, one colour per key (e.g. KB contributors), + legend.
 *
 * @param {{months: Array<{label:string,year:number}>, keys:string[], series:Record<string,number[]>, label:string}} o
 * @returns {string} SVG + legend markup
 */
export function stackedChart({ months, keys, series, label, box, line }) {
  const g = chartGeom(months.length, box);
  const at = (k, i) => Number(series?.[k]?.[i]) || 0;
  const totals = months.map((_, i) => keys.reduce((s, k) => s + at(k, i), 0));
  // The comparison line shares the stack's scale, so it must be in the max
  const safeLine = months.map((_, i) => Number(line?.[i]) || 0);
  const max = Math.max(...totals, ...safeLine, 1);
  const yFor = (v) => g.padTop + g.plotH * (1 - v / max);
  const barW = Math.min(g.slot * 0.55, 34);

  const stacks = months.map((m, i) => {
    let acc = 0;
    // Each month's stack is one group so it grows from the baseline as a unit,
    // rather than each segment scaling independently and tearing apart.
    const segs = keys.map((k, ki) => {
      const v = at(k, i);
      if (!v) return '';
      const hPx = (v / max) * g.plotH;
      const yTop = g.padTop + g.plotH - acc - hPx;
      acc += hPx;
      return `<rect x="${(g.centre(i) - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}"
        width="${barW.toFixed(1)}" height="${hPx.toFixed(1)}"
        fill="${PALETTE[ki % PALETTE.length]}" />`;
    }).join('');
    const totalLbl = totals[i]
      ? `<text class="ops-chart__val" style="--i:${i}" x="${g.centre(i).toFixed(1)}" y="${(g.padTop + g.plotH - acc - 6).toFixed(1)}" text-anchor="middle">${fmtInt(totals[i])}</text>`
      : '';
    return `<g class="ops-chart__bar" style="--i:${i}">${segs}</g>${totalLbl}`;
  }).join('');

  // Tooltip lists EVERY contributor for the month, with their actual counts —
  // including the ones who wrote nothing, so absence is visible too.
  const hasLine = safeLine.some((v) => v > 0);
  const lineEls = overlayLine(months, g, safeLine, yFor);

  const hits = hitSlots(months, g, (i) => [
    ...keys.map((k, ki) => ({ name: k, value: fmtInt(at(k, i)), color: PALETTE[ki % PALETTE.length], muted: at(k, i) === 0 })),
    { name: 'Total', value: fmtInt(totals[i]), total: true },
    ...(hasLine ? [{ name: 'Same month last year', value: fmtInt(safeLine[i]), color: ORANGE }] : []),
  ]);

  return `
    <svg class="ops-chart" style="height:${g.h}px" viewBox="0 0 ${g.w} ${g.h}" role="img" aria-label="${esc(label)}">
      ${baseline(g)}${stacks}${lineEls}${monthLabels(months, g)}${hits}
    </svg>
    <div class="ops-legend-row">
      ${keys.map((k, ki) => `<span class="ops-legend-key"><span class="ops-legend-key__bar" style="background:${PALETTE[ki % PALETTE.length]}"></span>${esc(k)}</span>`).join('')}
      ${hasLine ? `<span class="ops-legend-key"><span class="ops-legend-key__line" style="background:${ORANGE}"></span>Same period last year</span>` : ''}
    </div>`;
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

let tipEl = null;
let hideTimer = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'ops-tip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  return tipEl;
}

function tipHtml({ title, rows }) {
  const body = (rows ?? []).map((r) => `
    <div class="ops-tip__row${r.total ? ' ops-tip__total' : ''}" ${r.muted ? 'style="opacity:.55"' : ''}>
      ${r.color ? `<span class="ops-tip__dot" style="background:${r.color}"></span>` : '<span style="width:8px"></span>'}
      <span class="ops-tip__name">${esc(r.name)}</span>
      <span class="ops-tip__val">${esc(r.value)}</span>
    </div>`).join('');
  return `<div class="ops-tip__head">${esc(title)}</div>${body || '<div class="ops-tip__empty">No data</div>'}`;
}

/** Position above the hovered slot, clamped into the viewport. */
function placeTip(tip, rect) {
  const GAP = 10, M = 8;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.min(Math.max(left, M), window.innerWidth - w - M);
  let top = rect.top - h - GAP;
  if (top < M) top = rect.bottom + GAP;          // no room above → flip below
  tip.style.transform = '';                       // let the class drive it
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

/**
 * Wire chart tooltips inside `root`. Idempotent per render: call it after
 * replacing innerHTML. Hovering a month shows its full breakdown; moving to an
 * adjacent month retargets instantly (no re-animation), which keeps sweeping
 * across a chart feeling immediate rather than stuttery.
 */
export function attachChartTooltip(root) {
  if (!root) return;
  // Hover-only affordance: coarse pointers get the numbers printed on the chart.
  if (!window.matchMedia?.('(hover: hover)').matches) return;

  const tip = ensureTip();
  let current = null;

  root.addEventListener('mouseover', (e) => {
    const slot = e.target.closest?.('.ops-chart__slot');
    if (!slot || slot === current) return;

    let payload;
    try { payload = JSON.parse(slot.dataset.tip); } catch { return; }

    const wasOpen = tip.classList.contains('is-open');
    current?.classList.remove('is-hovered');
    slot.classList.add('is-hovered');
    current = slot;

    clearTimeout(hideTimer);
    tip.classList.toggle('is-instant', wasOpen);
    tip.innerHTML = tipHtml(payload);
    placeTip(tip, slot.getBoundingClientRect());
    tip.classList.add('is-open');
  });

  root.addEventListener('mouseleave', () => {
    current?.classList.remove('is-hovered');
    current = null;
    // Small grace period so moving between charts doesn't flash it shut
    hideTimer = setTimeout(() => {
      tip.classList.remove('is-open', 'is-instant');
    }, 80);
  });
}
