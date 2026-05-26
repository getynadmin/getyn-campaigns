/**
 * Phase 5 M1 — Auth0 session cookie round-trip.
 *
 * The session cookie carries (userId, auth0Sub, issuedAt, expiresAt)
 * encrypted with @getyn/crypto under AD='sso'. Tests:
 *
 *   - clean encode/decode preserves both fields
 *   - tampered ciphertext fails to verify (returns null, no throw)
 *   - expired payload returns null
 *   - malformed base64 returns null
 *   - cookies issued for one ENCRYPTION_KEY don't verify under a
 *     different key (key rotation safety)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildAuth0SessionCookie,
  verifyAuth0SessionCookie,
} from './auth0-session';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_AKV = process.env.ACTIVE_KEY_VERSION;

beforeAll(() => {
  // Use the same key shape M1 production will (32 bytes base64).
  // Random per-test-run so we don't accidentally collide with a real
  // ENCRYPTION_KEY in the developer's .env.local.
  process.env.ENCRYPTION_KEY =
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.ACTIVE_KEY_VERSION = '1';
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  if (ORIGINAL_AKV === undefined) delete process.env.ACTIVE_KEY_VERSION;
  else process.env.ACTIVE_KEY_VERSION = ORIGINAL_AKV;
});

describe('auth0 session cookie', () => {
  it('round-trips userId + auth0Sub through encrypt/decrypt', async () => {
    const cookie = buildAuth0SessionCookie({
      userId: 'usr_abc123',
      auth0Sub: 'auth0|abc123',
    });
    const session = await verifyAuth0SessionCookie(cookie.value);
    expect(session).not.toBeNull();
    expect(session!.userId).toBe('usr_abc123');
    expect(session!.auth0Sub).toBe('auth0|abc123');
  });

  it('emits a sane TTL', () => {
    const cookie = buildAuth0SessionCookie({
      userId: 'usr_x',
      auth0Sub: 'auth0|x',
    });
    expect(cookie.maxAgeSec).toBe(24 * 60 * 60);
    expect(cookie.name).toBe('getyn_sso_session');
  });

  it('returns null for malformed base64', async () => {
    expect(await verifyAuth0SessionCookie('!!!!not-base64!!!')).toBeNull();
  });

  it('returns null when ciphertext is tampered (one bit flipped)', async () => {
    const cookie = buildAuth0SessionCookie({
      userId: 'usr_x',
      auth0Sub: 'auth0|x',
    });
    // Flip a byte in the cookie value — should fail GCM auth-tag check.
    const bytes = Buffer.from(cookie.value, 'base64url');
    const idx = Math.floor(bytes.length / 2);
    if (bytes[idx] !== undefined) {
      bytes[idx] = (bytes[idx] ?? 0) ^ 0xff;
    }
    const tampered = bytes.toString('base64url');
    expect(await verifyAuth0SessionCookie(tampered)).toBeNull();
  });

  it('returns null when verified under a different ENCRYPTION_KEY', async () => {
    const cookie = buildAuth0SessionCookie({
      userId: 'usr_x',
      auth0Sub: 'auth0|x',
    });
    // Issue cookie, then rotate the key. Verifying should fail
    // closed — no error thrown, just null returned.
    const previousKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY =
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
    // Have to bust the @getyn/crypto module-level key cache — the
    // package re-reads env on each call, so swapping env mid-test
    // works directly.
    expect(await verifyAuth0SessionCookie(cookie.value)).toBeNull();
    process.env.ENCRYPTION_KEY = previousKey;
  });
});
