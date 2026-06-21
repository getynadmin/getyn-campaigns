/**
 * tRPC router for the Email Verifier surface at
 * /t/[slug]/audience/email-verifier.
 *
 * Two procedures:
 *   - scan: read-only, returns counts + samples per category
 *   - cleanup: marks every contact in the selected categories as
 *     UNSUBSCRIBED. OWNER / ADMIN only — irreversible at scale.
 */
import { z } from 'zod';

import { Role } from '@getyn/db';

import {
  cleanupTenantContacts,
  deepScanTenantContacts,
  scanTenantContacts,
} from '@/server/audience/email-verifier';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

const categorySchema = z.enum([
  'INVALID_SYNTAX',
  'ALREADY_BOUNCED',
  'TYPO_SUSPICIOUS',
  'DISPOSABLE',
  'ROLE_BASED',
  'DEAD_DOMAIN',
]);

export const emailVerifierRouter = createTRPCRouter({
  scan: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return scanTenantContacts(tenantId);
    }),

  /**
   * Deep scan — basic scan + per-domain MX-record probe. Takes
   * meaningfully longer (≈ 50ms per unique domain at 50-way
   * concurrency, so ~20s for a 2k-domain tenant) so it's exposed as
   * a separate mutation rather than auto-running on page load.
   */
  deepScan: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .mutation(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return deepScanTenantContacts(tenantId);
    }),

  cleanup: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        categories: z.array(categorySchema).min(1).max(5),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return cleanupTenantContacts({
        tenantId,
        categories: input.categories,
      });
    }),
});
