/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * GET /api/ops/accounts?q=<partial name>
 *
 * CRM account name lookup for the Pricing page's Rep view — lets a rep pick
 * the customer from Zoho instead of retyping it. Gated by requireOps, same as
 * every other /api/ops/* route.
 *
 * Required env vars: same Zoho reporting credentials as api/ops/dashboard.js
 * (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REPORTING_REFRESH_TOKEN) — this
 * is a read-only lookup, so no new token or scope is needed.
 * ─────────────────────────────────────────────────────────────────────────── */

import { requireOps } from '../_auth.js';

const ZOHO_API   = 'https://www.zohoapis.com/crm/v2';
const ZOHO_OAUTH = 'https://accounts.zoho.com/oauth/v2/token';

// Cached for the function-instance lifetime; refreshed 5 min early.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (process.env.ZOHO_REPORTING_ACCESS_TOKEN && process.env.NODE_ENV !== 'production') {
    return process.env.ZOHO_REPORTING_ACCESS_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const tokenRes = await fetch(ZOHO_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.ZOHO_REPORTING_CLIENT_ID     || process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_REPORTING_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REPORTING_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('Zoho reporting token error:', tokenData);
    throw new Error('Could not obtain Zoho access token');
  }

  cachedToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireOps(req, res);
  if (!user) return; // 401 already sent

  res.setHeader('Cache-Control', 'no-store');

  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(200).json({ accounts: [] });

  try {
    const token = await getAccessToken();
    const criteria = `(Account_Name:starts_with:${q})`;
    const searchRes = await fetch(
      `${ZOHO_API}/Accounts/search?criteria=${encodeURIComponent(criteria)}&fields=Account_Name&per_page=10`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    );

    if (searchRes.status === 204) return res.status(200).json({ accounts: [] });

    const body = await searchRes.json();
    if (!searchRes.ok) throw new Error(body?.message || `HTTP ${searchRes.status}`);

    const accounts = (body.data || []).map((a) => ({ id: a.id, name: a.Account_Name }));
    return res.status(200).json({ accounts });
  } catch (err) {
    // Degrade to an empty list rather than a hard error — a lookup field going
    // quiet just means the rep types the name manually, same as Partner view.
    console.error('[ops/accounts]', err);
    return res.status(200).json({ accounts: [], error: err.message });
  }
}
