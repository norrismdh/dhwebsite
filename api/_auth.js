/* ─── DH GATED-AREA AUTH ─────────────────────────────────────────────────────
 * Azure AD JWT verification for gated API routes (dhadmin + ops).
 * The leading underscore prevents Vercel from exposing this as an API route.
 *
 * How auth works:
 *   1. Browser acquires an ID token from Azure AD via MSAL.js (PKCE flow).
 *   2. Gated API calls include the token as:  Authorization: Bearer <idToken>
 *   3. This module verifies the token's signature against Azure's public JWKS,
 *      checks issuer + audience, then enforces a per-area email allowlist.
 *   4. No client secret is required — verification uses Azure's public keys.
 *
 * Two areas share the same App Registration but have independent allowlists:
 *   • Downloads admin  → ADMIN_ALLOWED_EMAILS  (requireAdmin / verifyAdminToken)
 *   • Ops dashboard    → OPS_ALLOWED_EMAILS     (requireOps / verifyOpsToken)
 *
 * Required env vars (add to .env.local for local dev):
 *   AZURE_AD_TENANT_ID      Directory (tenant) ID from the App Registration
 *   AZURE_AD_CLIENT_ID      Application (client) ID from the App Registration
 *   ADMIN_ALLOWED_EMAILS    Comma-separated authorised emails for /dhadmin
 *   OPS_ALLOWED_EMAILS      Comma-separated authorised emails for /ops
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

/** Return the list of authorised emails from the named env var. */
function allowedEmails(envVar) {
  return (process.env[envVar] ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// ── Core verification ───────────────────────────────────────────────────────

/**
 * Verify the Bearer token's signature/issuer/audience and confirm the caller's
 * email is in the given allow-list env var. Shared by every gated area.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} allowlistEnvVar  Name of the env var holding the CSV allow-list.
 * @returns {Promise<object>} The verified JWT payload.
 * @throws If the token is missing, invalid, expired, or not in the allow-list.
 */
async function verifyToken(req, allowlistEnvVar) {
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
  const allowed = allowedEmails(allowlistEnvVar);

  if (!allowed.length) {
    throw new Error(`${allowlistEnvVar} is not configured`);
  }
  if (!allowed.includes(email)) {
    throw new Error(`Access denied for: ${email}`);
  }

  return payload;
}

/**
 * Convenience wrapper for route handlers: verify against an allow-list env var;
 * on failure log the reason server-side and send a generic 401 (so we don't
 * disclose config — allow-list membership, missing env vars — to the client).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} allowlistEnvVar
 * @param {string} areaLabel  Short label for the server-side log line.
 * @returns {Promise<object|null>}  Payload on success, null after sending 401.
 */
async function requireArea(req, res, allowlistEnvVar, areaLabel) {
  try {
    return await verifyToken(req, allowlistEnvVar);
  } catch (err) {
    console.warn(`${areaLabel} auth failed:`, err.message);
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify the Bearer token and confirm the caller is in the downloads-admin
 * allow-list (ADMIN_ALLOWED_EMAILS).
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<object>} The verified JWT payload.
 */
export function verifyAdminToken(req) {
  return verifyToken(req, 'ADMIN_ALLOWED_EMAILS');
}

/**
 * Route-handler gate for the downloads admin.
 * Usage:  const user = await requireAdmin(req, res); if (!user) return;
 * @returns {Promise<object|null>}
 */
export function requireAdmin(req, res) {
  return requireArea(req, res, 'ADMIN_ALLOWED_EMAILS', 'Admin');
}

/**
 * Verify the Bearer token and confirm the caller is in the ops allow-list
 * (OPS_ALLOWED_EMAILS).
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<object>} The verified JWT payload.
 */
export function verifyOpsToken(req) {
  return verifyToken(req, 'OPS_ALLOWED_EMAILS');
}

/**
 * Route-handler gate for the ops dashboard.
 * Usage:  const user = await requireOps(req, res); if (!user) return;
 * @returns {Promise<object|null>}
 */
export function requireOps(req, res) {
  return requireArea(req, res, 'OPS_ALLOWED_EMAILS', 'Ops');
}
