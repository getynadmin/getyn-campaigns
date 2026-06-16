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
import { cache } from 'react';

import { loadIntegration } from './credential-store';

const PROVIDER = 'openai_dalle';

export type DalleSize = '1024x1024' | '1792x1024' | '1024x1792';
export type DalleQuality = 'standard' | 'hd';
export type DalleStyle = 'vivid' | 'natural';

export interface DalleConfig {
  /** Optional model override; defaults to dall-e-3. */
  model?: string;
  defaultSize?: DalleSize;
  defaultQuality?: DalleQuality;
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
  model: 'dall-e-3',
  defaultSize: '1024x1024' as DalleSize,
  defaultQuality: 'standard' as DalleQuality,
  defaultStyle: 'vivid' as DalleStyle,
};

async function load(): Promise<ResolvedDalle> {
  const row = await loadIntegration<DalleConfig, DalleSecrets>(PROVIDER);
  if (row && row.secrets?.apiKey) {
    return {
      apiKey: row.secrets.apiKey,
      model: row.config.model ?? DEFAULTS.model,
      defaultSize: row.config.defaultSize ?? DEFAULTS.defaultSize,
      defaultQuality: row.config.defaultQuality ?? DEFAULTS.defaultQuality,
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
    const res = await fetch('https://api.openai.com/v1/models/dall-e-3', {
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
