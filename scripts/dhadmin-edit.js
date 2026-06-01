/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * Admin edit-release page.
 * Loads a single release by ?id=, populates form fields, handles:
 *   - Save (PUT editable fields)
 *   - Enable / Disable toggle (PUT { enabled })
 *   - Delete (DELETE + modal confirmation → redirect)
 * ─────────────────────────────────────────────────────────────────────────── */

import { initAdmin, adminFetch } from './dhadmin.js';

// ── Release ID from URL ───────────────────────────────────────────────────────

const releaseId = new URLSearchParams(window.location.search).get('id');

// ── DOM refs ──────────────────────────────────────────────────────────────────

const loadingEl   = document.getElementById('admin-loading');
const loadingMsg  = document.getElementById('admin-loading-msg');
const appEl       = document.getElementById('admin-app');

const pageTitle   = document.getElementById('page-title');
const statusBadge = document.getElementById('status-badge');
const toggleBtn   = document.getElementById('toggle-btn');

const saveBanner  = document.getElementById('save-banner');
const editForm    = document.getElementById('edit-form');
const formError   = document.getElementById('form-error');
const saveBtn     = document.getElementById('save-btn');
const filesPanelBody = document.getElementById('files-panel-body');

const deleteBtn   = document.getElementById('delete-btn');
const deleteModal = document.getElementById('delete-modal');
const modalVersionHint  = document.getElementById('modal-version-hint');
const modalConfirmInput = document.getElementById('modal-confirm-input');
const modalError  = document.getElementById('modal-error');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalDeleteBtn = document.getElementById('modal-delete-btn');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (!bytes) return '—';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 ** 2))} MB`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function showSaveBanner(msg, isError = false) {
  saveBanner.textContent = msg;
  saveBanner.className   = `save-banner${isError ? ' save-banner--error' : ''}`;
  saveBanner.hidden      = false;
  saveBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (!isError) setTimeout(() => { saveBanner.hidden = true; }, 4000);
}

function setStatus(enabled) {
  statusBadge.innerHTML = enabled
    ? `<span class="admin-status admin-status--on"><span class="admin-status__dot"></span>Active</span>`
    : `<span class="admin-status admin-status--off"><span class="admin-status__dot"></span>Disabled</span>`;

  toggleBtn.textContent    = enabled ? 'Disable' : 'Enable';
  toggleBtn.dataset.state  = enabled ? 'enabled' : 'disabled';
}

// ── Populate form ─────────────────────────────────────────────────────────────

function populateForm(release) {
  pageTitle.textContent = `Edit — ${release.type} v${release.version}`;
  document.title        = `Edit v${release.version} — Downloads Admin — Digital Hive`;

  document.getElementById('f-type').value    = release.type;
  document.getElementById('f-version').value = release.version;
  document.getElementById('f-title').value   = release.title;
  document.getElementById('f-notes').value   = release.notes ?? '';

  setStatus(release.enabled);

  // Files section (read-only)
  const files = Object.entries(release.files ?? {});
  if (!files.length) {
    filesPanelBody.innerHTML = `<p style="color:var(--fg-3);margin:0">No files attached to this release.</p>`;
    return;
  }

  const OS_LABEL = { windows: 'Windows', linux: 'Linux' };
  const WIN_ICON = `<svg width="15" height="15" viewBox="0 0 23 23" fill="currentColor" aria-hidden="true"><path d="M0 3.4 9.9 2v9.6H0V3.4zm10.9-1.5L23 0v11.5H10.9V1.9zm-10.9 10 9.9.1v9.5L0 19.6v-8.1zm10.9.2H23V22l-13.1 1.9v-10.2z"/></svg>`;
  const LNX_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/><line x1="5" y1="10" x2="7" y2="10"/><polyline points="5 13 5 8 7 10"/></svg>`;

  filesPanelBody.innerHTML = files.map(([os, f]) => `
    <div class="file-info-row">
      <div class="file-info-row__icon">${os === 'windows' ? WIN_ICON : LNX_ICON}</div>
      <div class="file-info-row__detail">
        <span class="file-info-row__os">${OS_LABEL[os] ?? os}</span>
        <span class="file-info-row__name">${f.filename}</span>
        <span class="file-info-row__meta">${formatSize(f.sizeBytes)} &bull; ${f.downloadCount ?? 0} download${f.downloadCount === 1 ? '' : 's'}</span>
        <span class="file-info-row__key">${f.r2Key}</span>
      </div>
    </div>`).join('');
}

// ── Save handler ──────────────────────────────────────────────────────────────

async function handleSave(e, auth) {
  e.preventDefault();
  formError.hidden = true;

  const type    = document.getElementById('f-type').value;
  const version = document.getElementById('f-version').value.trim();
  const title   = document.getElementById('f-title').value.trim();
  const notes   = document.getElementById('f-notes').value.trim();

  if (!version) { formError.textContent = 'Version is required.'; formError.hidden = false; return; }
  if (!/^\d+\.\d+(\.\d+)*$/.test(version)) {
    formError.textContent = 'Version must be digits and dots (e.g. 2.4.0).';
    formError.hidden = false; return;
  }
  if (!title) { formError.textContent = 'Title is required.'; formError.hidden = false; return; }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const res = await adminFetch(`/api/admin/release/${releaseId}`, auth, {
      method: 'PUT',
      body: JSON.stringify({ type, version, title, notes }),
    });

    if (!res?.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    const { release } = await res.json();
    populateForm(release); // Re-populate with server-confirmed values
    showSaveBanner('Changes saved successfully.');
  } catch (err) {
    showSaveBanner(`Save failed: ${err.message}`, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save changes';
  }
}

// ── Enable / Disable toggle ───────────────────────────────────────────────────

async function handleToggle(auth) {
  const currentlyEnabled = toggleBtn.dataset.state === 'enabled';
  toggleBtn.disabled = true;

  try {
    const res = await adminFetch(`/api/admin/release/${releaseId}`, auth, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !currentlyEnabled }),
    });

    if (!res?.ok) throw new Error(`HTTP ${res.status}`);
    const { release } = await res.json();

    setStatus(release.enabled);
    showSaveBanner(release.enabled ? 'Release is now active.' : 'Release has been disabled.');
  } catch (err) {
    showSaveBanner(`Toggle failed: ${err.message}`, true);
  } finally {
    toggleBtn.disabled = false;
  }
}

// ── Delete flow ───────────────────────────────────────────────────────────────

function openDeleteModal(version) {
  modalVersionHint.textContent = `v${version}`;
  modalConfirmInput.value = '';
  modalDeleteBtn.disabled = true;
  modalError.hidden = true;
  deleteModal.hidden = false;
  modalConfirmInput.focus();
}

function closeDeleteModal() {
  deleteModal.hidden = true;
  modalConfirmInput.value = '';
}

async function handleDeleteConfirm(auth, version) {
  modalDeleteBtn.disabled = true;
  modalDeleteBtn.textContent = 'Deleting…';
  modalError.hidden = true;

  try {
    const res = await adminFetch(`/api/admin/release/${releaseId}`, auth, {
      method: 'DELETE',
    });

    if (!res?.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    window.location.href = '/dhadmin';
  } catch (err) {
    modalError.textContent = `Delete failed: ${err.message}`;
    modalError.hidden = false;
    modalDeleteBtn.disabled = false;
    modalDeleteBtn.textContent = 'Delete permanently';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

try {
  if (!releaseId) {
    loadingMsg.textContent = 'No release ID in URL. Go back and click Edit on a release.';
    throw new Error('missing id');
  }

  const auth = await initAdmin();
  if (!auth) throw new Error('auth redirect');

  // Fetch the release
  const res = await adminFetch(`/api/admin/release/${releaseId}`, auth);
  if (!res?.ok) {
    const status = res?.status ?? '?';
    throw new Error(status === 404 ? `Release "${releaseId}" not found.` : `HTTP ${status}`);
  }
  const { release } = await res.json();

  // Show the page
  loadingEl.hidden = true;
  appEl.hidden     = false;

  document.getElementById('admin-user-email').textContent = auth.account.username;
  document.getElementById('admin-signout').addEventListener('click', () => auth.signOut());

  populateForm(release);

  // Wire up form save
  editForm.addEventListener('submit', e => handleSave(e, auth));

  // Wire up toggle
  toggleBtn.addEventListener('click', () => handleToggle(auth));

  // Wire up delete button → open modal
  deleteBtn.addEventListener('click', () => openDeleteModal(release.version));

  // Modal: cancel
  modalCancelBtn.addEventListener('click', closeDeleteModal);
  deleteModal.addEventListener('click', e => { if (e.target === deleteModal) closeDeleteModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !deleteModal.hidden) closeDeleteModal(); });

  // Modal: enable Delete button only when the version is typed correctly
  modalConfirmInput.addEventListener('input', () => {
    modalDeleteBtn.disabled =
      modalConfirmInput.value.trim() !== release.version &&
      modalConfirmInput.value.trim() !== `v${release.version}`;
  });

  // Modal: confirm delete
  modalDeleteBtn.addEventListener('click', () => handleDeleteConfirm(auth, release.version));

} catch (err) {
  if (err.message !== 'auth redirect') {
    loadingMsg.textContent = `Error: ${err.message}`;
  }
  console.error('[dhadmin-edit]', err);
}
