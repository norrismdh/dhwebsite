/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * Public downloads page — fetches /api/releases and renders release cards.
 * Loaded as type="module" so it runs after the DOM is ready.
 * ─────────────────────────────────────────────────────────────────────────── */

// ── DOM refs ──────────────────────────────────────────────────────────────────

const listEl    = document.getElementById('dl-list');
const loadingEl = document.getElementById('dl-loading');
const errorEl   = document.getElementById('dl-error');
const emptyEl   = document.getElementById('dl-empty');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format raw bytes as "2.2 GB" or "850 MB". */
function formatSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.round(mb)} MB`;
}

/** Format an ISO date string as "May 15, 2026". */
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Render release notes markdown to safe HTML.
 *  Falls back to <pre> if the marked CDN script hasn't loaded. */
function renderNotes(markdown) {
  if (!markdown) return '';
  if (typeof window.marked !== 'undefined') {
    // marked v14 API: marked.parse() returns a string
    return window.marked.parse(markdown, { breaks: true, gfm: true });
  }
  // Graceful fallback — preserve line breaks as <br>
  const escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="white-space:pre-wrap;font-family:inherit">${escaped}</pre>`;
}

/** CSS class for the release type badge. */
function badgeClass(type) {
  return { Release: 'dl-badge--release', Update: 'dl-badge--update', Hotfix: 'dl-badge--hotfix' }[type]
    ?? 'dl-badge--release';
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

const WIN_SVG = `<svg class="dl-btn__icon" width="15" height="15" viewBox="0 0 23 23" fill="currentColor" aria-hidden="true">
  <path d="M0 3.4 9.9 2v9.6H0V3.4zm10.9-1.5L23 0v11.5H10.9V1.9zm-10.9 10 9.9.1v9.5L0 19.6v-8.1zm10.9.2H23V22l-13.1 1.9v-10.2z"/>
</svg>`;

const LNX_SVG = `<svg class="dl-btn__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="2" y="3" width="20" height="14" rx="2"/>
  <polyline points="8 21 12 17 16 21"/>
  <line x1="5" y1="10" x2="7" y2="10"/>
  <polyline points="5 13 5 8 7 10"/>
</svg>`;

// ── Card renderer ─────────────────────────────────────────────────────────────

function renderCard(release) {
  const { id, type, version, title, notes, publishedAt, files } = release;

  const winFile = files?.windows;
  const lnxFile = files?.linux;

  const winBtn = winFile
    ? `<a class="dl-btn" href="/downloads/${winFile.fileId}" aria-label="Download ${title} for Windows (${formatSize(winFile.sizeBytes)})">
        ${WIN_SVG}
        <span class="dl-btn__label">Windows</span>
        <span class="dl-btn__size">${formatSize(winFile.sizeBytes)}</span>
      </a>`
    : '';

  const lnxBtn = lnxFile
    ? `<a class="dl-btn dl-btn--ghost" href="/downloads/${lnxFile.fileId}" aria-label="Download ${title} for Linux (${formatSize(lnxFile.sizeBytes)})">
        ${LNX_SVG}
        <span class="dl-btn__label">Linux</span>
        <span class="dl-btn__size">${formatSize(lnxFile.sizeBytes)}</span>
      </a>`
    : '';

  const notesHtml = notes
    ? `<div class="dl-card__notes">${renderNotes(notes)}</div>`
    : '';

  return `
    <article class="dl-card" role="listitem" data-release-id="${id}">
      <header class="dl-card__header">
        <div class="dl-card__meta-row">
          <span class="dl-badge ${badgeClass(type)}">${type}</span>
          <span class="dl-card__version">v${version}</span>
          <time class="dl-card__date" datetime="${publishedAt}">${formatDate(publishedAt)}</time>
        </div>
        <h2 class="dl-card__title">${title}</h2>
      </header>
      ${notesHtml}
      <footer class="dl-card__files">
        ${winBtn}
        ${lnxBtn}
      </footer>
    </article>`;
}

// ── EULA modal ────────────────────────────────────────────────────────────────

const eulaModal   = document.getElementById('eula-modal');
const eulaAccept  = document.getElementById('eula-accept');
const eulaDecline = document.getElementById('eula-decline');

let pendingDownloadUrl = null;

function openEula(url) {
  pendingDownloadUrl = url;
  eulaModal.hidden   = false;
  document.body.style.overflow = 'hidden';
  eulaAccept.focus();
}

function closeEula() {
  eulaModal.hidden   = true;
  pendingDownloadUrl = null;
  document.body.style.overflow = '';
}

eulaAccept.addEventListener('click', () => {
  const url = pendingDownloadUrl;
  closeEula();
  if (url) window.location.href = url;
});

eulaDecline.addEventListener('click', closeEula);

// Close on backdrop click or Escape
eulaModal.addEventListener('click', (e) => { if (e.target === eulaModal) closeEula(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !eulaModal.hidden) closeEula(); });

// ── Main ──────────────────────────────────────────────────────────────────────

async function loadReleases() {
  try {
    const res = await fetch('/api/releases');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { releases } = await res.json();

    loadingEl.hidden = true;

    if (!releases.length) {
      emptyEl.hidden = false;
      return;
    }

    listEl.innerHTML = releases.map(renderCard).join('');

    // Intercept all download button clicks — show EULA before navigating
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.dl-btn');
      if (!btn) return;
      e.preventDefault();
      openEula(btn.href);
    });

  } catch (err) {
    console.error('[downloads]', err.message);
    loadingEl.hidden = true;
    errorEl.hidden   = false;
  }
}

loadReleases();
