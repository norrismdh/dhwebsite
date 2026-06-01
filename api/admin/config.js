/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * GET /api/admin/config
 * Returns the PUBLIC Azure AD identifiers needed by MSAL.js in the browser.
 * These are NOT secrets — they appear in OAuth redirect URLs and ID tokens.
 * This endpoint is intentionally unprotected: the browser needs it before
 * the MSAL auth flow can even start.
 * ─────────────────────────────────────────────────────────────────────────── */

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.AZURE_AD_CLIENT_ID ?? '';
  const tenantId = process.env.AZURE_AD_TENANT_ID ?? '';

  if (!clientId || !tenantId) {
    console.error('admin/config: AZURE_AD_CLIENT_ID or AZURE_AD_TENANT_ID env vars are not set');
    return res.status(503).json({ error: 'Admin authentication is not configured' });
  }

  // Cache at the edge — these values only change if you rotate the App Registration
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).json({ clientId, tenantId });
}
