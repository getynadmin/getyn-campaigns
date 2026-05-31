/**
 * Phase 5.6 M4a — Resend (tenant campaign email) credential resolver.
 *
 * Drives tenant marketing campaigns AND domain operations on Resend.
 * System notification emails go through the SMTP path (M3a) and
 * fall back to Resend only when SMTP is disabled.
 *
 * Fallback order matches the other providers: DB row when
 * `enabled=true`, env vars otherwise (RESEND_API_KEY,
 * RESEND_FROM_EMAIL, RESEND_WEBHOOK_SECRET).
 */
import { cache } from 'react';

import { loadIntegration } from './credential-store';

const PROVIDER = 'resend';

export interface ResendConfig {
  defaultFromEmail: string;
}

export interface ResendSecrets {
  apiKey: string;
  webhookSigningSecret?: string;
}

export interface ResolvedResend {
  apiKey: string | null;
  defaultFromEmail: string | null;
  webhookSigningSecret: string | null;
  source: 'db' | 'env';
}

async function load(): Promise<ResolvedResend> {
  const row = await loadIntegration<ResendConfig, ResendSecrets>(PROVIDER);
  if (row && row.secrets?.apiKey) {
    return {
      apiKey: row.secrets.apiKey,
      defaultFromEmail: row.config.defaultFromEmail ?? null,
      webhookSigningSecret: row.secrets.webhookSigningSecret ?? null,
      source: 'db',
    };
  }
  return {
    apiKey: process.env.RESEND_API_KEY ?? null,
    defaultFromEmail: process.env.RESEND_FROM_EMAIL ?? null,
    webhookSigningSecret: process.env.RESEND_WEBHOOK_SECRET ?? null,
    source: 'env',
  };
}

export const getResendCredentials = cache(load);

/**
 * Quick health check — Resend's `/domains` endpoint is the cheapest
 * authenticated call.
 */
export async function testResendCredentials(args: {
  apiKey: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${args.apiKey}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { message?: string }
        | null;
      return {
        ok: false,
        error: body?.message ?? `Resend returned ${res.status}`,
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
