/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * GET /api/ops/access
 *
 * Lightweight "may this user see Ops?" probe. Returns 200 {ok:true} when the
 * caller's token is in OPS_ALLOWED_EMAILS, else 401 (via requireOps). Used by
 * the dhadmin page to reveal the Ops tab only for authorised users, without
 * ever exposing the allow-list to the client.
 * ─────────────────────────────────────────────────────────────────────────── */

import { requireOps } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireOps(req, res);
  if (!user) return; // 401 already sent

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
