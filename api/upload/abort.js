/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * POST /api/upload/abort
 * Cancels an in-progress multipart upload and frees the partial R2 storage.
 * Called by the browser when the user cancels an upload or when any part
 * upload fails unrecoverably.
 *
 * Request body:  { r2Key, uploadId }
 * Response:      { success: true }
 * ─────────────────────────────────────────────────────────────────────────── */

import { abortMultipartUpload } from '../_r2.js';
import { requireAdmin }         from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAdmin(req, res);
  if (!user) return;

  const { r2Key, uploadId } = req.body ?? {};

  if (!r2Key || !uploadId) {
    return res.status(400).json({ error: 'r2Key and uploadId are required' });
  }

  try {
    await abortMultipartUpload(r2Key, uploadId);
    return res.status(200).json({ success: true });
  } catch (err) {
    // Log but don't fail the request — the caller was already cleaning up
    console.error('upload/abort error:', err.message);
    return res.status(200).json({ success: true, warning: err.message });
  }
}
