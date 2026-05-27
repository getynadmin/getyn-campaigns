/**
 * Phase 5 M4 — single-call write guard.
 *
 * Drop this at the top of any tRPC mutation that should be blocked
 * under READ_ONLY / SUSPENDED / PURGING. Throws TRPCError with a
 * customer-facing message when the tenant isn't writable.
 *
 *   await assertTenantActive(tenantId);
 *
 * The check costs one indexed SELECT (Tenant + BillingSubscription
 * join). Cheap enough to call on every paid mutation; cache it in
 * tRPC context if a heavily-hit mutation surfaces in profiling.
 */
import { TRPCError } from '@trpc/server';

import { prisma } from '@getyn/db';

import { assertWritable, deriveTenantState } from './tenant-state';

export async function assertTenantActive(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      billingStatus: true,
      settings: true,
      billingSubscription: {
        select: {
          status: true,
          cancelAt: true,
          currentPeriodEnd: true,
        },
      },
    },
  });
  if (!tenant) return; // tenantProcedure already handled missing tenant
  const state = deriveTenantState(
    { billingStatus: tenant.billingStatus, settings: tenant.settings },
    tenant.billingSubscription,
  );
  try {
    assertWritable(state);
  } catch (err) {
    // The shared assertWritable throws a plain Error so the worker
    // can use it too. tRPC callsites prefer a TRPCError so the
    // tRPC client maps it to a `FORBIDDEN` shape on the wire.
    if (err instanceof Error && err.name === 'TenantNotWritableError') {
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    throw err;
  }
}
