/**
 * Phase 5 M1 — Auth0 SDK + JWT verification.
 *
 * We use Auth0 for OAuth + ID-token issuance and validate the
 * resulting tokens server-side ourselves via JWKS. The
 * `@auth0/nextjs-auth0` SDK handles the OAuth dance and stateful
 * session cookie management; we layer Campaigns-specific session
 * data on top (tenant resolution, role from claims).
 *
 * # Why not lean entirely on the SDK
 * The SDK is fine for off-the-shelf "log in / log out" but the
 * provisioning step (find-or-create User, find-or-create Tenant,
 * sync plan from G-Suite) needs to happen post-token-exchange and
 * pre-redirect. Splitting concerns: SDK handles transport + cookie,
 * `provisionFromSso` handles app state.
 *
 * # Configuration
 * Reads:
 *   AUTH0_DOMAIN         — e.g. "getyn.us.auth0.com"
 *   AUTH0_CLIENT_ID
 *   AUTH0_CLIENT_SECRET
 *   AUTH0_AUDIENCE       — API identifier (Campaigns')
 *   AUTH0_SCOPE          — default "openid profile email"
 *   AUTH0_SECRET         — 32-byte hex for the session-cookie encryption
 *   APP_BASE_URL         — public origin (no trailing slash)
 *
 * # Degrade gracefully
 * Without AUTH0_DOMAIN / AUTH0_CLIENT_ID etc., the SDK can't init.
 * `isAuth0Configured()` reports that state so the login page can hide
 * the SSO button instead of crashing the route.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { ssoClaimsSchema, type SsoClaims } from '@getyn/types';

export function isAuth0Configured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET,
  );
}

export function auth0BaseUrl(): string {
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) throw new Error('AUTH0_DOMAIN unset');
  // Domain is host-only ("foo.auth0.com"); add https.
  return domain.startsWith('http') ? domain : `https://${domain}`;
}

/**
 * Resolve the app's public origin (no trailing slash). Used to build
 * absolute callback/redirect URLs.
 *
 * Resolution order:
 *   1. APP_BASE_URL          — explicit operator override
 *   2. NEXT_PUBLIC_APP_URL   — set on Vercel + Railway in production
 *   3. VERCEL_PROJECT_PRODUCTION_URL → https://campaigns.getyn.com
 *      style host that Vercel auto-injects on the production
 *      deployment; protects us from a forgotten env var causing
 *      sign-out + OAuth callbacks to bounce to localhost.
 *   4. VERCEL_URL            — preview deployment host (no scheme)
 *   5. localhost:3000        — dev fallback
 */
export function appBaseUrl(): string {
  const explicit =
    process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prodHost) return `https://${prodHost}`;
  const previewHost = process.env.VERCEL_URL;
  if (previewHost) return `https://${previewHost}`;
  return 'http://localhost:3000';
}

// JWKS endpoint cache. Auth0 publishes signing keys at /.well-known/jwks.json.
// `createRemoteJWKSet` handles caching + rotation automatically.
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks) return cachedJwks;
  cachedJwks = createRemoteJWKSet(
    new URL(`${auth0BaseUrl()}/.well-known/jwks.json`),
  );
  return cachedJwks;
}

/**
 * Verify an Auth0 ID token. Returns the claim set on success;
 * throws on signature mismatch, expiry, audience mismatch, or
 * structural validation failure.
 *
 * # Failure cases (each is a separate Sentry tag at the call site):
 *   - "signature_invalid" / "expired" / "audience_mismatch":
 *     jose's jwtVerify throws JOSEError with code-y messages.
 *   - "claims_invalid": Zod parse fails on the post-verification
 *     payload (missing gsuite_tenant_id or malformed role).
 *
 * # Why we don't trust the SDK's getSession() alone:
 * The SDK's session is a cookie that *we issue* after a successful
 * verify — but we want a re-verify path for security-sensitive
 * actions (e.g. tenant switching), so we keep this helper public.
 */
export async function verifyIdToken(idToken: string): Promise<SsoClaims> {
  const audience = process.env.AUTH0_AUDIENCE ?? process.env.AUTH0_CLIENT_ID;
  if (!audience) throw new Error('AUTH0_AUDIENCE / AUTH0_CLIENT_ID unset');

  const { payload } = await jwtVerify(idToken, jwks(), {
    issuer: `${auth0BaseUrl()}/`,
    audience,
    // Default clockTolerance is 0; allow 30s for clock skew.
    clockTolerance: '30s',
  });

  return ssoClaimsSchema.parse(payload as JWTPayload);
}

/**
 * Build the Auth0 hosted-login URL. Called by /api/auth/login/auth0.
 *
 * `returnTo` lands as a `state` round-trip — Auth0 returns it
 * verbatim to /api/auth/callback/auth0 where we redirect post-
 * provisioning. Always re-validate that returnTo is same-origin
 * before honouring it.
 */
export function buildAuth0LoginUrl(options: {
  state: string;
  nonce?: string;
  /**
   * Phase 5.9 — silent (prompt=none) probe. When true, Auth0 returns
   * immediately with an authorization code if a session exists on
   * the IdP, otherwise responds with `error=login_required` (or
   * `consent_required` / `interaction_required`). Used by the
   * hidden-iframe silent SSO check on the /login page.
   */
  silent?: boolean;
}): string {
  const clientId = process.env.AUTH0_CLIENT_ID;
  if (!clientId) throw new Error('AUTH0_CLIENT_ID unset');
  const audience = process.env.AUTH0_AUDIENCE ?? clientId;
  const scope = process.env.AUTH0_SCOPE ?? 'openid profile email';
  const redirectUri = `${appBaseUrl()}/api/auth/callback/auth0`;

  const u = new URL(`${auth0BaseUrl()}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', scope);
  u.searchParams.set('audience', audience);
  u.searchParams.set('state', options.state);
  if (options.nonce) u.searchParams.set('nonce', options.nonce);
  if (options.silent) u.searchParams.set('prompt', 'none');
  return u.toString();
}

/**
 * Build the Auth0 logout URL. After clearing our cookie, we federate
 * to Auth0's /v2/logout, which itself federates to the upstream IdP
 * (G-Suite). Single sign-out across all Getyn apps.
 */
export function buildAuth0LogoutUrl(options: { returnTo?: string }): string {
  const clientId = process.env.AUTH0_CLIENT_ID;
  if (!clientId) throw new Error('AUTH0_CLIENT_ID unset');
  const returnTo =
    options.returnTo ?? process.env.AUTH0_LOGOUT_RETURN_TO ?? appBaseUrl();
  const u = new URL(`${auth0BaseUrl()}/v2/logout`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('returnTo', returnTo);
  return u.toString();
}

/**
 * Exchange the OAuth `code` for tokens via Auth0's /oauth/token.
 * Returns `id_token` + `access_token` + (when offline_access is in
 * scope) a `refresh_token` for later renewal.
 *
 * Errors propagate as Error('auth0_token_exchange_failed: ...') — the
 * callback route catches + Sentry-captures with structured fields.
 */
export interface Auth0TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
  token_type: 'Bearer';
}

export async function exchangeCodeForTokens(args: {
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<Auth0TokenResponse> {
  const clientId = process.env.AUTH0_CLIENT_ID;
  const clientSecret = process.env.AUTH0_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET unset');
  }
  const fetchFn = args.fetchImpl ?? fetch;
  const res = await fetchFn(`${auth0BaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: args.code,
      redirect_uri: `${appBaseUrl()}/api/auth/callback/auth0`,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `auth0_token_exchange_failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as Auth0TokenResponse;
}
