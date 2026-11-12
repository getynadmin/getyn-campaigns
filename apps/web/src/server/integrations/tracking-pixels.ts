import { cache } from 'react';

import { loadIntegration } from './credential-store';

/**
 * Tracking pixels — Meta Pixel + Google Ads / GA4.
 *
 * Config only, no secrets. Pixel IDs, GA measurement IDs, Google Tag
 * IDs, Ads conversion IDs + labels are all public identifiers meant
 * to be shipped in the browser, so we store them under `config` and
 * leave the encrypted `secrets` blob empty.
 *
 * Stored under a single `meta-pixel` IntegrationCredential row (kept
 * for backward compat with the existing data) whose `config` carries
 * every field below. The row's `enabled` flag is the master switch —
 * when off, nothing fires anywhere.
 */
const PROVIDER = 'meta-pixel';

export interface MetaPixelConfig {
  pixelId?: string;
  gaId?: string;
  gtagId?: string;
  adsConversionId?: string;
  adsPurchaseLabel?: string;
  adsAddToCartLabel?: string;
}

export interface ResolvedTrackingPixels {
  enabled: boolean;
  metaPixelId: string | null;
  metaPixelEnabled: boolean;
  gaId: string | null;
  gtagId: string | null;
  adsConversionId: string | null;
  adsPurchaseLabel: string | null;
  adsAddToCartLabel: string | null;
}

/**
 * Normalizes a Google Ads conversion id. Accepts a bare numeric id
 * (adds `AW-` prefix) or an already-prefixed `AW-…`, `G-…`, `GT-…`,
 * `GTM-…` id. Returns null for empty strings.
 */
export function normalizeAdsId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^(AW|G|GT|GTM)-/i.test(v)) return v;
  if (/^\d+$/.test(v)) return `AW-${v}`;
  return v;
}

async function load(): Promise<ResolvedTrackingPixels> {
  try {
    const row = await loadIntegration<MetaPixelConfig, Record<string, never>>(
      PROVIDER,
    );
    const cfg = row?.config ?? {};
    const enabled = !!row?.enabled;
    const pixelId = cfg.pixelId?.trim() || null;
    const gaId = cfg.gaId?.trim() || null;
    const gtagId = cfg.gtagId?.trim() || null;
    const adsConversionId = normalizeAdsId(cfg.adsConversionId);
    const adsPurchaseLabel = cfg.adsPurchaseLabel?.trim() || null;
    const adsAddToCartLabel = cfg.adsAddToCartLabel?.trim() || null;
    return {
      enabled,
      metaPixelId: enabled ? pixelId : null,
      metaPixelEnabled: enabled && !!pixelId,
      gaId: enabled ? gaId : null,
      gtagId: enabled ? gtagId : null,
      adsConversionId: enabled ? adsConversionId : null,
      adsPurchaseLabel: enabled ? adsPurchaseLabel : null,
      adsAddToCartLabel: enabled ? adsAddToCartLabel : null,
    };
  } catch {
    // Fail-open — never break page rendering because pixel config
    // isn't reachable.
  }
  const envId = process.env.META_PIXEL_ID?.trim() || null;
  return {
    enabled: !!envId,
    metaPixelId: envId,
    metaPixelEnabled: !!envId,
    gaId: null,
    gtagId: null,
    adsConversionId: null,
    adsPurchaseLabel: null,
    adsAddToCartLabel: null,
  };
}

export const getTrackingPixels = cache(load);
