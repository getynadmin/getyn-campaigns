/**
 * Phase 5 M2 — auth0 session cookie codec.
 *
 * The full round-trip (issueAuth0Session → verifyAuth0SessionCookie)
 * requires a Prisma connection because M2 added the UserSession
 * store. Those are integration-level concerns and will land in the
 * Phase 5 M8 test pass.
 *
 * Here we exercise the pure encryption envelope — encode a payload,
 * decode it back, prove tampering breaks the seal. The same
 * @getyn/crypto primitive is used so this transitively covers the
 * crypto contract for the cookie.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decrypt, encrypt, type EncryptedField } from '@getyn/crypto';

const COOKIE_AD = 'sso';

function encodeCookieValue(payload: object): string {
  const encrypted = encrypt(JSON.stringify(payload), COOKIE_AD);
  return Buffer.from(JSON.stringify(encrypted), 'utf8').toString('base64url');
}

function decodeCookieValue<T>(value: string): T | null {
  let field: EncryptedField;
  try {
    field = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  try {
    return JSON.parse(decrypt(field, COOKIE_AD)) as T;
  } catch {
    return null;
  }
}

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_AKV = process.env.ACTIVE_KEY_VERSION;

beforeAll(() => {
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

interface TestPayload {
  userId: string;
  auth0Sub: string;
  sessionToken: string;
}

describe('auth0 session cookie codec', () => {
  it('round-trips a payload through encrypt/decrypt', () => {
    const payload: TestPayload = {
      userId: 'usr_abc',
      auth0Sub: 'auth0|abc',
      sessionToken: 'tok_xyz',
    };
    const encoded = encodeCookieValue(payload);
    const decoded = decodeCookieValue<TestPayload>(encoded);
    expect(decoded).toEqual(payload);
  });

  it('returns null for malformed base64', () => {
    expect(decodeCookieValue('!!!not-base64!!!')).toBeNull();
  });

  it('returns null when a byte is flipped (auth tag fails)', () => {
    const encoded = encodeCookieValue({
      userId: 'usr_x',
      auth0Sub: 'a',
      sessionToken: 't',
    });
    const bytes = Buffer.from(encoded, 'base64url');
    const idx = Math.floor(bytes.length / 2);
    if (bytes[idx] !== undefined) bytes[idx] = (bytes[idx] ?? 0) ^ 0xff;
    expect(
      decodeCookieValue<TestPayload>(bytes.toString('base64url')),
    ).toBeNull();
  });

  it('refuses to verify under a different ENCRYPTION_KEY (key-rotation safety)', () => {
    const encoded = encodeCookieValue({
      userId: 'usr_x',
      auth0Sub: 'a',
      sessionToken: 't',
    });
    const previousKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY =
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
    expect(decodeCookieValue<TestPayload>(encoded)).toBeNull();
    process.env.ENCRYPTION_KEY = previousKey;
  });

  it('does not leak which step failed — both tampering and wrong key return null', () => {
    // Belt-and-braces test: tampered ciphertext under same key == wrong key on
    // untampered ciphertext == both null. Caller can't distinguish failure modes.
    const encoded = encodeCookieValue({
      userId: 'usr_x',
      auth0Sub: 'a',
      sessionToken: 't',
    });
    const bytes = Buffer.from(encoded, 'base64url');
    bytes[3] = (bytes[3] ?? 0) ^ 0x01;
    const tamperedSameKey = decodeCookieValue<TestPayload>(
      bytes.toString('base64url'),
    );
    const previousKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY =
      'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=';
    const cleanWrongKey = decodeCookieValue<TestPayload>(encoded);
    process.env.ENCRYPTION_KEY = previousKey;
    expect(tamperedSameKey).toBeNull();
    expect(cleanWrongKey).toBeNull();
  });
});
