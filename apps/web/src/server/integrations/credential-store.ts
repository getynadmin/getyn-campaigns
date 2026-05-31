/**
 * Phase 5.6 — IntegrationCredential read/write helpers.
 *
 * One DB row per platform integration. Non-secret config lives in a
 * JSON `config` column; secrets land in a `@getyn/crypto` envelope on
 * `secrets`, with AD = `integration:{provider}` so ciphertexts can't
 * be swapped between rows.
 *
 * Provider-specific resolvers (`getWhatsAppCredentials()` etc.) live
 * in sibling files and call into here for the raw envelope work.
 */
import { Prisma, prisma } from '@getyn/db';
import { decrypt, encrypt, type EncryptedField } from '@getyn/crypto';

function ad(provider: string): string {
  return `integration:${provider}`;
}

const ENVELOPE_KEYS = ['ciphertext', 'iv', 'authTag', 'keyVersion'] as const;

function asEnvelope(value: Prisma.JsonValue | null | undefined): EncryptedField | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  for (const k of ENVELOPE_KEYS) {
    if (!(k in obj)) return null;
  }
  return {
    ciphertext: String(obj.ciphertext),
    iv: String(obj.iv),
    authTag: String(obj.authTag),
    keyVersion: Number(obj.keyVersion),
  };
}

export interface IntegrationRow<TConfig, TSecrets> {
  id: string;
  provider: string;
  enabled: boolean;
  config: TConfig;
  secrets: TSecrets | null;
  lastTestedAt: Date | null;
  lastTestStatus: 'UNTESTED' | 'OK' | 'FAILED';
  lastTestError: string | null;
}

/**
 * Load + decrypt a credential row. Returns `null` when the row is
 * missing OR `enabled=false` — callers fall back to env vars.
 *
 * The secrets payload is the JSON-decoded plaintext, typed by the
 * caller; non-secret config is returned as-is.
 */
export async function loadIntegration<TConfig, TSecrets>(
  provider: string,
): Promise<IntegrationRow<TConfig, TSecrets> | null> {
  const row = await prisma.integrationCredential.findUnique({
    where: { provider },
  });
  if (!row || !row.enabled) return null;
  let secrets: TSecrets | null = null;
  const env = asEnvelope(row.secrets);
  if (env) {
    try {
      const json = decrypt(env, ad(provider));
      secrets = JSON.parse(json) as TSecrets;
    } catch (err) {
      // A tampered or wrong-AD ciphertext signals an operational
      // problem; surface it loudly rather than silently falling
      // back to env vars (which could mask a real incident).
      throw new Error(
        `[integrations:${provider}] failed to decrypt secrets: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return {
    id: row.id,
    provider: row.provider,
    enabled: row.enabled,
    config: (row.config as TConfig) ?? ({} as TConfig),
    secrets,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
  };
}

/**
 * Raw lookup that ignores the enabled flag — used by the admin
 * UI to show the current state regardless of whether it's live.
 */
export async function adminLoadIntegration<TConfig, TSecrets>(
  provider: string,
): Promise<
  (IntegrationRow<TConfig, TSecrets> & { hasSecrets: boolean }) | null
> {
  const row = await prisma.integrationCredential.findUnique({
    where: { provider },
  });
  if (!row) return null;
  let secrets: TSecrets | null = null;
  const env = asEnvelope(row.secrets);
  const hasSecrets = !!env;
  if (env) {
    try {
      const json = decrypt(env, ad(provider));
      secrets = JSON.parse(json) as TSecrets;
    } catch {
      secrets = null;
    }
  }
  return {
    id: row.id,
    provider: row.provider,
    enabled: row.enabled,
    config: (row.config as TConfig) ?? ({} as TConfig),
    secrets,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    hasSecrets,
  };
}

/**
 * Upsert config + secrets atomically. Secrets are JSON-encoded
 * before encryption so multi-field shapes round-trip cleanly. Pass
 * `secrets: null` to leave the existing ciphertext untouched (the
 * common "edit non-secret fields only" path); pass an empty object
 * `{}` to clear them.
 */
export async function saveIntegration(args: {
  provider: string;
  config: Record<string, unknown>;
  /** null = leave existing secrets, {} or non-empty = replace. */
  secrets: Record<string, unknown> | null;
  enabled: boolean;
  staffUserId: string;
}): Promise<void> {
  const data: Prisma.IntegrationCredentialUpdateInput = {
    config: args.config as Prisma.InputJsonValue,
    enabled: args.enabled,
    lastUpdatedByStaffUserId: args.staffUserId,
  };
  if (args.secrets !== null) {
    if (Object.keys(args.secrets).length === 0) {
      data.secrets = Prisma.JsonNull;
    } else {
      const env = encrypt(JSON.stringify(args.secrets), ad(args.provider));
      data.secrets = env as unknown as Prisma.InputJsonValue;
    }
  }
  await prisma.integrationCredential.update({
    where: { provider: args.provider },
    data,
  });
}

/**
 * Stamp the result of an integration test. Used by .test mutations
 * across providers — keeps the audit story honest.
 */
export async function recordTestResult(args: {
  provider: string;
  ok: boolean;
  error?: string;
}): Promise<void> {
  await prisma.integrationCredential.update({
    where: { provider: args.provider },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: args.ok ? 'OK' : 'FAILED',
      lastTestError: args.ok ? null : (args.error ?? 'Unknown error'),
    },
  });
}
