/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * /api/admin/releases
 *
 * GET  — Returns ALL releases (including disabled) with full admin detail.
 *        Unlike the public /api/releases endpoint, r2Key is included here
 *        so the admin UI can display storage info.
 *
 * POST — Creates a new release from file metadata returned by the upload
 *        flow (/api/upload/complete).
 *
 * Both methods require a valid admin Bearer token (see _auth.js).
 * ─────────────────────────────────────────────────────────────────────────── */

import { randomBytes }            from 'crypto';
import { getReleases, saveReleases, getBucketStorageBytes } from '../_r2.js';
import { requireAdmin }           from '../_auth.js';

// ── GET ───────────────────────────────────────────────────────────────────────

async function handleGet(req, res) {
  let storageBytes = null;
  let storageLive  = false;
  const [data] = await Promise.all([
    getReleases(),
    getBucketStorageBytes()
      .then((bytes) => { storageBytes = bytes; storageLive = true; })
      .catch((err)  => { console.error('getBucketStorageBytes failed:', err.message); }),
  ]);

  // Admin view: newest first, all statuses, full fields
  const releases = (data.releases ?? [])
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ releases, storageBytes, storageLive });
}

// ── POST ──────────────────────────────────────────────────────────────────────

async function handlePost(req, res) {
  const { type, version, title, notes, files } = req.body ?? {};

  // Basic validation
  if (!type || !['Release', 'Update', 'Hotfix'].includes(type)) {
    return res.status(400).json({ error: 'type must be Release, Update, or Hotfix' });
  }
  if (!version || typeof version !== 'string' || !version.trim()) {
    return res.status(400).json({ error: 'version is required' });
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!files || typeof files !== 'object' || (!files.windows && !files.linux)) {
    return res.status(400).json({ error: 'At least one file (windows or linux) is required' });
  }

  // Validate each file entry
  for (const [os, f] of Object.entries(files)) {
    if (!['windows', 'linux'].includes(os)) {
      return res.status(400).json({ error: `Unknown OS key: ${os}` });
    }
    if (!f.fileId || !f.r2Key || !f.filename) {
      return res.status(400).json({ error: `files.${os} must include fileId, r2Key, and filename` });
    }
  }

  const data = await getReleases();

  const release = {
    id:          randomBytes(6).toString('hex'),
    type:        type.trim(),
    version:     version.trim(),
    title:       title.trim(),
    notes:       (notes ?? '').trim(),
    publishedAt: new Date().toISOString(),
    enabled:     true,
    files:       Object.fromEntries(
      Object.entries(files).map(([os, f]) => [
        os,
        {
          fileId:        f.fileId,
          r2Key:         f.r2Key,
          filename:      f.filename,
          sizeBytes:     f.sizeBytes ?? 0,
          downloadCount: 0,
        },
      ]),
    ),
  };

  data.releases = [...(data.releases ?? []), release];
  await saveReleases(data);

  return res.status(201).json({ release });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET')  return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin/releases error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
