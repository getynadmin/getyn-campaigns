/**
 * @getyn/crypto — application-layer envelope encryption (Phase 4 M1).
 *
 * Used to protect sensitive third-party credentials at rest:
 *   - WABA system-user access tokens (Phase 4)
 *   - SMS provider creds (Phase 6)
 *   - any future bearer secret a tenant entrusts to us
 *
 * # Threat model
 * The Postgres ciphertext column should reveal nothing useful even if an
 * attacker obtains a database snapshot, a stolen replica, or a backup.
 * RLS already isolates tenant rows at the query layer; this is defence
 * in depth at the storage layer.
 *
 * # Algorithm
 * AES-256-GCM with associated data:
 *   - Key:       32 raw bytes (256 bits), base64 in env
 *   - IV:        12 random bytes per encrypt (NIST SP 800-38D)
 *   - Auth tag:  16 bytes (GCM default)
 *   - AD:        caller-supplied string (binds the ciphertext to a tenant)
 *
 * GCM authenticates AD without encrypting it — passing the wrong AD at
 * decrypt time fails authentication. Every callsite passes `tenantId`
 * as AD, so a row stolen out of tenant A's row and crammed into tenant
 * B's row won't decrypt.
 *
 * # Key rotation (operationally rare, must work the first time)
 * Every ciphertext carries `keyVersion`. The runtime resolves the key
 * by version from env vars (`ENCRYPTION_KEY` = v1, `ENCRYPTION_KEY_V2`,
 * `ENCRYPTION_KEY_V3`, ...). To rotate:
 *   1. Generate the new key:  `openssl rand -base64 32`
 *   2. Add as `ENCRYPTION_KEY_V2` in Vercel + Railway. KEEP v1.
 *   3. Set `ACTIVE_KEY_VERSION=2` so new writes use v2.
 *   4. Run the rotation backfill (see `rotateField` below) over every
 *      encrypted column in the DB. This decrypts under v1 and re-encrypts
 *      under v2.
 *   5. Verify zero rows remain at keyVersion=1.
 *   6. Only THEN remove `ENCRYPTION_KEY` (v1) from env.
 * Deleting a key while ciphertexts at that version still exist =
 * permanent data loss. There is no recovery.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Persisted shape — written into a Prisma `Json` column. */
export interface EncryptedField {
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  authTag: string; // base64 (16 bytes)
  keyVersion: number;
}

/** Thrown for any failure: bad key, bad AD, tampered field, malformed input. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Resolve a 32-byte key by version from env vars.
 *
 *   v1  →  ENCRYPTION_KEY
 *   vN  →  ENCRYPTION_KEY_V<N>     (N >= 2)
 *
 * Throws CryptoError if missing / wrong length / invalid base64. Failing
 * loud here is preferable to silently producing garbage ciphertext.
 *
 * Exported for the worker's startup self-test — call `getKey(activeKeyVersion())`
 * on boot to surface a misconfigured ENCRYPTION_KEY before any handler runs.
 */
export function getKey(version: number): Buffer {
  const envName =
    version === 1 ? 'ENCRYPTION_KEY' : `ENCRYPTION_KEY_V${version}`;
  const raw = process.env[envName];
  if (!raw || raw.length === 0) {
    throw new CryptoError(`Encryption key not configured: ${envName} unset`);
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new CryptoError(`${envName} is not valid base64`);
  }
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `${envName} must decode to ${KEY_BYTES} bytes (got ${key.length}); generate via \`openssl rand -base64 32\``,
    );
  }
  return key;
}

/**
 * Active key version for new writes. Reads `ACTIVE_KEY_VERSION` env;
 * defaults to 1. Rotation increments this — the previous version's
 * key must remain available for decrypts until the backfill completes.
 */
export function activeKeyVersion(): number {
  const raw = process.env.ACTIVE_KEY_VERSION;
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new CryptoError(
      `ACTIVE_KEY_VERSION must be a positive integer (got ${raw})`,
    );
  }
  return n;
}

/**
 * Encrypt `plaintext` under the active key, binding the ciphertext to
 * `ad` via AES-GCM associated data. Caller chooses the AD — pass the
 * `tenantId` for tenant-scoped credentials.
 *
 * `plaintext` may be empty; `ad` may not (we want to make AD-skipping a
 * compile/runtime error rather than an easy bug).
 */
export function encrypt(plaintext: string, ad: string): EncryptedField {
  if (typeof plaintext !== 'string') {
    throw new CryptoError('plaintext must be a string');
  }
  if (typeof ad !== 'string' || ad.length === 0) {
    throw new CryptoError('associated data (ad) must be a non-empty string');
  }
  const version = activeKeyVersion();
  const key = getKey(version);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(ad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion: version,
  };
}

/**
 * Decrypt the field, authenticating against `ad`.
 *
 * Failures (wrong key version unconfigured, wrong AD, tampered
 * ciphertext / iv / authTag, malformed base64, malformed shape) all
 * throw CryptoError. Callers should treat any throw as "untrusted
 * ciphertext" — never log the field contents in the catch handler.
 */
export function decrypt(field: EncryptedField, ad: string): string {
  if (!isEncryptedField(field)) {
    throw new CryptoError('field is not a valid EncryptedField shape');
  }
  if (typeof ad !== 'string' || ad.length === 0) {
    throw new CryptoError('associated data (ad) must be a non-empty string');
  }
  const key = getKey(field.keyVersion);

  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(field.iv, 'base64');
    authTag = Buffer.from(field.authTag, 'base64');
    ciphertext = Buffer.from(field.ciphertext, 'base64');
  } catch {
    throw new CryptoError('field contains invalid base64');
  }
  if (iv.length !== IV_BYTES) {
    throw new CryptoError(`iv must be ${IV_BYTES} bytes (got ${iv.length})`);
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new CryptoError(
      `authTag must be ${AUTH_TAG_BYTES} bytes (got ${authTag.length})`,
    );
  }

  try {
    const decipher = createDecipheriv(ALGO, key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(ad, 'utf8'));
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    // Don't leak which step failed (key vs AD vs tampering) — uniform
    // error keeps the surface tight. Caller can't do anything useful
    // with a finer-grained reason and we don't want to help an attacker
    // distinguish failure modes.
    throw new CryptoError('decryption failed');
  }
}

/**
 * Re-encrypt a field under the current active key version.
 *
 * Used by the rotation backfill: read the row, decrypt under the old
 * version (still in env), encrypt under the new (active) version, write
 * back. Callers MUST do this inside the same transaction as the read so
 * concurrent writes can't get clobbered.
 *
 * Returns the field unchanged if it's already at the active version —
 * makes the backfill idempotent.
 */
export function rotateField(
  field: EncryptedField,
  ad: string,
): EncryptedField {
  if (field.keyVersion === activeKeyVersion()) {
    return field;
  }
  const plaintext = decrypt(field, ad);
  return encrypt(plaintext, ad);
}

/**
 * Constant-time string comparison. Useful for verifying decrypted
 * tokens against an expected value without a length-leaking shortcut.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isEncryptedField(value: unknown): value is EncryptedField {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ciphertext === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.authTag === 'string' &&
    typeof v.keyVersion === 'number' &&
    Number.isInteger(v.keyVersion) &&
    v.keyVersion >= 1
  );
}

/** Type guard exported for callers that read raw Json columns. */
export { isEncryptedField };
