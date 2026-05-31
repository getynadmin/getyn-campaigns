/**
 * Phase 5.5 M8 — limit resolution priority.
 *
 * Locks down the documented order:
 *   1. Most-recent non-expired TenantLimitOverride
 *   2. Subscription plan feature
 *   3. 0 (paid surface blocked by default)
 *
 * The test mocks @getyn/db at the module boundary so the resolver's
 * pure logic — which override wins when stacked, expired rows are
 * ignored, no subscription = 0 — can be exercised without a real
 * Postgres.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@getyn/db', () => ({
  PlanMetric: {
    CONTACTS: 'CONTACTS',
    EMAILS_PER_MONTH: 'EMAILS_PER_MONTH',
    WA_MESSAGES_PER_MONTH: 'WA_MESSAGES_PER_MONTH',
    SMS_SEGMENTS_PER_MONTH: 'SMS_SEGMENTS_PER_MONTH',
    AI_CREDITS_PER_MONTH: 'AI_CREDITS_PER_MONTH',
    CUSTOM_SENDING_DOMAINS: 'CUSTOM_SENDING_DOMAINS',
    USER_SEATS: 'USER_SEATS',
  },
  prisma: {
    subscription: { findUnique: vi.fn() },
    tenantLimitOverride: { findMany: vi.fn() },
  },
}));

import { prisma } from '@getyn/db';
import { resolveTenantLimits } from './resolve-limits';

const mockSub = prisma.subscription.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockOverrides = prisma.tenantLimitOverride
  .findMany as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveTenantLimits', () => {
  it('falls back to 0 for every metric when the tenant has no subscription', async () => {
    mockSub.mockResolvedValueOnce(null);
    mockOverrides.mockResolvedValueOnce([]);

    const limits = await resolveTenantLimits('tenant_1');
    for (const v of Object.values(limits)) expect(v).toBe(0);
  });

  it('uses plan feature when no override applies', async () => {
    mockSub.mockResolvedValueOnce({
      plan: {
        features: [
          { metric: 'EMAILS_PER_MONTH', included: 10_000 },
          { metric: 'CONTACTS', included: 1_000 },
        ],
      },
    });
    mockOverrides.mockResolvedValueOnce([]);

    const limits = await resolveTenantLimits('tenant_1');
    expect(limits.EMAILS_PER_MONTH).toBe(10_000);
    expect(limits.CONTACTS).toBe(1_000);
    // Unset metric → 0.
    expect(limits.AI_CREDITS_PER_MONTH).toBe(0);
  });

  it('lets a non-expired override beat the plan feature', async () => {
    mockSub.mockResolvedValueOnce({
      plan: { features: [{ metric: 'EMAILS_PER_MONTH', included: 10_000 }] },
    });
    mockOverrides.mockResolvedValueOnce([
      {
        metric: 'EMAILS_PER_MONTH',
        included: 50_000,
        expiresAt: new Date(Date.now() + 86_400_000), // tomorrow
      },
    ]);

    const limits = await resolveTenantLimits('tenant_1');
    expect(limits.EMAILS_PER_MONTH).toBe(50_000);
  });

  it('ignores an expired override and falls back to the plan feature', async () => {
    mockSub.mockResolvedValueOnce({
      plan: { features: [{ metric: 'EMAILS_PER_MONTH', included: 10_000 }] },
    });
    mockOverrides.mockResolvedValueOnce([
      {
        metric: 'EMAILS_PER_MONTH',
        included: 50_000,
        expiresAt: new Date(Date.now() - 86_400_000), // yesterday
      },
    ]);

    const limits = await resolveTenantLimits('tenant_1');
    expect(limits.EMAILS_PER_MONTH).toBe(10_000);
  });

  it('picks the most recent override when multiple non-expired stack on the same metric', async () => {
    mockSub.mockResolvedValueOnce({
      plan: { features: [{ metric: 'EMAILS_PER_MONTH', included: 10_000 }] },
    });
    // Resolver expects callers to pass `orderBy: { createdAt: 'desc' }`
    // — verify with order applied.
    mockOverrides.mockResolvedValueOnce([
      { metric: 'EMAILS_PER_MONTH', included: 99_000, expiresAt: null }, // most recent
      { metric: 'EMAILS_PER_MONTH', included: 50_000, expiresAt: null },
    ]);

    const limits = await resolveTenantLimits('tenant_1');
    expect(limits.EMAILS_PER_MONTH).toBe(99_000);
  });

  it('treats null expiresAt as permanent (non-expired)', async () => {
    mockSub.mockResolvedValueOnce({
      plan: { features: [{ metric: 'CONTACTS', included: 1_000 }] },
    });
    mockOverrides.mockResolvedValueOnce([
      { metric: 'CONTACTS', included: -1, expiresAt: null }, // unlimited, forever
    ]);

    const limits = await resolveTenantLimits('tenant_1');
    expect(limits.CONTACTS).toBe(-1);
  });
});
