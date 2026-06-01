/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * POST /api/upload/initiate
 * Step 1 of 3 in the multipart upload flow.
 * Creates an R2 multipart upload session and returns the IDs the browser
 * needs to request presigned part URLs.
 *
 * Request body:  { filename: "DHPlatform-2.4.0-win64.exe" }
 * Response:      { fileId, r2Key, uploadId }
 * ─────────────────────────────────────────────────────────────────────────── */

import { randomBytes }              from 'crypto';
import { initiateMultipartUpload }  from '../_r2.js';
import { requireAdmin }             from '../_auth.js';

/** Map common file extensions to MIME types for R2 Content-Type. */
const MIME = {
  exe:      'application/vnd.microsoft.portable-executable',
  msi:      'application/x-msi',
  gz:       'application/gzip',
  deb:      'application/vnd.debian.binary-package',
  rpm:      'application/x-rpm',
  AppImage: 'application/octet-stream',
  dmg:      'application/x-apple-diskimage',
};

/** Handle compound extensions like .tar.gz, .tar.xz */
function getExt(filename) {
  if (filename.endsWith('.tar.gz'))  return 'tar.gz';
  if (filename.endsWith('.tar.xz'))  return 'tar.xz';
  if (filename.endsWith('.tar.bz2')) return 'tar.bz2';
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'bin';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;

  const { filename } = req.body ?? {};
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename is required' });
  }

  const ext         = getExt(filename.trim());
  const contentType = MIME[ext.split('.').pop()] ?? 'application/octet-stream';
  const fileId      = randomBytes(6).toString('hex'); // 12-char hex, URL-safe
  const r2Key       = `files/${fileId}.${ext}`;

  try {
    const uploadId = await initiateMultipartUpload(r2Key, contentType);
    return res.status(200).json({ fileId, r2Key, uploadId });
  } catch (err) {
    console.error('upload/initiate error:', err.message);
    return res.status(500).json({ error: 'Failed to initiate upload' });
  }
}
