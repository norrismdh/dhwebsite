/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * POST /api/upload/parts
 * Step 2 of 3 in the multipart upload flow.
 * Returns presigned PUT URLs for each part — the browser uploads chunks
 * directly to R2 using these URLs (Vercel is never in the data path).
 *
 * Request body:  { r2Key, uploadId, partCount }
 * Response:      { partUrls: string[] }   (1-based, index 0 = part 1)
 * ─────────────────────────────────────────────────────────────────────────── */

import { getPresignedPartUrls } from '../_r2.js';
import { requireAdmin }         from '../_auth.js';

const MAX_PARTS = 500; // safety cap — 500 × 100 MB = 50 GB max file size

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;

  const { r2Key, uploadId, partCount } = req.body ?? {};

  if (!r2Key || !uploadId || !partCount) {
    return res.status(400).json({ error: 'r2Key, uploadId and partCount are required' });
  }
  if (!Number.isInteger(partCount) || partCount < 1 || partCount > MAX_PARTS) {
    return res.status(400).json({ error: `partCount must be 1–${MAX_PARTS}` });
  }

  try {
    const partUrls = await getPresignedPartUrls(r2Key, uploadId, partCount);
    return res.status(200).json({ partUrls });
  } catch (err) {
    console.error('upload/parts error:', err.message);
    return res.status(500).json({ error: 'Failed to generate upload URLs' });
  }
}
