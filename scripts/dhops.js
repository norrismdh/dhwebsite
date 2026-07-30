/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * Ops auth module — ES module loaded by all /ops pages.
 *
 * Mirrors scripts/dhadmin.js (same Azure AD App Registration, same PKCE flow),
 * but redirects to /ops and gates on the OPS_ALLOWED_EMAILS server allow-list.
 * The public Azure identifiers come from the shared /api/admin/config endpoint.
 *
 * Exports:
 *   initOps()            → Promise<AuthContext|null>
 *   opsFetch(path, auth) → Promise<Response|null>
 *
 * Auth flow:
 *   1. Fetch Azure AD client/tenant IDs from /api/admin/config
 *   2. Initialise MSAL PublicClientApplication (PKCE — no client secret)
 *   3. Handle redirect promise (completes auth-code exchange on return)
 *   4. If no account → loginRedirect → return null (browser navigating away)
 *   5. Acquire ID token silently → return AuthContext
 *
 * The ID token (not access token) is used as Bearer for ops API calls.
 * The server (_auth.js → requireOps) verifies it against Azure AD's public
 * JWKS and enforces the OPS_ALLOWED_EMAILS allow-list.
 * ─────────────────────────────────────────────────────────────────────────── */

// MSAL is imported dynamically inside initOps() (not at module load) so that
// pages importing this module — e.g. the ?demo=1 design preview — don't reach
// out to the CDN unless a real sign-in is actually happening.

const SCOPES        = ['openid', 'profile', 'email'];
const REDIRECT_PATH = '/ops'; // Must be registered as a redirect URI on the Azure AD App Registration

// ── initOps ─────────────────────────────────────────────────────────────────

/**
 * Initialise MSAL, handle any pending redirect, and ensure the current user
 * is authenticated.  Redirects to Azure AD if not signed in.
 *
 * @returns {Promise<AuthContext|null>}  null means a redirect is in progress.
 * @throws  If config cannot be loaded or MSAL initialisation fails.
 */
export async function initOps() {
  // 1. Load Azure AD public identifiers from the server (shared with dhadmin)
  console.debug('[ops] step 1: fetching /api/admin/config');
  const configRes = await fetch('/api/admin/config');
  if (!configRes.ok) {
    throw new Error(`Could not load auth config (HTTP ${configRes.status})`);
  }
  const { clientId, tenantId } = await configRes.json();
  console.debug('[ops] step 1: config ok — clientId:', clientId?.slice(0, 8) + '…');

  if (!clientId || !tenantId) {
    throw new Error('Azure AD is not configured. Check Vercel env vars AZURE_AD_CLIENT_ID and AZURE_AD_TENANT_ID.');
  }

  // 2. Initialise MSAL (imported on demand — no CDN script tag needed)
  const { PublicClientApplication, LogLevel } = await import('https://esm.sh/@azure/msal-browser@3');
  console.debug('[ops] step 2: creating PublicClientApplication');
  const msalInstance = new PublicClientApplication({
    auth: {
      clientId,
      authority:   `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
    },
    cache: {
      cacheLocation:       'sessionStorage', // Cleared on tab close — right for a gated tool
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

  console.debug('[ops] step 2: calling initialize()');
  await msalInstance.initialize(); // Required by MSAL Browser v3 before any call
  console.debug('[ops] step 2: initialize() done');

  // 3. Complete the auth-code → token exchange if we're returning from Azure AD
  console.debug('[ops] step 3: calling handleRedirectPromise()');
  let redirectResult = null;
  try {
    redirectResult = await msalInstance.handleRedirectPromise();
    console.debug('[ops] step 3: handleRedirectPromise done — account:', redirectResult?.account?.username ?? 'none');
  } catch (redirectErr) {
    console.error('[ops] step 3: handleRedirectPromise threw:', redirectErr);
    throw new Error(`Azure AD redirect error: ${redirectErr.message}`);
  }

  // 4. Check for a signed-in account
  const accounts = msalInstance.getAllAccounts();
  const account   = redirectResult?.account ?? accounts[0] ?? null;
  console.debug('[ops] step 4: accounts in cache:', accounts.length, '— using:', account?.username ?? 'none');

  if (!account) {
    // No session — start the login redirect
    console.debug('[ops] step 4: no account — calling loginRedirect()');
    await msalInstance.loginRedirect({
      scopes:    SCOPES,
      prompt:    'select_account', // Always show the account picker
    });
    return null; // Browser is navigating away
  }

  // 5. Acquire an ID token silently (MSAL handles caching/refresh); if silent
  //    acquisition fails, restart the login flow.
  async function getToken() {
    console.debug('[ops] getToken: calling acquireTokenSilent');
    try {
      const result = await msalInstance.acquireTokenSilent({ scopes: SCOPES, account });
      console.debug('[ops] getToken: acquireTokenSilent ok');
      return result.idToken;
    } catch (tokenErr) {
      console.warn('[ops] getToken: acquireTokenSilent failed:', tokenErr.name, tokenErr.message);
      await msalInstance.loginRedirect({ scopes: SCOPES, loginHint: account.username });
      return null;
    }
  }

  console.debug('[ops] step 5: acquiring initial token');
  const initialToken = await getToken();
  if (!initialToken) return null; // Redirect started in getToken()
  console.debug('[ops] step 5: token acquired — auth complete');

  // 6. Return the auth context used by every ops page and API call
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

// ── opsFetch ──────────────────────────────────────────────────────────────────

/**
 * Fetch wrapper that automatically attaches a fresh Bearer token.
 * Pass the AuthContext returned by initOps() as the second argument.
 *
 * @param {string}      path     API path, e.g. '/api/ops/dashboard?period=month'
 * @param {AuthContext} auth     Return value from initOps()
 * @param {RequestInit} [opts]   Standard fetch options (method, body, etc.)
 * @returns {Promise<Response|null>}  null if a login redirect started mid-call
 */
export async function opsFetch(path, auth, opts = {}) {
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
