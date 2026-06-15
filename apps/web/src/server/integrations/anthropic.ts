/**
 * Phase 7 follow-up — Anthropic (Claude) credential resolver.
 *
 * Same pattern as the other Phase 5.6 integrations (whatsapp_meta,
 * smtp_default, resend, railway_worker). Reads the `anthropic_llm`
 * IntegrationCredential row when enabled; falls back to the
 * ANTHROPIC_API_KEY env var so the previous deploy stays functional.
 */
import { cache } from 'react';

import { loadIntegration } from './credential-store';

const PROVIDER = 'anthropic_llm';

export interface AnthropicConfig {
  /** Optional model override; defaults to the package's ACTIVE_MODEL. */
  model?: string;
}

export interface AnthropicSecrets {
  apiKey: string;
}

export interface ResolvedAnthropic {
  apiKey: string | null;
  model: string | null;
  source: 'db' | 'env';
}

async function load(): Promise<ResolvedAnthropic> {
  const row = await loadIntegration<AnthropicConfig, AnthropicSecrets>(
    PROVIDER,
  );
  if (row && row.secrets?.apiKey) {
    return {
      apiKey: row.secrets.apiKey,
      model: row.config.model ?? null,
      source: 'db',
    };
  }
  return {
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    model: null,
    source: 'env',
  };
}

/** Per-request cached resolver. */
export const getAnthropicCredentials = cache(load);

/**
 * Test by sending a 1-token completion — cheapest valid call. Returns
 * `{ ok, error? }` so callers can record the test result.
 */
export async function testAnthropicCredentials(args: {
  apiKey: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with just: ok' }],
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      return {
        ok: false,
        error:
          body?.error?.message ??
          `Anthropic returned ${res.status} ${res.statusText}`,
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
