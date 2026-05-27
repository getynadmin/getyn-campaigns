/**
 * Phase 5 M4 — tenant operational-state derivation.
 *
 * Locks down the resolution rules between Phase 1's legacy
 * `Tenant.billingStatus` enum and Phase 5's `BillingSubscription.status`.
 * Drives every write-guard in the codebase + the banner UI; a
 * regression here would block sends silently OR allow sends after
 * cancellation.
 */
import { describe, expect, it } from 'vitest';

import {
  assertWritable,
  deriveTenantState,
  isGraceExpired,
} from './tenant-state';

const tenant = (
  billingStatus: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED',
  settings: Record<string, unknown> = {},
) =>
  ({
    billingStatus,
    settings,
  }) as Parameters<typeof deriveTenantState>[0];

const sub = (
  status:
    | 'TRIALING'
    | 'ACTIVE'
    | 'PAST_DUE'
    | 'CANCELED'
    | 'SUSPENDED',
  overrides: Partial<{ cancelAt: Date; currentPeriodEnd: Date }> = {},
) =>
  ({
    status,
    cancelAt: overrides.cancelAt ?? null,
    currentPeriodEnd: overrides.currentPeriodEnd ?? new Date(),
  }) as Parameters<typeof deriveTenantState>[1];

describe('deriveTenantState', () => {
  describe('with a BillingSubscription (Phase 5 path)', () => {
    it('reports ACTIVE for status=ACTIVE', () => {
      const state = deriveTenantState(tenant('ACTIVE'), sub('ACTIVE'));
      expect(state.mode).toBe('ACTIVE');
      expect(state.blocksWrites).toBe(false);
    });

    it('reports ACTIVE for status=TRIALING (treat trial as active for guards)', () => {
      const state = deriveTenantState(tenant('TRIALING'), sub('TRIALING'));
      expect(state.mode).toBe('ACTIVE');
      expect(state.blocksWrites).toBe(false);
    });

    it('reports READ_ONLY for status=CANCELED with cancelAt', () => {
      const cancelAt = new Date('2026-05-01T00:00:00Z');
      const state = deriveTenantState(
        tenant('CANCELED'),
        sub('CANCELED', { cancelAt }),
      );
      expect(state.mode).toBe('READ_ONLY');
      expect(state.blocksWrites).toBe(true);
      expect(state.blocksInboundProcessing).toBe(false);
      // 30 days after cancelAt
      const expected = new Date(
        cancelAt.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      expect(state.readOnlyUntil?.toISOString()).toBe(expected.toISOString());
    });

    it('reports SUSPENDED with blocksInboundProcessing=true', () => {
      const state = deriveTenantState(tenant('ACTIVE'), sub('SUSPENDED'));
      expect(state.mode).toBe('SUSPENDED');
      expect(state.blocksWrites).toBe(true);
      expect(state.blocksInboundProcessing).toBe(true);
    });

    it('keeps sends going on PAST_DUE (dunning grace period)', () => {
      const state = deriveTenantState(tenant('PAST_DUE'), sub('PAST_DUE'));
      expect(state.mode).toBe('ACTIVE');
      expect(state.blocksWrites).toBe(false);
      expect(state.reason).toMatch(/past due/i);
    });
  });

  describe('without a BillingSubscription (Phase 1 fallback)', () => {
    it('reports ACTIVE on TRIALING / ACTIVE', () => {
      expect(deriveTenantState(tenant('TRIALING'), null).mode).toBe('ACTIVE');
      expect(deriveTenantState(tenant('ACTIVE'), null).mode).toBe('ACTIVE');
    });

    it('reports READ_ONLY when legacy enum says CANCELED', () => {
      const state = deriveTenantState(tenant('CANCELED'), null);
      expect(state.mode).toBe('READ_ONLY');
      expect(state.blocksWrites).toBe(true);
    });

    it('reports PURGING when settings.purging=true', () => {
      const state = deriveTenantState(
        tenant('ACTIVE', { purging: true }),
        null,
      );
      expect(state.mode).toBe('PURGING');
      expect(state.blocksWrites).toBe(true);
      expect(state.blocksInboundProcessing).toBe(true);
    });
  });

  describe('BillingSubscription wins over legacy enum on conflict', () => {
    // The subscription mirror is the source of truth post-M3. If
    // legacy says CANCELED but the mirror says ACTIVE (re-activation
    // mid-sync), trust the mirror.
    it('mirror=ACTIVE overrides legacy=CANCELED', () => {
      expect(
        deriveTenantState(tenant('CANCELED'), sub('ACTIVE')).mode,
      ).toBe('ACTIVE');
    });

    it('mirror=SUSPENDED overrides legacy=ACTIVE', () => {
      expect(
        deriveTenantState(tenant('ACTIVE'), sub('SUSPENDED')).mode,
      ).toBe('SUSPENDED');
    });
  });
});

describe('isGraceExpired', () => {
  it('false when grace window is in the future', () => {
    const state = deriveTenantState(
      tenant('CANCELED'),
      sub('CANCELED', { cancelAt: new Date() }),
    );
    expect(isGraceExpired(state)).toBe(false);
  });

  it('true when the canceled-at timestamp is older than 30 days', () => {
    const cancelAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const state = deriveTenantState(
      tenant('CANCELED'),
      sub('CANCELED', { cancelAt }),
    );
    expect(isGraceExpired(state)).toBe(true);
  });

  it('false for ACTIVE / SUSPENDED (no grace concept)', () => {
    expect(
      isGraceExpired(deriveTenantState(tenant('ACTIVE'), sub('ACTIVE'))),
    ).toBe(false);
    expect(
      isGraceExpired(deriveTenantState(tenant('ACTIVE'), sub('SUSPENDED'))),
    ).toBe(false);
  });
});

describe('assertWritable', () => {
  it('returns void on ACTIVE', () => {
    expect(() =>
      assertWritable(deriveTenantState(tenant('ACTIVE'), sub('ACTIVE'))),
    ).not.toThrow();
  });

  it('throws on READ_ONLY', () => {
    expect(() =>
      assertWritable(deriveTenantState(tenant('CANCELED'), sub('CANCELED'))),
    ).toThrow();
  });

  it('throws on SUSPENDED', () => {
    expect(() =>
      assertWritable(deriveTenantState(tenant('ACTIVE'), sub('SUSPENDED'))),
    ).toThrow();
  });

  it('throws on PURGING', () => {
    expect(() =>
      assertWritable(
        deriveTenantState(tenant('ACTIVE', { purging: true }), null),
      ),
    ).toThrow();
  });
});
