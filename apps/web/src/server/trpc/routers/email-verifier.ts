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
  scanTenantContacts,
} from '@/server/audience/email-verifier';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

const categorySchema = z.enum([
  'INVALID_SYNTAX',
  'ALREADY_BOUNCED',
  'TYPO_SUSPICIOUS',
  'DISPOSABLE',
  'ROLE_BASED',
]);

export const emailVerifierRouter = createTRPCRouter({
  scan: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return scanTenantContacts(tenantId);
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
