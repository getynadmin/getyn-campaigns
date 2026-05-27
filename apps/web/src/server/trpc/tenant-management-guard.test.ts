/**
 * Phase 5 M5 — assertManagedDirectly guard.
 *
 * The function is called by every tenant-membership mutation path
 * (invite/revoke/update-role/remove). Tiny but consequential —
 * a regression here would let SSO tenants drift out of sync with
 * G-Suite's source of truth. Lock it down.
 */
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { assertManagedDirectly } from './tenant-management-guard';

describe('assertManagedDirectly', () => {
  it('allows DIRECT-provisioned tenants', () => {
    expect(() =>
      assertManagedDirectly({ provisioningSource: 'DIRECT' }),
    ).not.toThrow();
  });

  it('blocks G_SUITE-provisioned tenants with TRPCError', () => {
    expect(() =>
      assertManagedDirectly({ provisioningSource: 'G_SUITE' }),
    ).toThrow(TRPCError);
  });

  it('surfaces a customer-friendly message on block', () => {
    try {
      assertManagedDirectly({ provisioningSource: 'G_SUITE' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const msg = (err as TRPCError).message;
      expect(msg).toMatch(/G-Suite/);
      // Don't reveal internal codenames or stack details.
      expect(msg).not.toMatch(/provisioningSource/i);
    }
  });
});
