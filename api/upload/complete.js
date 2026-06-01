/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * POST /api/upload/complete
 * Step 3 of 3 in the multipart upload flow.
 * Assembles the uploaded parts into a final R2 object.
 *
 * Request body:
 *   { r2Key, uploadId, parts: [{ PartNumber, ETag }], filename, sizeBytes }
 *
 * Response:
 *   { fileId, r2Key, filename, sizeBytes }
 *
 * NOTE: This only completes the R2 object — it does NOT save the release.
 * After this call the browser calls POST /api/admin/releases to persist the
 * release record.  If that second call fails the R2 object is orphaned but
 * the release manifest stays consistent (no partial entries).
 * ─────────────────────────────────────────────────────────────────────────── */

import { completeMultipartUpload } from '../_r2.js';
import { requireAdmin }            from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;

  const { r2Key, uploadId, parts, filename, sizeBytes } = req.body ?? {};

  if (!r2Key || !uploadId || !Array.isArray(parts) || !parts.length || !filename) {
    return res.status(400).json({ error: 'r2Key, uploadId, parts and filename are required' });
  }

  // Validate parts array — each entry must have PartNumber and ETag
  const invalidPart = parts.find(p => !p.PartNumber || !p.ETag);
  if (invalidPart) {
    return res.status(400).json({ error: 'Each part must have PartNumber and ETag' });
  }

  // Derive fileId from the r2Key (it's the stem of the filename in "files/<fileId>.<ext>")
  const fileId = r2Key.replace(/^files\//, '').replace(/\.[^.]+$/, '').replace(/\.tar$/, '');

  try {
    await completeMultipartUpload(r2Key, uploadId, parts);
    return res.status(200).json({ fileId, r2Key, filename, sizeBytes: sizeBytes ?? 0 });
  } catch (err) {
    console.error('upload/complete error:', err.message);
    return res.status(500).json({ error: 'Failed to complete upload' });
  }
}
