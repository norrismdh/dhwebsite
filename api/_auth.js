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
 * Areas share the same App Registration but have independent allowlists:
 *   • Downloads admin  → ADMIN_ALLOWED_EMAILS         (requireAdmin / verifyAdminToken)
 *   • Ops dashboard     → OPS_ALLOWED_EMAILS           (requireOps / verifyOpsToken)
 *   • Ops Pricing tab   → OPS_ALLOWED_EMAILS           (requireOpsPricing / verifyOpsPricingToken)
 *                         OR OPS_PRICING_ALLOWED_EMAILS — a narrower allowlist for
 *                         people who should see ONLY the Pricing calculator, not
 *                         Sales/Support/Clients. Full ops users pass automatically
 *                         since their emails already satisfy OPS_ALLOWED_EMAILS.
 *
 * Required env vars (add to .env.local for local dev):
 *   AZURE_AD_TENANT_ID          Directory (tenant) ID from the App Registration
 *   AZURE_AD_CLIENT_ID          Application (client) ID from the App Registration
 *   ADMIN_ALLOWED_EMAILS        Comma-separated authorised emails for /dhadmin
 *   OPS_ALLOWED_EMAILS          Comma-separated authorised emails for all of /ops
 *   OPS_PRICING_ALLOWED_EMAILS  Comma-separated emails allowed into /ops/pricing
 *                               ONLY (no Sales/Support/Clients access)
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
 * email is in at least one of the given allow-list env vars (OR — access to
 * ANY listed area is sufficient). Shared by every gated area.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string[]} allowlistEnvVars  Names of env vars holding CSV allow-lists.
 * @returns {Promise<object>} The verified JWT payload.
 * @throws If the token is missing, invalid, expired, or not in any allow-list.
 */
async function verifyTokenAgainst(req, allowlistEnvVars) {
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
  const allowed = allowlistEnvVars.flatMap(allowedEmails);

  if (!allowed.length) {
    throw new Error(`${allowlistEnvVars.join(' / ')} is not configured`);
  }
  if (!allowed.includes(email)) {
    throw new Error(`Access denied for: ${email}`);
  }

  return payload;
}

/** Single-allowlist form of {@link verifyTokenAgainst}. */
function verifyToken(req, allowlistEnvVar) {
  return verifyTokenAgainst(req, [allowlistEnvVar]);
}

/**
 * Convenience wrapper for route handlers: verify against one or more allow-list
 * env vars (OR); on failure log the reason server-side and send a generic 401
 * (so we don't disclose config — allow-list membership, missing env vars — to
 * the client).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string[]} allowlistEnvVars
 * @param {string} areaLabel  Short label for the server-side log line.
 * @returns {Promise<object|null>}  Payload on success, null after sending 401.
 */
async function requireAreaAgainst(req, res, allowlistEnvVars, areaLabel) {
  try {
    return await verifyTokenAgainst(req, allowlistEnvVars);
  } catch (err) {
    console.warn(`${areaLabel} auth failed:`, err.message);
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

/** Single-allowlist form of {@link requireAreaAgainst}. */
function requireArea(req, res, allowlistEnvVar, areaLabel) {
  return requireAreaAgainst(req, res, [allowlistEnvVar], areaLabel);
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

/**
 * Verify the Bearer token and confirm the caller is in the ops allow-list OR
 * the Pricing-only allow-list — i.e. full ops access implies pricing access.
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<object>} The verified JWT payload.
 */
export function verifyOpsPricingToken(req) {
  return verifyTokenAgainst(req, ['OPS_ALLOWED_EMAILS', 'OPS_PRICING_ALLOWED_EMAILS']);
}

/**
 * Route-handler gate for the ops Pricing tab specifically — grants access to
 * full ops users AND to the narrower OPS_PRICING_ALLOWED_EMAILS list, so
 * someone can be given the calculator without seeing Sales/Support/Clients.
 * Usage:  const user = await requireOpsPricing(req, res); if (!user) return;
 * @returns {Promise<object|null>}
 */
export function requireOpsPricing(req, res) {
  return requireAreaAgainst(req, res, ['OPS_ALLOWED_EMAILS', 'OPS_PRICING_ALLOWED_EMAILS'], 'Ops-Pricing');
}
