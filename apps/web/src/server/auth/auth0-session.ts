/**
 * Phase 5 M1+M2 — Auth0 session cookie + session-store row.
 *
 * # The cookie
 * Carries (userId, auth0Sub, sessionToken, expiresAt). Encrypted via
 * `@getyn/crypto` AES-256-GCM with AD='sso'. `sessionToken` is the
 * UNIQUE key into the `UserSession` table — verification both
 * decrypts the cookie AND confirms a non-revoked row exists.
 *
 * # Why a session-store row alongside the JWT-style cookie
 * M1 alone gave us stateless sessions: secure, but unrevokable until
 * expiry. M2 needs "revoke remote device" + "list active sessions",
 * both of which require server-side state. We keep the cookie
 * (so reads are fast — no DB roundtrip on every page when warm) and
 * add the DB row (so revoke takes effect on the next request).
 *
 * # Revoke semantics
 * Revoking a session sets `revokedAt`. `verifyAuth0SessionCookie`
 * refuses to return a payload when the row is missing OR revoked OR
 * expired. The cookie itself stays valid encryption-wise until
 * Auth0's hosted-session TTL elapses, but our checks fail closed.
 */
import { randomBytes } from 'crypto';

import { decrypt, encrypt, type EncryptedField } from '@getyn/crypto';
import { AuthProvider, prisma } from '@getyn/db';

const COOKIE_NAME = 'getyn_sso_session';
const COOKIE_AD = 'sso';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface CookiePayload {
  userId: string;
  auth0Sub: string;
  sessionToken: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SessionVerifyResult {
  userId: string;
  auth0Sub: string;
  sessionId: string;
  sessionToken: string;
}

export interface SessionContext {
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceLabel?: string | null;
}

/**
 * Issue a new session: create UserSession row + sign the cookie. The
 * caller (callback route) sets the cookie on the response with the
 * returned { name, value, maxAgeSec }.
 */
export async function issueAuth0Session(args: {
  userId: string;
  auth0Sub: string;
  context?: SessionContext;
}): Promise<{ name: string; value: string; maxAgeSec: number }> {
  const sessionToken = randomBytes(32).toString('base64url');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);

  await prisma.userSession.create({
    data: {
      userId: args.userId,
      sessionToken,
      provider: AuthProvider.AUTH0,
      deviceLabel: deriveDeviceLabel(args.context),
      ipAddress: args.context?.ipAddress ?? null,
      userAgent: args.context?.userAgent ?? null,
      issuedAt,
      expiresAt,
      lastSeenAt: issuedAt,
    },
  });

  const payload: CookiePayload = {
    userId: args.userId,
    auth0Sub: args.auth0Sub,
    sessionToken,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const encrypted = encrypt(JSON.stringify(payload), COOKIE_AD);
  const value = Buffer.from(JSON.stringify(encrypted), 'utf8').toString(
    'base64url',
  );
  return { name: COOKIE_NAME, value, maxAgeSec: SESSION_TTL_MS / 1000 };
}

/**
 * Decode + verify a cookie. Returns the resolved session or null
 * when the cookie is malformed / tampered / expired / the
 * corresponding session row is missing or revoked. Never throws
 * for those — only for ENCRYPTION_KEY misconfiguration.
 *
 * Side effect: stamps `lastSeenAt = now` on the session row when
 * verification succeeds, so the user-settings panel can show
 * "last active" reliably. Stamp is fire-and-forget — failure
 * doesn't kill the request.
 */
export async function verifyAuth0SessionCookie(
  cookieValue: string,
): Promise<SessionVerifyResult | null> {
  let field: EncryptedField;
  try {
    const json = Buffer.from(cookieValue, 'base64url').toString('utf8');
    field = JSON.parse(json) as EncryptedField;
  } catch {
    return null;
  }
  let plaintext: string;
  try {
    plaintext = decrypt(field, COOKIE_AD);
  } catch {
    return null;
  }
  let payload: CookiePayload;
  try {
    payload = JSON.parse(plaintext) as CookiePayload;
  } catch {
    return null;
  }
  if (new Date(payload.expiresAt) < new Date()) return null;

  // Confirm session row still authoritative.
  const row = await prisma.userSession.findUnique({
    where: { sessionToken: payload.sessionToken },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt < new Date()) return null;
  if (row.userId !== payload.userId) return null; // cookie/row drift

  // Touch lastSeenAt; ignore failure.
  prisma.userSession
    .update({
      where: { sessionToken: payload.sessionToken },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => undefined);

  return {
    userId: payload.userId,
    auth0Sub: payload.auth0Sub,
    sessionId: row.id,
    sessionToken: payload.sessionToken,
  };
}

/**
 * Revoke a session by id. Idempotent — re-revoking a revoked row is
 * a no-op. Used by the user-settings panel + by the staff admin
 * surface (M7).
 */
export async function revokeSession(args: {
  sessionId: string;
  userId: string;
}): Promise<void> {
  await prisma.userSession.updateMany({
    where: {
      id: args.sessionId,
      userId: args.userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke every non-revoked session for a user (sign-out everywhere).
 * Useful after a password change, a suspected credential leak, or
 * just user preference.
 */
export async function revokeAllSessions(args: {
  userId: string;
  exceptSessionId?: string;
}): Promise<{ count: number }> {
  const result = await prisma.userSession.updateMany({
    where: {
      userId: args.userId,
      revokedAt: null,
      ...(args.exceptSessionId ? { id: { not: args.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return { count: result.count };
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

/**
 * Heuristic device label from the User-Agent string. We deliberately
 * avoid a heavy UA-parser dependency — a coarse label ("Chrome on
 * macOS") is plenty for the "your active sessions" UI.
 */
function deriveDeviceLabel(ctx: SessionContext | undefined): string | null {
  const ua = ctx?.userAgent;
  if (!ua) return ctx?.deviceLabel ?? null;
  const browser =
    /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua) && !/Chromium/.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua) && !/Chrome/.test(ua)
            ? 'Safari'
            : 'Browser';
  const os =
    /Windows/.test(ua)
      ? 'Windows'
      : /Macintosh/.test(ua) || /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /iPhone|iPad|iOS/.test(ua)
            ? 'iOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown';
  return `${browser} on ${os}`;
}

export const AUTH0_SESSION_COOKIE_NAME = COOKIE_NAME;

// --------------------------------------------------------------------
// Back-compat wrapper for callsites that still call
// buildAuth0SessionCookie (M1 callback). The new contract requires
// async (DB write) so callers must await.
// --------------------------------------------------------------------

export async function buildAuth0SessionCookie(args: {
  userId: string;
  auth0Sub: string;
  context?: SessionContext;
}): Promise<{ name: string; value: string; maxAgeSec: number }> {
  return issueAuth0Session(args);
}
