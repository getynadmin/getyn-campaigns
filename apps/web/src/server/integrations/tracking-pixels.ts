import { cache } from 'react';

import { loadIntegration } from './credential-store';

/**
 * Tracking pixels — Meta / Facebook Pixel today, room for GA4 /
 * LinkedIn / TikTok later behind the same provider row.
 *
 * Config only — no secrets. Pixel IDs are public identifiers meant
 * to be shipped in the browser, so we store them under `config` and
 * leave the encrypted `secrets` blob empty. (When we add the CAPI
 * access token later, that goes into secrets.)
 */
const PROVIDER = 'meta-pixel';

export interface MetaPixelConfig {
  pixelId?: string;
}

export interface ResolvedTrackingPixels {
  metaPixelId: string | null;
  metaPixelEnabled: boolean;
}

async function load(): Promise<ResolvedTrackingPixels> {
  try {
    const row = await loadIntegration<MetaPixelConfig, Record<string, never>>(
      PROVIDER,
    );
    if (row?.enabled && row.config.pixelId) {
      return {
        metaPixelId: row.config.pixelId,
        metaPixelEnabled: true,
      };
    }
  } catch {
    // Fail-open — never break page rendering because pixel config
    // isn't reachable.
  }
  const envId = process.env.META_PIXEL_ID?.trim() || null;
  return {
    metaPixelId: envId,
    metaPixelEnabled: !!envId,
  };
}

export const getTrackingPixels = cache(load);
