/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * Small SVG chart builders for the Ops pages.
 *
 * Deliberately dependency-free: these return SVG markup strings, so pages stay
 * self-contained (no CDN charting library, nothing for the CSP to allow) and
 * match the hand-rolled donut already used on the CRM dashboard.
 * Styling hooks live in styles/ops.css (.ops-chart*, .ops-legend-*).
 *
 * Exports: PALETTE, NAVY, ORANGE, comboChart, stackedChart
 * ─────────────────────────────────────────────────────────────────────────── */

// Categorical palette (brand tokens resolved to hex for SVG fills)
export const PALETTE = ['#193359', '#F39235', '#FAB400', '#3C5A88', '#708795', '#FFCF00', '#A4B2BC', '#0E1F39'];
export const NAVY   = '#193359';
export const ORANGE = '#F39235';

const CHART = { w: 640, h: 190, padX: 10, padTop: 26, padBottom: 24 };

const fmtInt = (n) => (n ?? 0).toLocaleString('en-US');

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Shared geometry for a categorical chart with `n` slots. */
function chartGeom(n) {
  const { w, h, padX, padTop, padBottom } = CHART;
  const plotW = w - padX * 2;
  const plotH = h - padTop - padBottom;
  const slot = plotW / Math.max(n, 1);
  return { w, h, padX, padTop, plotH, slot, centre: (i) => padX + slot * (i + 0.5) };
}

function monthLabels(months, g) {
  return months.map((m, i) => `<text x="${g.centre(i).toFixed(1)}" y="${g.h - 8}"
    text-anchor="middle" class="ops-chart__lbl${i === months.length - 1 ? ' is-current' : ''}">${esc(m.label)}</text>`).join('');
}

const baseline = (g) =>
  `<line x1="${g.padX}" y1="${g.padTop + g.plotH}" x2="${g.w - g.padX}" y2="${g.padTop + g.plotH}" class="ops-chart__axis" />`;

/**
 * Bars for the selected period with a line overlaid for the same period a year
 * earlier. One SVG, so the line lands exactly on the bar centres.
 *
 * @param {{months: Array<{label:string,year:number}>, bars:number[], line:number[], label:string}} o
 * @returns {string} SVG + legend markup
 */
export function comboChart({ months, bars, line, label }) {
  const g = chartGeom(months.length);
  const safeBars = months.map((_, i) => Number(bars?.[i]) || 0);
  const safeLine = months.map((_, i) => Number(line?.[i]) || 0);
  const max = Math.max(...safeBars, ...safeLine, 1);
  const y = (v) => g.padTop + g.plotH * (1 - v / max);
  const barW = Math.min(g.slot * 0.5, 34);

  const barEls = months.map((m, i) => {
    const vy = y(safeBars[i]);
    return `<rect x="${(g.centre(i) - barW / 2).toFixed(1)}" y="${vy.toFixed(1)}"
      width="${barW.toFixed(1)}" height="${(g.padTop + g.plotH - vy).toFixed(1)}"
      rx="3" fill="${NAVY}"><title>${esc(m.label)} ${m.year}: ${fmtInt(safeBars[i])}</title></rect>`;
  }).join('');

  const valEls = months.map((m, i) => safeBars[i]
    ? `<text x="${g.centre(i).toFixed(1)}" y="${(y(safeBars[i]) - 6).toFixed(1)}" text-anchor="middle" class="ops-chart__val">${fmtInt(safeBars[i])}</text>`
    : '').join('');

  const hasLine = safeLine.some((v) => v > 0);
  const pts = months.map((m, i) => `${g.centre(i).toFixed(1)},${y(safeLine[i]).toFixed(1)}`).join(' ');
  const lineEls = hasLine
    ? `<polyline points="${pts}" fill="none" stroke="${ORANGE}" stroke-width="2"
         stroke-linejoin="round" stroke-linecap="round" />
       ${months.map((m, i) => `<circle cx="${g.centre(i).toFixed(1)}" cy="${y(safeLine[i]).toFixed(1)}" r="3"
         fill="var(--bg-2)" stroke="${ORANGE}" stroke-width="2"><title>${esc(m.label)} ${m.year - 1}: ${fmtInt(safeLine[i])}</title></circle>`).join('')}`
    : '';

  return `
    <svg class="ops-chart" viewBox="0 0 ${g.w} ${g.h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">
      ${baseline(g)}${barEls}${valEls}${lineEls}${monthLabels(months, g)}
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
export function stackedChart({ months, keys, series, label }) {
  const g = chartGeom(months.length);
  const at = (k, i) => Number(series?.[k]?.[i]) || 0;
  const totals = months.map((_, i) => keys.reduce((s, k) => s + at(k, i), 0));
  const max = Math.max(...totals, 1);
  const barW = Math.min(g.slot * 0.55, 34);

  const stacks = months.map((m, i) => {
    let acc = 0;
    const segs = keys.map((k, ki) => {
      const v = at(k, i);
      if (!v) return '';
      const hPx = (v / max) * g.plotH;
      const yTop = g.padTop + g.plotH - acc - hPx;
      acc += hPx;
      return `<rect x="${(g.centre(i) - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}"
        width="${barW.toFixed(1)}" height="${hPx.toFixed(1)}"
        fill="${PALETTE[ki % PALETTE.length]}"><title>${esc(k)} — ${esc(m.label)} ${m.year}: ${fmtInt(v)}</title></rect>`;
    }).join('');
    const totalLbl = totals[i]
      ? `<text x="${g.centre(i).toFixed(1)}" y="${(g.padTop + g.plotH - acc - 6).toFixed(1)}" text-anchor="middle" class="ops-chart__val">${fmtInt(totals[i])}</text>`
      : '';
    return segs + totalLbl;
  }).join('');

  return `
    <svg class="ops-chart" viewBox="0 0 ${g.w} ${g.h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">
      ${baseline(g)}${stacks}${monthLabels(months, g)}
    </svg>
    <div class="ops-legend-row">
      ${keys.map((k, ki) => `<span class="ops-legend-key"><span class="ops-legend-key__bar" style="background:${PALETTE[ki % PALETTE.length]}"></span>${esc(k)}</span>`).join('')}
    </div>`;
}
