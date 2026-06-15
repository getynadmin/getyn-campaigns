/**
 * Worker-side Anthropic credential resolver. Mirrors the web's
 * `server/integrations/anthropic.ts` — pulls the `anthropic_llm`
 * IntegrationCredential row, decrypts the API key with the same AD,
 * falls back to ANTHROPIC_API_KEY env.
 *
 * Kept separate from the web copy because the credential-store helper
 * lives in `apps/web/` and isn't a shared package. Both paths use the
 * same `@getyn/crypto` envelope shape so a key written from the admin
 * UI decrypts cleanly here.
 */
import { prisma, type Prisma } from '@getyn/db';
import { decrypt, type EncryptedField } from '@getyn/crypto';

interface AnthropicSecrets {
  apiKey: string;
}

interface AnthropicConfig {
  model?: string;
}

let cached: { apiKey: string | null; expiresAt: number } | null = null;

function asEnvelope(value: Prisma.JsonValue | null): EncryptedField | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (
    typeof o.ciphertext !== 'string' ||
    typeof o.iv !== 'string' ||
    typeof o.authTag !== 'string' ||
    typeof o.keyVersion !== 'number'
  ) {
    return null;
  }
  return {
    ciphertext: o.ciphertext,
    iv: o.iv,
    authTag: o.authTag,
    keyVersion: o.keyVersion,
  };
}

/** Cached for 60s — admin updates are rare, and we don't want every
 *  parse job to round-trip the DB. */
const TTL_MS = 60_000;

export async function getAnthropicApiKey(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.apiKey;

  let apiKey: string | null = null;
  try {
    const row = await prisma.integrationCredential.findUnique({
      where: { provider: 'anthropic_llm' },
    });
    if (row?.enabled) {
      const env = asEnvelope(row.secrets);
      if (env) {
        try {
          const plain = decrypt(env, 'integration:anthropic_llm');
          const parsed = JSON.parse(plain) as AnthropicSecrets;
          if (parsed.apiKey) apiKey = parsed.apiKey;
        } catch {
          // Decrypt failure → fall through to env.
        }
      }
    }
  } catch {
    // DB hiccup → fall through to env.
  }

  if (!apiKey && process.env.ANTHROPIC_API_KEY) {
    apiKey = process.env.ANTHROPIC_API_KEY;
  }

  cached = { apiKey, expiresAt: Date.now() + TTL_MS };
  return apiKey;
}

export async function getAnthropicConfig(): Promise<AnthropicConfig> {
  try {
    const row = await prisma.integrationCredential.findUnique({
      where: { provider: 'anthropic_llm' },
    });
    if (row?.enabled) {
      return (row.config as AnthropicConfig) ?? {};
    }
  } catch {
    // ignore
  }
  return {};
}
