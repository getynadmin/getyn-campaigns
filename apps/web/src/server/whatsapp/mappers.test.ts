/**
 * Phase 4 M4 / M12 — Meta string-to-enum mappers.
 *
 * Meta has shipped both string and numeric variants for the
 * messaging-tier field over time. The mappers normalise to our
 * Prisma enums; bugs here mean the UI shows the wrong tier label
 * or the rate-limit handler picks the wrong ceiling.
 */
import {
  WADisplayPhoneStatus,
  WAMessagingTier,
  WAQualityRating,
} from '@getyn/db';
import {
  mapPhoneStatus,
  mapQuality,
  mapTier,
} from '@getyn/whatsapp';
import { describe, expect, it } from 'vitest';

describe('mapTier', () => {
  it('maps known string tiers', () => {
    expect(mapTier('TIER_50')).toBe(WAMessagingTier.TIER_50);
    expect(mapTier('TIER_250')).toBe(WAMessagingTier.TIER_250);
    expect(mapTier('TIER_1K')).toBe(WAMessagingTier.TIER_1K);
    expect(mapTier('TIER_10K')).toBe(WAMessagingTier.TIER_10K);
    expect(mapTier('TIER_100K')).toBe(WAMessagingTier.TIER_100K);
    expect(mapTier('TIER_UNLIMITED')).toBe(WAMessagingTier.TIER_UNLIMITED);
  });

  it('accepts numeric-suffixed variants Meta has shipped', () => {
    expect(mapTier('TIER_1000')).toBe(WAMessagingTier.TIER_1K);
    expect(mapTier('TIER_10000')).toBe(WAMessagingTier.TIER_10K);
    expect(mapTier('TIER_100000')).toBe(WAMessagingTier.TIER_100K);
  });

  it('falls back to TIER_50 on unknown / undefined input', () => {
    expect(mapTier(undefined)).toBe(WAMessagingTier.TIER_50);
    expect(mapTier('NEW_TIER_VARIANT')).toBe(WAMessagingTier.TIER_50);
    expect(mapTier('')).toBe(WAMessagingTier.TIER_50);
  });
});

describe('mapQuality', () => {
  it('maps the three colour-coded ratings', () => {
    expect(mapQuality('GREEN')).toBe(WAQualityRating.GREEN);
    expect(mapQuality('YELLOW')).toBe(WAQualityRating.YELLOW);
    expect(mapQuality('RED')).toBe(WAQualityRating.RED);
  });

  it('returns UNKNOWN for missing / odd input (no throw)', () => {
    expect(mapQuality(undefined)).toBe(WAQualityRating.UNKNOWN);
    expect(mapQuality('GRAY')).toBe(WAQualityRating.UNKNOWN);
    expect(mapQuality('')).toBe(WAQualityRating.UNKNOWN);
  });
});

describe('mapPhoneStatus', () => {
  it('maps every documented value', () => {
    expect(mapPhoneStatus('CONNECTED')).toBe(WADisplayPhoneStatus.CONNECTED);
    expect(mapPhoneStatus('PENDING_REVIEW')).toBe(
      WADisplayPhoneStatus.PENDING_REVIEW,
    );
    expect(mapPhoneStatus('FLAGGED')).toBe(WADisplayPhoneStatus.FLAGGED);
    expect(mapPhoneStatus('DISCONNECTED')).toBe(
      WADisplayPhoneStatus.DISCONNECTED,
    );
  });

  it('falls back to PENDING_REVIEW when Meta omits status', () => {
    expect(mapPhoneStatus(undefined)).toBe(
      WADisplayPhoneStatus.PENDING_REVIEW,
    );
    expect(mapPhoneStatus('UNKNOWN_FUTURE')).toBe(
      WADisplayPhoneStatus.PENDING_REVIEW,
    );
  });
});
