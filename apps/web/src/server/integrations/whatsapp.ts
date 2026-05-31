/**
 * Phase 5.6 M2 — WhatsApp (Meta) credential resolver.
 *
 * Read order:
 *   1. IntegrationCredential row (provider='whatsapp_meta') when enabled
 *   2. Env vars (META_APP_ID, META_APP_SECRET, META_CONFIG_ID,
 *      WHATSAPP_WEBHOOK_VERIFY_TOKEN) — Phase 4 path, preserved during
 *      migration so the app keeps working before admin fills in the UI
 *
 * Resolver is exported as a cached lookup so a single request only
 * hits the DB once. Worker-side callers (apps/worker) should mirror
 * this pattern with a 60s cache.
 */
import { cache } from 'react';

import { loadIntegration } from './credential-store';

const PROVIDER = 'whatsapp_meta';

export interface WhatsAppConfig {
  /** Meta App ID — public (safe to log) */
  appId: string | null;
  /** Embedded Signup configuration id (public) */
  configId: string | null;
}

export interface WhatsAppSecrets {
  /** Meta App Secret — used for webhook signature verification */
  appSecret: string;
  /** Token Meta sends on webhook subscription verify GET */
  webhookVerifyToken: string;
}

export interface WhatsAppCredentials {
  appId: string | null;
  configId: string | null;
  appSecret: string | null;
  webhookVerifyToken: string | null;
  /** Where this value came from — useful for debug pages + tests. */
  source: 'db' | 'env';
}

async function load(): Promise<WhatsAppCredentials> {
  const row = await loadIntegration<WhatsAppConfig, WhatsAppSecrets>(PROVIDER);
  if (row && row.secrets) {
    return {
      appId: row.config.appId ?? null,
      configId: row.config.configId ?? null,
      appSecret: row.secrets.appSecret ?? null,
      webhookVerifyToken: row.secrets.webhookVerifyToken ?? null,
      source: 'db',
    };
  }
  // Env-var fallback (Phase 4 path).
  return {
    appId: process.env.META_APP_ID ?? null,
    configId: process.env.META_CONFIG_ID ?? null,
    appSecret: process.env.META_APP_SECRET ?? null,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null,
    source: 'env',
  };
}

/** Per-request cached resolver. */
export const getWhatsAppCredentials = cache(load);

/**
 * Test the configured credentials against Meta's `/debug_token`
 * endpoint. Returns `{ ok, error? }` so callers can record the
 * test result in IntegrationCredential.
 *
 * Uses the App Access Token form: `{appId}|{appSecret}`. Calling
 * debug_token against the App Access Token itself returns the token
 * info iff the secret is valid — the cheapest valid health check.
 */
export async function testWhatsAppCredentials(args: {
  appId: string;
  appSecret: string;
}): Promise<{ ok: boolean; error?: string }> {
  const appAccessToken = `${args.appId}|${args.appSecret}`;
  const url = `https://graph.facebook.com/v22.0/debug_token?input_token=${encodeURIComponent(
    appAccessToken,
  )}&access_token=${encodeURIComponent(appAccessToken)}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      return {
        ok: false,
        error:
          body?.error?.message ??
          `Meta returned ${res.status} ${res.statusText}`,
      };
    }
    const body = (await res.json().catch(() => null)) as
      | { data?: { is_valid?: boolean; error?: { message?: string } } }
      | null;
    if (body?.data?.is_valid === false) {
      return {
        ok: false,
        error: body.data.error?.message ?? 'Meta reports token invalid.',
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}
