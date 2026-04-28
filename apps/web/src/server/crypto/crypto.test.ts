/**
 * Phase 4 M1 — `@getyn/crypto` round-trip + tamper resistance.
 *
 * These are the highest-stakes tests in Phase 4. A bug here corrupts
 * encrypted credentials with no way to recover them, so we exercise:
 *
 *   - clean round-trip
 *   - associated-data binding (wrong tenant fails)
 *   - tampered ciphertext / iv / authTag all fail
 *   - rejection of malformed inputs (shape, base64, lengths)
 *   - key-rotation path: v1 ciphertext readable after v2 added; rotateField
 *     re-encrypts under the active version
 *   - empty plaintext is allowed; empty AD is not
 *   - constant-time compare matches/mismatches as expected
 */
import { randomBytes } from 'node:crypto';

import {
  CryptoError,
  activeKeyVersion,
  constantTimeEqual,
  decrypt,
  encrypt,
  getKey,
  isEncryptedField,
  rotateField,
  type EncryptedField,
} from '@getyn/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const KEY_V1 = randomBytes(32).toString('base64');
const KEY_V2 = randomBytes(32).toString('base64');

function setEnv(version: 1 | 2): void {
  process.env.ENCRYPTION_KEY = KEY_V1;
  process.env.ENCRYPTION_KEY_V2 = KEY_V2;
  process.env.ACTIVE_KEY_VERSION = String(version);
}

function clearEnv(): void {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_V2;
  delete process.env.ENCRYPTION_KEY_V3;
  delete process.env.ACTIVE_KEY_VERSION;
}

describe('@getyn/crypto', () => {
  beforeEach(() => setEnv(1));
  afterEach(() => clearEnv());

  describe('round-trip', () => {
    it('encrypts and decrypts a plaintext under matching AD', () => {
      const ad = 'tnt_demo';
      const enc = encrypt('whatsapp-token-xyz-123', ad);
      expect(enc.keyVersion).toBe(1);
      expect(enc.ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(decrypt(enc, ad)).toBe('whatsapp-token-xyz-123');
    });

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      const a = encrypt('token', 'tnt_demo');
      const b = encrypt('token', 'tnt_demo');
      expect(a.ciphertext).not.toBe(b.ciphertext);
      expect(a.iv).not.toBe(b.iv);
      // ...but both decrypt to the same plaintext.
      expect(decrypt(a, 'tnt_demo')).toBe('token');
      expect(decrypt(b, 'tnt_demo')).toBe('token');
    });

    it('allows empty plaintext (round-trips to "")', () => {
      const enc = encrypt('', 'tnt_demo');
      expect(decrypt(enc, 'tnt_demo')).toBe('');
    });
  });

  describe('AD binding (the security-critical bit)', () => {
    it('fails decrypt when AD differs from encrypt-time AD', () => {
      const enc = encrypt('secret', 'tnt_a');
      // Same ciphertext, wrong tenant — must not authenticate.
      expect(() => decrypt(enc, 'tnt_b')).toThrow(CryptoError);
    });

    it('rejects empty AD on encrypt', () => {
      expect(() => encrypt('secret', '')).toThrow(/non-empty/);
    });

    it('rejects empty AD on decrypt', () => {
      const enc = encrypt('secret', 'tnt_a');
      expect(() => decrypt(enc, '')).toThrow(/non-empty/);
    });
  });

  describe('tamper resistance', () => {
    it('fails when the ciphertext is altered by one bit', () => {
      const enc = encrypt('secret', 'tnt_a');
      const buf = Buffer.from(enc.ciphertext, 'base64');
      buf[0] = (buf[0] ?? 0) ^ 0x01;
      const tampered: EncryptedField = {
        ...enc,
        ciphertext: buf.toString('base64'),
      };
      expect(() => decrypt(tampered, 'tnt_a')).toThrow(CryptoError);
    });

    it('fails when the IV is altered', () => {
      const enc = encrypt('secret', 'tnt_a');
      const buf = Buffer.from(enc.iv, 'base64');
      buf[0] = (buf[0] ?? 0) ^ 0x01;
      expect(() =>
        decrypt({ ...enc, iv: buf.toString('base64') }, 'tnt_a'),
      ).toThrow(CryptoError);
    });

    it('fails when the auth tag is altered', () => {
      const enc = encrypt('secret', 'tnt_a');
      const buf = Buffer.from(enc.authTag, 'base64');
      buf[0] = (buf[0] ?? 0) ^ 0x01;
      expect(() =>
        decrypt({ ...enc, authTag: buf.toString('base64') }, 'tnt_a'),
      ).toThrow(CryptoError);
    });

    it('fails when keyVersion points at the wrong key', () => {
      const enc = encrypt('secret', 'tnt_a');
      // Pretend this row was written under v2 (it wasn't). v2 is configured
      // but the auth tag was computed under v1, so authentication must fail.
      expect(() => decrypt({ ...enc, keyVersion: 2 }, 'tnt_a')).toThrow(
        CryptoError,
      );
    });
  });

  describe('input validation', () => {
    it('rejects non-EncryptedField shapes', () => {
      // @ts-expect-error testing runtime guard on bad input
      expect(() => decrypt({ ciphertext: 'x' }, 'tnt_a')).toThrow(
        /not a valid EncryptedField/,
      );
      // @ts-expect-error testing runtime guard on bad input
      expect(() => decrypt(null, 'tnt_a')).toThrow(/not a valid EncryptedField/);
    });

    it('rejects malformed lengths (iv/authTag wrong size)', () => {
      const enc = encrypt('secret', 'tnt_a');
      expect(() =>
        decrypt({ ...enc, iv: Buffer.from('short').toString('base64') }, 'tnt_a'),
      ).toThrow(/iv must be/);
    });

    it('isEncryptedField positive + negative', () => {
      const enc = encrypt('secret', 'tnt_a');
      expect(isEncryptedField(enc)).toBe(true);
      expect(isEncryptedField({ ciphertext: 'x', iv: 'x', authTag: 'x' })).toBe(
        false,
      );
      expect(isEncryptedField(null)).toBe(false);
      expect(isEncryptedField('plain string')).toBe(false);
    });
  });

  describe('key configuration', () => {
    it('throws if ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => getKey(1)).toThrow(/ENCRYPTION_KEY unset/);
    });

    it('throws if key is the wrong length', () => {
      process.env.ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
      expect(() => getKey(1)).toThrow(/must decode to 32 bytes/);
    });

    it('activeKeyVersion defaults to 1, honours explicit values', () => {
      delete process.env.ACTIVE_KEY_VERSION;
      expect(activeKeyVersion()).toBe(1);
      process.env.ACTIVE_KEY_VERSION = '2';
      expect(activeKeyVersion()).toBe(2);
    });

    it('rejects malformed ACTIVE_KEY_VERSION', () => {
      process.env.ACTIVE_KEY_VERSION = 'not-a-number';
      expect(() => activeKeyVersion()).toThrow(/positive integer/);
    });
  });

  describe('key rotation', () => {
    it('reads v1 ciphertext after v2 has been added and made active', () => {
      // Write under v1...
      setEnv(1);
      const enc = encrypt('legacy-token', 'tnt_a');
      expect(enc.keyVersion).toBe(1);

      // ...activate v2 for new writes; v1 key still in env for old reads.
      setEnv(2);
      expect(decrypt(enc, 'tnt_a')).toBe('legacy-token');

      // New writes use v2.
      const fresh = encrypt('new-token', 'tnt_a');
      expect(fresh.keyVersion).toBe(2);
    });

    it('rotateField re-encrypts a v1 row under the active v2', () => {
      setEnv(1);
      const v1 = encrypt('token', 'tnt_a');
      setEnv(2);
      const v2 = rotateField(v1, 'tnt_a');
      expect(v2.keyVersion).toBe(2);
      expect(v2.ciphertext).not.toBe(v1.ciphertext);
      expect(decrypt(v2, 'tnt_a')).toBe('token');
    });

    it('rotateField is a no-op when already at active version', () => {
      const enc = encrypt('token', 'tnt_a');
      const out = rotateField(enc, 'tnt_a');
      // Same object back — backfill skips rows already at active version.
      expect(out).toBe(enc);
    });

    it('rotateField fails if the wrong AD is supplied (cannot decrypt)', () => {
      setEnv(1);
      const v1 = encrypt('token', 'tnt_a');
      setEnv(2);
      expect(() => rotateField(v1, 'tnt_b')).toThrow(CryptoError);
    });
  });

  describe('constantTimeEqual', () => {
    it('matches equal strings', () => {
      expect(constantTimeEqual('abcd', 'abcd')).toBe(true);
    });

    it('rejects strings of different length without throwing', () => {
      expect(constantTimeEqual('abcd', 'abc')).toBe(false);
    });

    it('rejects same-length but different strings', () => {
      expect(constantTimeEqual('abcd', 'abce')).toBe(false);
    });
  });
});
