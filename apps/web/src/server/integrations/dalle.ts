/**
 * Phase 7.2 — DALL-E (OpenAI) credential resolver.
 *
 * Same shape as the Anthropic resolver. Lives in its own provider row
 * `openai_dalle` so the admin can tune image-gen-specific settings
 * (default size/quality/style) without touching the LLM key (when
 * one exists). The "share with openai_llm key" toggle from the spec
 * is deferred until an openai_llm row actually exists — for now the
 * DALL-E row carries its own key.
 */
import { cache as reactCache } from 'react';

import { loadIntegration } from './credential-store';

// React's `cache` returns undefined in non-React runtimes (vitest node
// env). Fall back to identity so this module loads cleanly under test
// — production still gets per-request memoization.
const cache: typeof reactCache =
  typeof reactCache === 'function' ? reactCache : ((fn) => fn);

const PROVIDER = 'openai_dalle';

/** Sizes accepted by `gpt-image-2`. The old DALL-E 3 set
 *  (1024x1792 / 1792x1024) is gone. */
export type DalleSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

/** gpt-image-2 quality enum (replaces the DALL-E 3 standard/hd pair). */
export type DalleQuality = 'low' | 'medium' | 'high' | 'auto';

/** Retained for backward-compat with any DALL-E 3 config rows the
 *  admin may have saved before the migration. The agent doesn't send
 *  this on gpt-image-2 calls. */
export type DalleStyle = 'vivid' | 'natural';

export interface DalleConfig {
  /** Optional model override; defaults to gpt-image-2. */
  model?: string;
  defaultSize?: DalleSize;
  defaultQuality?: DalleQuality;
  /** Ignored on gpt-image-2; kept on the type to read legacy rows. */
  defaultStyle?: DalleStyle;
}

export interface DalleSecrets {
  apiKey: string;
}

export interface ResolvedDalle {
  apiKey: string | null;
  model: string;
  defaultSize: DalleSize;
  defaultQuality: DalleQuality;
  defaultStyle: DalleStyle;
  enabled: boolean;
  source: 'db' | 'env';
}

const DEFAULTS = {
  model: 'gpt-image-2',
  defaultSize: '1024x1024' as DalleSize,
  defaultQuality: 'medium' as DalleQuality,
  defaultStyle: 'vivid' as DalleStyle, // unused on gpt-image-2
};

/** Old DALL-E 3 quality values rows persisted before the gpt-image-2
 *  migration map to the closest gpt-image-2 equivalent. */
function migrateQuality(q: DalleQuality | string | undefined): DalleQuality {
  if (q === 'standard') return 'medium';
  if (q === 'hd') return 'high';
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'auto') return q;
  return DEFAULTS.defaultQuality;
}

function migrateSize(s: DalleSize | string | undefined): DalleSize {
  if (s === '1792x1024') return '1536x1024';
  if (s === '1024x1792') return '1024x1536';
  if (
    s === '1024x1024' ||
    s === '1024x1536' ||
    s === '1536x1024' ||
    s === 'auto'
  ) {
    return s;
  }
  return DEFAULTS.defaultSize;
}

async function load(): Promise<ResolvedDalle> {
  const row = await loadIntegration<DalleConfig, DalleSecrets>(PROVIDER);
  if (row && row.secrets?.apiKey) {
    return {
      apiKey: row.secrets.apiKey,
      model: row.config.model || DEFAULTS.model,
      defaultSize: migrateSize(row.config.defaultSize),
      defaultQuality: migrateQuality(row.config.defaultQuality),
      defaultStyle: row.config.defaultStyle ?? DEFAULTS.defaultStyle,
      enabled: true,
      source: 'db',
    };
  }
  return {
    apiKey: process.env.OPENAI_API_KEY ?? null,
    ...DEFAULTS,
    enabled: false,
    source: 'env',
  };
}

export const getDalleCredentials = cache(load);

/**
 * Test the key by listing models — cheapest valid call (no image
 * generation cost). Confirms the key + that the account has DALL-E
 * access without spending money on a real generation.
 */
export async function testDalleCredentials(args: {
  apiKey: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/models/gpt-image-2', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${args.apiKey}`,
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      return {
        ok: false,
        error:
          body?.error?.message ??
          `OpenAI returned ${res.status} ${res.statusText}`,
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
