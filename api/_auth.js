/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * Azure AD JWT verification for admin API routes.
 * The leading underscore prevents Vercel from exposing this as an API route.
 *
 * How auth works:
 *   1. Browser acquires an ID token from Azure AD via MSAL.js (PKCE flow).
 *   2. Admin API calls include the token as:  Authorization: Bearer <idToken>
 *   3. This module verifies the token's signature against Azure's public JWKS,
 *      checks issuer + audience, then enforces the email allowlist.
 *   4. No client secret is required — verification uses Azure's public keys.
 *
 * Required env vars (add to .env.local for local dev):
 *   AZURE_AD_TENANT_ID      Directory (tenant) ID from the App Registration
 *   AZURE_AD_CLIENT_ID      Application (client) ID from the App Registration
 *   ADMIN_ALLOWED_EMAILS    Comma-separated list of authorised email addresses
 * ─────────────────────────────────────────────────────────────────────────── */

import { createRemoteJWKSet, jwtVerify } from 'jose';

// ── JWKS — lazily initialised so env vars are read at call time, not import ──

let _jwks = null;

function getJWKS() {
  if (!_jwks) {
    const tenantId = process.env.AZURE_AD_TENANT_ID;
    if (!tenantId) throw new Error('AZURE_AD_TENANT_ID env var is not set');
    _jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    );
  }
  return _jwks;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse the email address from an Azure AD token payload.
 *  Azure uses preferred_username for work/school accounts; email is optional. */
function emailFromPayload(payload) {
  return (payload.preferred_username ?? payload.email ?? '').toLowerCase().trim();
}

/** Return the list of authorised emails from the env var. */
function allowedEmails() {
  return (process.env.ADMIN_ALLOWED_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify the Bearer token from the request and confirm the caller is in the
 * admin allow-list.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<object>} The verified JWT payload.
 * @throws If the token is missing, invalid, expired, or not in the allow-list.
 */
export async function verifyAdminToken(req) {
  const authHeader = req.headers['authorization'] ?? '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) throw new Error('Missing Authorization header');

  const tenantId = process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_AD_CLIENT_ID;

  const { payload } = await jwtVerify(token, getJWKS(), {
    // Accept both v1 and v2 Azure AD token issuers
    issuer: [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ],
    audience: clientId,
  });

  // Enforce allow-list — no Azure AD Premium licence required
  const email   = emailFromPayload(payload);
  const allowed = allowedEmails();

  if (!allowed.length) {
    throw new Error('ADMIN_ALLOWED_EMAILS is not configured');
  }
  if (!allowed.includes(email)) {
    throw new Error(`Access denied for: ${email}`);
  }

  return payload;
}

/**
 * Convenience wrapper for use in API route handlers.
 * Calls verifyAdminToken; on failure, sends a 401 and returns null.
 * On success, returns the JWT payload — the caller can proceed.
 *
 * Usage:
 *   const user = await requireAdmin(req, res);
 *   if (!user) return;   // 401 already sent
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @returns {Promise<object|null>}
 */
export async function requireAdmin(req, res) {
  try {
    return await verifyAdminToken(req);
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized', detail: err.message });
    return null;
  }
}
