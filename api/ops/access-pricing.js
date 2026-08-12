/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * GET /api/ops/access-pricing
 *
 * "May this user see the Pricing tab?" probe. Returns 200 {ok:true} when the
 * caller's token is in OPS_ALLOWED_EMAILS or OPS_PRICING_ALLOWED_EMAILS, else
 * 401 (via requireOpsPricing).
 *
 * Unlike Sales/Support/Clients, the Pricing page does all its math
 * client-side and has no data endpoint that would otherwise enforce the
 * allow-list on load — this probe is that gate. Called once by
 * scripts/ops-pricing.js right after sign-in, before the page reveals itself.
 * ─────────────────────────────────────────────────────────────────────────── */

import { requireOpsPricing } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireOpsPricing(req, res);
  if (!user) return; // 401 already sent

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
