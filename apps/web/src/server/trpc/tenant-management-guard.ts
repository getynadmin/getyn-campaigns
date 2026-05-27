import { TRPCError } from '@trpc/server';

import { ProvisioningSource, type Tenant } from '@getyn/db';

/**
 * Phase 5 M5 — gate tenant-membership mutations.
 *
 * Under SSO, G-Suite is the source of truth for who's in a tenant
 * and what role they have. Local invites + role edits + removals
 * are blocked at the tRPC layer so a tenant admin can't drift the
 * Campaigns-side membership from G-Suite's.
 *
 * For DIRECT tenants (existing demo + anyone who signed up
 * pre-SSO) the Phase 1 invite UI stays fully functional.
 */
export function assertManagedDirectly(
  tenant: Pick<Tenant, 'provisioningSource'>,
): void {
  if (tenant.provisioningSource === ProvisioningSource.G_SUITE) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Team management is handled in G-Suite for this workspace. Add or remove members there; changes apply on their next sign-in.',
    });
  }
}
