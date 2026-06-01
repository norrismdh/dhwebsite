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
  console.debug('[dhadmin] step 1: fetching /api/admin/config');
  const configRes = await fetch('/api/admin/config');
  if (!configRes.ok) {
    throw new Error(`Could not load admin config (HTTP ${configRes.status})`);
  }
  const { clientId, tenantId } = await configRes.json();
  console.debug('[dhadmin] step 1: config ok — clientId:', clientId?.slice(0, 8) + '…');

  if (!clientId || !tenantId) {
    throw new Error('Azure AD is not configured. Check Vercel env vars AZURE_AD_CLIENT_ID and AZURE_AD_TENANT_ID.');
  }

  // 2. Initialise MSAL (imported directly as an ES module — no CDN script tag needed)
  console.debug('[dhadmin] step 2: creating PublicClientApplication');
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
      allowNativeBroker: false, // Disable native broker to avoid message-channel issues
      loggerOptions: {
        logLevel:         LogLevel.Warning,
        loggerCallback:   (level, msg) => console.debug('[msal]', msg),
        piiLoggingEnabled: false,
      },
    },
  });

  console.debug('[dhadmin] step 2: calling initialize()');
  await msalInstance.initialize(); // Required by MSAL Browser v3 before any call
  console.debug('[dhadmin] step 2: initialize() done');

  // 3. Complete the auth-code → token exchange if we're returning from Azure AD
  console.debug('[dhadmin] step 3: calling handleRedirectPromise()');
  let redirectResult = null;
  try {
    redirectResult = await msalInstance.handleRedirectPromise();
    console.debug('[dhadmin] step 3: handleRedirectPromise done — account:', redirectResult?.account?.username ?? 'none');
  } catch (redirectErr) {
    // Azure AD can return errors in the redirect (e.g. user denied consent, redirect_uri mismatch)
    console.error('[dhadmin] step 3: handleRedirectPromise threw:', redirectErr);
    throw new Error(`Azure AD redirect error: ${redirectErr.message}`);
  }

  // 4. Check for a signed-in account
  const accounts = msalInstance.getAllAccounts();
  const account   = redirectResult?.account ?? accounts[0] ?? null;
  console.debug('[dhadmin] step 4: accounts in cache:', accounts.length, '— using:', account?.username ?? 'none');

  if (!account) {
    // No session — start the login redirect
    console.debug('[dhadmin] step 4: no account — calling loginRedirect()');
    await msalInstance.loginRedirect({
      scopes:    SCOPES,
      prompt:    'select_account', // Always show the account picker
    });
    return null; // Browser is navigating away
  }

  // 5. Acquire an ID token — use the one from the redirect result if fresh,
  //    otherwise fall back to silent acquisition (MSAL handles caching/refresh).
  async function getToken() {
    console.debug('[dhadmin] getToken: calling acquireTokenSilent');
    try {
      const result = await msalInstance.acquireTokenSilent({ scopes: SCOPES, account });
      console.debug('[dhadmin] getToken: acquireTokenSilent ok');
      return result.idToken;
    } catch (tokenErr) {
      // Silent refresh failed — restart login flow
      console.warn('[dhadmin] getToken: acquireTokenSilent failed:', tokenErr.name, tokenErr.message);
      await msalInstance.loginRedirect({ scopes: SCOPES, loginHint: account.username });
      return null;
    }
  }

  console.debug('[dhadmin] step 5: acquiring initial token');
  const initialToken = await getToken();
  if (!initialToken) return null; // Redirect started in getToken()
  console.debug('[dhadmin] step 5: token acquired — auth complete');

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
