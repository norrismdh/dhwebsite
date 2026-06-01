/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * Admin upload page — handles form validation, chunked multipart upload to
 * R2, and release record creation.
 *
 * Upload flow (per file):
 *   1. POST /api/upload/initiate  → { fileId, r2Key, uploadId }
 *   2. POST /api/upload/parts     → { partUrls[] }
 *   3. PUT  partUrls[n]  (browser → R2 directly, in series)
 *   4. POST /api/upload/complete  → { fileId, r2Key, filename, sizeBytes }
 *   5. POST /api/admin/releases   → persist the release record
 * ─────────────────────────────────────────────────────────────────────────── */

import { initAdmin, adminFetch } from './dhadmin.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Must match UPLOAD_CHUNK_SIZE in api/_r2.js */
const CHUNK_SIZE = 100 * 1024 * 1024; // 100 MB

// ── DOM refs ──────────────────────────────────────────────────────────────────

const loadingEl   = document.getElementById('admin-loading');
const loadingMsg  = document.getElementById('admin-loading-msg');
const appEl       = document.getElementById('admin-app');

const formPanel   = document.getElementById('form-panel');
const progPanel   = document.getElementById('progress-panel');
const successPanel= document.getElementById('success-panel');

const form        = document.getElementById('upload-form');
const submitBtn   = document.getElementById('submit-btn');
const formError   = document.getElementById('form-error');

// File zones
const winInput    = document.getElementById('f-win');
const lnxInput    = document.getElementById('f-lnx');

// Progress elements
const winProg     = document.getElementById('win-prog');
const lnxProg     = document.getElementById('lnx-prog');
const progError   = document.getElementById('progress-error');
const cancelBtn   = document.getElementById('cancel-btn');

// ── File zone wiring ──────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function wireFileZone(inputEl, zoneId, selectedId, nameId, sizeId, clearId) {
  const zone     = document.getElementById(zoneId);
  const selected = document.getElementById(selectedId);
  const nameEl   = document.getElementById(nameId);
  const sizeEl   = document.getElementById(sizeId);
  const clearEl  = document.getElementById(clearId);

  const showFile = (file) => {
    nameEl.textContent  = file.name;
    sizeEl.textContent  = formatSize(file.size);
    selected.hidden     = false;
    zone.querySelector('.file-zone__prompt').hidden = true;
    zone.classList.add('file-zone--has-file');
  };

  const clearFile = () => {
    inputEl.value       = '';
    selected.hidden     = true;
    zone.querySelector('.file-zone__prompt').hidden = false;
    zone.classList.remove('file-zone--has-file');
  };

  inputEl.addEventListener('change', () => {
    if (inputEl.files[0]) showFile(inputEl.files[0]);
    else clearFile();
  });

  clearEl.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); });

  // Drag-and-drop
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('file-zone--drag'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('file-zone--drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('file-zone--drag');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // Assign to the hidden input (best-effort — DataTransfer → FileList is read-only)
    // We store on the input's associated variable via a property instead
    inputEl._droppedFile = file;
    showFile(file);
  });
}

wireFileZone(winInput, 'win-zone', 'win-selected', 'win-name', 'win-size', 'win-clear');
wireFileZone(lnxInput, 'lnx-zone', 'lnx-selected', 'lnx-name', 'lnx-size', 'lnx-clear');

/** Get the File from an input, including drag-and-drop overrides. */
function getFile(inputEl) {
  return inputEl._droppedFile ?? inputEl.files[0] ?? null;
}

// ── Form validation ───────────────────────────────────────────────────────────

function showFormError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
  formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearFormError() { formError.hidden = true; }

function validateForm() {
  const type    = document.getElementById('f-type').value;
  const version = document.getElementById('f-version').value.trim();
  const title   = document.getElementById('f-title').value.trim();
  const winFile = getFile(winInput);
  const lnxFile = getFile(lnxInput);

  if (!['Release', 'Update', 'Hotfix'].includes(type)) {
    return 'Please select a release type.';
  }
  if (!version) return 'Version is required.';
  if (!/^\d+\.\d+(\.\d+)*$/.test(version)) {
    return 'Version must be digits and dots (e.g. 2.4.0).';
  }
  if (!title) return 'Release title is required.';
  if (!winFile && !lnxFile) {
    return 'Please add at least one file (Windows or Linux).';
  }
  return null; // valid
}

// ── Multipart upload ──────────────────────────────────────────────────────────

/** Shared abort state — set to true to cancel the active upload. */
let cancelled = false;

/** Track the active upload session for abort on cancel. */
let activeUpload = null; // { r2Key, uploadId }

function updateProgress(progEl, pctEl, fillEl, partsEl, done, total) {
  const pct = Math.round((done / total) * 100);
  pctEl.textContent  = `${pct}%`;
  fillEl.style.width = `${pct}%`;
  partsEl.textContent = `Part ${done} of ${total}`;
}

/**
 * Upload a single File via R2 multipart upload.
 * Calls onProgress(partsDone, partsTotal) after each part.
 *
 * @param {File}         file
 * @param {object}       auth   — from initAdmin()
 * @param {HTMLElement}  progEl — the .upload-prog container div to show
 * @param {string}       pctId  — id of the percentage span
 * @param {string}       fillId — id of the progress bar fill div
 * @param {string}       partsId — id of the parts label span
 * @param {string}       filenameId — id of the filename span
 * @returns {{ fileId, r2Key, filename, sizeBytes }}
 */
async function uploadFile(file, auth, progEl, pctId, fillId, partsId, filenameId) {
  const pctEl      = document.getElementById(pctId);
  const fillEl     = document.getElementById(fillId);
  const partsEl    = document.getElementById(partsId);
  const filenameEl = document.getElementById(filenameId);

  filenameEl.textContent = file.name;
  progEl.hidden = false;
  updateProgress(progEl, pctEl, fillEl, partsEl, 0, 1);
  partsEl.textContent = 'Preparing…';

  // 1. Initiate
  const initRes = await adminFetch('/api/upload/initiate', auth, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name }),
  });
  if (!initRes?.ok) throw new Error('Upload initiation failed');
  const { fileId, r2Key, uploadId } = await initRes.json();

  activeUpload = { r2Key, uploadId };

  // 2. Calculate parts
  const partCount = Math.ceil(file.size / CHUNK_SIZE);

  // 3. Get presigned URLs
  const partsRes = await adminFetch('/api/upload/parts', auth, {
    method: 'POST',
    body: JSON.stringify({ r2Key, uploadId, partCount }),
  });
  if (!partsRes?.ok) throw new Error('Failed to get upload URLs');
  const { partUrls } = await partsRes.json();

  // 4. Upload each part directly to R2 (no Vercel in the data path)
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    if (cancelled) throw Object.assign(new Error('Upload cancelled'), { cancelled: true });

    const start = i * CHUNK_SIZE;
    const end   = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const putRes = await fetch(partUrls[i], { method: 'PUT', body: chunk });
    if (!putRes.ok) {
      throw new Error(`Part ${i + 1} failed (HTTP ${putRes.status}). Check R2 CORS configuration.`);
    }

    const etag = putRes.headers.get('ETag');
    if (!etag) {
      throw new Error(`No ETag for part ${i + 1}. Ensure R2 CORS exposes the ETag header.`);
    }

    parts.push({ PartNumber: i + 1, ETag: etag });
    updateProgress(progEl, pctEl, fillEl, partsEl, i + 1, partCount);
  }

  // 5. Complete the multipart upload
  partsEl.textContent = 'Finalising…';
  const completeRes = await adminFetch('/api/upload/complete', auth, {
    method: 'POST',
    body: JSON.stringify({ r2Key, uploadId, parts, filename: file.name, sizeBytes: file.size }),
  });
  if (!completeRes?.ok) throw new Error('Upload completion step failed');

  activeUpload = null;
  return await completeRes.json(); // { fileId, r2Key, filename, sizeBytes }
}

// ── Cancel ────────────────────────────────────────────────────────────────────

async function handleCancel(auth) {
  cancelled = true;
  cancelBtn.disabled = true;
  cancelBtn.textContent = 'Cancelling…';

  if (activeUpload) {
    try {
      await adminFetch('/api/upload/abort', auth, {
        method: 'POST',
        body: JSON.stringify(activeUpload),
      });
    } catch { /* best-effort */ }
    activeUpload = null;
  }

  // Return to form
  progPanel.hidden = true;
  formPanel.hidden = false;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Upload release';
  cancelled = false;
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Cancel upload';
}

// ── Main submit handler ───────────────────────────────────────────────────────

async function handleSubmit(e, auth) {
  e.preventDefault();
  clearFormError();

  const validationError = validateForm();
  if (validationError) { showFormError(validationError); return; }

  const winFile = getFile(winInput);
  const lnxFile = getFile(lnxInput);

  const formData = {
    type:    document.getElementById('f-type').value,
    version: document.getElementById('f-version').value.trim(),
    title:   document.getElementById('f-title').value.trim(),
    notes:   document.getElementById('f-notes').value.trim(),
  };

  // Switch to progress view
  submitBtn.disabled = true;
  formPanel.hidden   = true;
  progPanel.hidden   = false;

  // Show / hide progress rows based on which files were selected
  if (!winFile) winProg.hidden = true;
  if (!lnxFile) lnxProg.hidden = true;

  document.getElementById('progress-overall-label').textContent =
    [winFile && 'Windows', lnxFile && 'Linux'].filter(Boolean).join(' + ') + ' …';

  const releaseFiles = {};

  try {
    // Upload Windows (if provided)
    if (winFile) {
      const result = await uploadFile(
        winFile, auth,
        winProg, 'win-prog-pct', 'win-prog-fill', 'win-prog-parts', 'win-prog-filename',
      );
      releaseFiles.windows = result;
    }

    // Upload Linux (if provided)
    if (!cancelled && lnxFile) {
      const result = await uploadFile(
        lnxFile, auth,
        lnxProg, 'lnx-prog-pct', 'lnx-prog-fill', 'lnx-prog-parts', 'lnx-prog-filename',
      );
      releaseFiles.linux = result;
    }

    if (cancelled) return; // User cancelled between the two uploads

    // All files uploaded — create the release record
    document.getElementById('progress-overall-label').textContent = 'Saving release…';

    const createRes = await adminFetch('/api/admin/releases', auth, {
      method: 'POST',
      body: JSON.stringify({ ...formData, files: releaseFiles }),
    });

    if (!createRes?.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(err.error ?? 'Failed to save release record');
    }

    const { release } = await createRes.json();

    // Show success
    progPanel.hidden  = true;
    successPanel.hidden = false;
    document.getElementById('success-detail').textContent =
      `${release.type} v${release.version} — ${Object.keys(release.files).join(' & ')} builds published.`;

  } catch (err) {
    if (err.cancelled) return; // Already handled by handleCancel()

    console.error('[upload]', err);

    // Abort any dangling multipart upload
    if (activeUpload) {
      adminFetch('/api/upload/abort', auth, {
        method: 'POST',
        body: JSON.stringify(activeUpload),
      }).catch(() => {});
      activeUpload = null;
    }

    progError.textContent = `Upload failed: ${err.message}`;
    progError.hidden = false;
    cancelBtn.textContent = 'Back to form';
    cancelBtn.onclick = () => {
      progPanel.hidden = true;
      formPanel.hidden = false;
      submitBtn.disabled = false;
      progError.hidden = true;
      cancelBtn.textContent = 'Cancel upload';
      cancelBtn.onclick = null;
    };
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
// Wrapped in an async function so `return` is valid (top-level return is
// illegal in ES modules).

async function main() {
  try {
    const auth = await initAdmin();
    if (!auth) return; // Redirect in progress

    loadingEl.hidden = true;
    appEl.hidden     = false;

    document.getElementById('admin-user-email').textContent = auth.account.username;
    document.getElementById('admin-signout').addEventListener('click', () => auth.signOut());

    form.addEventListener('submit', e => handleSubmit(e, auth));
    cancelBtn.addEventListener('click', () => handleCancel(auth));

  } catch (err) {
    loadingMsg.textContent = `Error: ${err.message}`;
    console.error('[dhadmin-upload]', err);
  }
}

main();
