/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * Admin auth module — ES module loaded by all /dhadmin pages.
 *
 * MSAL Browser v3 is imported directly as an ES module from esm.sh so that
 * no separate <script> CDN tag is needed on each page.
 *
 * Exports:
 *   initAdmin()            → Promise<AuthContext|null>
 *   adminFetch(path, auth) → Promise<Response|null>
 *
 * Auth flow:
 *   1. Fetch Azure AD client/tenant IDs from /api/admin/config
 *   2. Initialise MSAL PublicClientApplication (PKCE — no client secret)
 *   3. Handle redirect promise (completes auth-code exchange on return)
 *   4. If no account → loginRedirect → return null (browser navigating away)
 *   5. Acquire ID token silently → return AuthContext
 *
 * The ID token (not access token) is used as Bearer for admin API calls.
 * The server (_auth.js) verifies it against Azure AD's public JWKS and
 * enforces the ADMIN_ALLOWED_EMAILS allowlist.
 * ─────────────────────────────────────────────────────────────────────────── */

import { PublicClientApplication, LogLevel } from 'https://esm.sh/@azure/msal-browser@3';

const SCOPES        = ['openid', 'profile', 'email'];
const REDIRECT_PATH = '/dhadmin'; // Must match the Azure AD App Registration URIs

// ── initAdmin ─────────────────────────────────────────────────────────────────

/**
 * Initialise MSAL, handle any pending redirect, and ensure the current user
 * is authenticated.  Redirects to Azure AD if not signed in.
 *
 * @returns {Promise<AuthContext|null>}  null means a redirect is in progress.
 * @throws  If config cannot be loaded or MSAL initialisation fails.
 */
export async function initAdmin() {
  // 1. Load Azure AD public identifiers from the server
  const configRes = await fetch('/api/admin/config');
  if (!configRes.ok) {
    throw new Error(`Could not load admin config (HTTP ${configRes.status})`);
  }
  const { clientId, tenantId } = await configRes.json();

  if (!clientId || !tenantId) {
    throw new Error('Azure AD is not configured. Check Vercel env vars AZURE_AD_CLIENT_ID and AZURE_AD_TENANT_ID.');
  }

  // 2. Initialise MSAL (imported directly as an ES module — no CDN script tag needed)
  const msalInstance = new PublicClientApplication({
    auth: {
      clientId,
      authority:   `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
    },
    cache: {
      cacheLocation:       'sessionStorage', // Cleared on tab close — right for admin
      storeAuthStateInCookie: false,
    },
    system: {
      loggerOptions: {
        logLevel:         LogLevel.Warning,
        loggerCallback:   (level, msg) => console.debug('[msal]', msg),
        piiLoggingEnabled: false,
      },
    },
  });

  await msalInstance.initialize(); // Required by MSAL Browser v3 before any call

  // 3. Complete the auth-code → token exchange if we're returning from Azure AD
  const redirectResult = await msalInstance.handleRedirectPromise();

  // 4. Check for a signed-in account
  const accounts = msalInstance.getAllAccounts();
  const account   = redirectResult?.account ?? accounts[0] ?? null;

  if (!account) {
    // No session — start the login redirect
    await msalInstance.loginRedirect({
      scopes:    SCOPES,
      prompt:    'select_account', // Always show the account picker
    });
    return null; // Browser is navigating away
  }

  // 5. Acquire an ID token (MSAL handles caching and silent refresh)
  async function getToken() {
    try {
      const result = await msalInstance.acquireTokenSilent({ scopes: SCOPES, account });
      return result.idToken;
    } catch {
      // Silent refresh failed (expired refresh token, network error, consent needed)
      // Restart the login flow — user will land back here after re-auth
      await msalInstance.loginRedirect({ scopes: SCOPES, loginHint: account.username });
      return null;
    }
  }

  const initialToken = await getToken();
  if (!initialToken) return null; // Redirect started in getToken()

  // 6. Return the auth context used by every admin page and API call
  return {
    account,
    token: initialToken,
    getToken,
    signOut: () => msalInstance.logoutRedirect({
      account,
      postLogoutRedirectUri: `${window.location.origin}${REDIRECT_PATH}`,
    }),
  };
}

// ── adminFetch ────────────────────────────────────────────────────────────────

/**
 * Fetch wrapper that automatically attaches a fresh Bearer token.
 * Pass the AuthContext returned by initAdmin() as the second argument.
 *
 * @param {string}      path     API path, e.g. '/api/admin/releases'
 * @param {AuthContext} auth     Return value from initAdmin()
 * @param {RequestInit} [opts]   Standard fetch options (method, body, etc.)
 * @returns {Promise<Response|null>}  null if a login redirect started mid-call
 *
 * @example
 *   const res = await adminFetch('/api/admin/releases', auth);
 *   const res = await adminFetch('/api/admin/releases', auth, {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *   });
 */
export async function adminFetch(path, auth, opts = {}) {
  const token = await auth.getToken();
  if (!token) return null; // Redirect started

  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}
