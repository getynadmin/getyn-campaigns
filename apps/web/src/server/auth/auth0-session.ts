/**
 * Phase 5 M1 — Auth0 session cookie shape + sign/verify.
 *
 * After provisionFromSso completes we issue a signed, AEAD-encrypted
 * cookie containing the resolved Campaigns User id + Auth0 sub (so a
 * subsequent re-verify can compare them) + a short expiry. Signed via
 * `@getyn/crypto` AES-256-GCM with `tenantId='sso'` as associated
 * data — same primitive Phase 4 uses for WABA tokens.
 *
 * # Why not @auth0/nextjs-auth0's session encoding
 * The SDK stores the entire ID token + access token in the cookie,
 * which (a) bloats every request, (b) means cookie rotation requires
 * re-issuing tokens. Our session cookie carries only the resolved
 * user id; we re-issue on every sign-in. Smaller cookie, simpler
 * lifecycle.
 *
 * # Refresh
 * Cookie expires 24h after issue. If a request lands with a stale
 * cookie, getCurrentUser returns null → middleware redirects to /sso
 * → user gets a fresh sign-in (silent if Auth0's own session is
 * still alive).
 */
import { decrypt, encrypt, type EncryptedField } from '@getyn/crypto';

const COOKIE_NAME = 'getyn_sso_session';
const COOKIE_AD = 'sso'; // associated data — disambiguates from tenant tokens
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface Auth0SessionPayload {
  userId: string;
  auth0Sub: string;
  /** ISO timestamp. */
  issuedAt: string;
  /** ISO timestamp. Past = expired. */
  expiresAt: string;
}

export function buildAuth0SessionCookie(payload: {
  userId: string;
  auth0Sub: string;
}): { name: string; value: string; maxAgeSec: number } {
  const now = Date.now();
  const session: Auth0SessionPayload = {
    userId: payload.userId,
    auth0Sub: payload.auth0Sub,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  const encrypted = encrypt(JSON.stringify(session), COOKIE_AD);
  // Encode the EncryptedField as compact JSON → base64url for the
  // cookie value. ~250 bytes; well under the 4KB cookie limit.
  const json = JSON.stringify(encrypted);
  const value = Buffer.from(json, 'utf8').toString('base64url');
  return { name: COOKIE_NAME, value, maxAgeSec: SESSION_TTL_MS / 1000 };
}

/**
 * Verify + parse a cookie value. Returns the session payload, or
 * null if the cookie is malformed, tampered, or expired. Never throws
 * for any of those cases — only for ENCRYPTION_KEY misconfiguration,
 * which IS a server-side bug and should surface loudly.
 */
export async function verifyAuth0SessionCookie(
  cookieValue: string,
): Promise<Auth0SessionPayload | null> {
  let field: EncryptedField;
  try {
    const json = Buffer.from(cookieValue, 'base64url').toString('utf8');
    field = JSON.parse(json) as EncryptedField;
  } catch {
    return null; // malformed
  }
  let plaintext: string;
  try {
    plaintext = decrypt(field, COOKIE_AD);
  } catch {
    return null; // tampered / wrong key / wrong AD
  }
  let payload: Auth0SessionPayload;
  try {
    payload = JSON.parse(plaintext) as Auth0SessionPayload;
  } catch {
    return null;
  }
  if (new Date(payload.expiresAt) < new Date()) return null; // expired
  return payload;
}

export const AUTH0_SESSION_COOKIE_NAME = COOKIE_NAME;
