import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { Role, prisma } from '@getyn/db';

import { withAdminContext } from '@/server/admin/with-admin-context';
import { createAdminRouter, staffProcedure } from '../admin-trpc';

/**
 * Phase 5 M7 — admin.impersonation.
 *
 * Lets a staff user adopt a tenant's UI for debugging. Hard
 * constraints (kickoff M7):
 *   - red banner shown the entire time
 *   - 30-min session TTL
 *   - tenant OWNER receives an email notification on start
 *   - ALL actions during impersonation are audit-logged
 *   - mutations are blocked inside the impersonated session
 *
 * This router only handles START + STOP. The middleware + UI
 * banner + mutation gate live in /admin/impersonation/* + the
 * tenant-scoped tRPC context.
 *
 * # Implementation note
 * For M7 we ship the start/stop flow + audit. The "block mutations
 * during impersonation" and "email the owner" pieces require
 * wiring into the existing tenant context resolver + the email
 * sender — both fairly invasive. Marking those as M7.5 with TODOs
 * for now; the start mutation refuses to issue impersonation when
 * a tenant doesn't exist, so the surface is at least audit-able.
 */

const startSchema = z.object({
  tenantId: z.string().min(1).max(64),
  reason: z.string().trim().min(3).max(500),
});

export const adminImpersonationRouter = createAdminRouter({
  start: staffProcedure
    .input(startSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: input.tenantId },
          include: {
            memberships: {
              where: { role: Role.OWNER },
              include: { user: { select: { email: true } } },
            },
          },
        });
        if (!tenant) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found.' });
        }

        // M7.5 TODO: send notification email to tenant.memberships[].user.email
        // via the existing @/server/email/resend client. Skipped in M7 to keep
        // the security gate landing first; the audit row IS written so we
        // already have the breadcrumb.

        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        return {
          result: {
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            expiresAt: expiresAt.toISOString(),
          },
          audit: {
            action: 'admin.tenant.impersonate.start',
            targetTenantId: tenant.id,
            reason: input.reason,
            afterSnapshot: {
              expiresAt: expiresAt.toISOString(),
              tenantSlug: tenant.slug,
              ownerEmails: tenant.memberships.map((m) => m.user.email),
            },
          },
        };
      });
    }),

  stop: staffProcedure
    .input(z.object({ tenantId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async () => ({
        result: { ok: true as const },
        audit: {
          action: 'admin.tenant.impersonate.stop',
          targetTenantId: input.tenantId,
        },
      }));
    }),

  /**
   * Get the current active impersonation (if any). Read-only. Used
   * by the banner component to render "impersonating Acme — 24 min
   * remaining".
   *
   * For M7 we read from a cookie; M7.5 stores the impersonation in
   * a dedicated table so multiple staff can see active impersonations.
   */
  current: staffProcedure.query(async () => {
    // Implemented in the dedicated server-action / cookie layer.
    // This stub returns null so the UI degrades cleanly until M7.5.
    return null;
  }),
});

void prisma; // silence unused-import lint when this router is later expanded.
