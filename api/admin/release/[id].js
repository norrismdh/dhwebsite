/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * /api/admin/release/:id
 *
 * GET    — Fetch a single release (full detail, admin view).
 * PUT    — Update editable fields: type, version, title, notes, enabled.
 *          Files cannot be changed after upload — use a new release for that.
 * DELETE — Remove the release record and delete all associated R2 files.
 *
 * All methods require a valid admin Bearer token (see _auth.js).
 * ─────────────────────────────────────────────────────────────────────────── */

import { getReleases, saveReleases, deleteFile } from '../../_r2.js';
import { requireAdmin }                          from '../../_auth.js';

// ── GET ───────────────────────────────────────────────────────────────────────

async function handleGet(req, res) {
  const { id } = req.query;
  const data   = await getReleases();
  const release = (data.releases ?? []).find(r => r.id === id);

  if (!release) return res.status(404).json({ error: 'Release not found' });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ release });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

async function handlePut(req, res) {
  const { id } = req.query;
  const { type, version, title, notes, enabled } = req.body ?? {};

  const data = await getReleases();
  const idx  = (data.releases ?? []).findIndex(r => r.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Release not found' });

  const release = { ...data.releases[idx] };

  if (type !== undefined) {
    if (!['Release', 'Update', 'Hotfix'].includes(type)) {
      return res.status(400).json({ error: 'type must be Release, Update, or Hotfix' });
    }
    release.type = type;
  }

  if (version !== undefined) {
    const v = String(version ?? '').trim();
    if (!v) return res.status(400).json({ error: 'version must not be empty' });
    release.version = v;
  }

  if (title !== undefined) {
    const t = String(title ?? '').trim();
    if (!t) return res.status(400).json({ error: 'title must not be empty' });
    release.title = t;
  }

  if (notes !== undefined) {
    release.notes = String(notes ?? '').trim();
  }

  if (enabled !== undefined) {
    release.enabled = Boolean(enabled);
  }

  data.releases[idx] = release;
  await saveReleases(data);

  return res.status(200).json({ release });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

async function handleDelete(req, res) {
  const { id } = req.query;

  const data = await getReleases();
  const idx  = (data.releases ?? []).findIndex(r => r.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Release not found' });

  const release = data.releases[idx];

  // Delete R2 files — log failures but don't block manifest cleanup
  const warnings = [];
  for (const [os, file] of Object.entries(release.files ?? {})) {
    try {
      await deleteFile(file.r2Key);
    } catch (err) {
      const msg = `Could not delete ${os} file (${file.r2Key}): ${err.message}`;
      warnings.push(msg);
      console.error('release DELETE file error:', msg);
    }
  }

  // Remove from manifest regardless of file-deletion errors
  data.releases.splice(idx, 1);
  await saveReleases(data);

  return res.status(200).json({ success: true, ...(warnings.length && { warnings }) });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET')    return await handleGet(req, res);
    if (req.method === 'PUT')    return await handlePut(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(`admin/release/${req.query.id} error:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
