import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  CampaignStatus,
  PlanMetric,
  SubscriptionStatus,
  WAStatus,
  prisma,
  type Prisma,
} from '@getyn/db';

import {
  auditStaffAccess,
  withAdminContext,
} from '@/server/admin/with-admin-context';
import {
  createAdminRouter,
  staffProcedure,
  supportAdminProcedure,
} from '../admin-trpc';

/**
 * Phase 5 M7 — admin.tenant.*
 *
 * Read + targeted mutations against any tenant. Designed for support
 * engineers debugging Campaigns-specific incidents — never for
 * plan/billing operations (those live in G-Suite).
 *
 * Every mutation goes through withAdminContext so a StaffAuditLog
 * row lands atomically with the change.
 *
 * # What's deliberately NOT here
 *  - plan editing (G-Suite owns)
 *  - billing operations
 *  - tenant creation (only SSO + manual signup paths)
 *  - cross-app management
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

const listInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  search: z.string().trim().min(1).max(120).optional(),
  // Mirrors the Phase 1 BillingStatus enum (no SUSPENDED — that's a
  // sendingPolicy.suspendedAt concern handled via `suspended` below).
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED']).optional(),
  provisioningSource: z.enum(['DIRECT', 'G_SUITE']).optional(),
  suspended: z.boolean().optional(),
});

const reasonSchema = z.object({
  id: z.string().min(1).max(64),
  reason: z.string().trim().min(3).max(500),
});

export const adminTenantsRouter = createAdminRouter({
  /**
   * Cross-tenant list with search + filter. Tenant-counts join so
   * the list page can show "X contacts, Y campaigns this month"
   * inline.
   */
  list: staffProcedure
    .input(listInputSchema)
    .query(async ({ input }) => {
      const startOfMonth = new Date();
      startOfMonth.setUTCDate(1);
      startOfMonth.setUTCHours(0, 0, 0, 0);

      const where: Prisma.TenantWhereInput = {
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: 'insensitive' } },
                { slug: { contains: input.search, mode: 'insensitive' } },
                { gSuiteOrgName: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(input.status ? { billingStatus: input.status } : {}),
        ...(input.provisioningSource
          ? { provisioningSource: input.provisioningSource }
          : {}),
        ...(input.suspended
          ? { sendingPolicy: { is: { suspendedAt: { not: null } } } }
          : {}),
      };

      const rows = await prisma.tenant.findMany({
        where,
        select: {
          id: true,
          slug: true,
          name: true,
          legacyPlanTier: true,
          billingStatus: true,
          provisioningSource: true,
          gSuiteTenantId: true,
          gSuiteOrgName: true,
          gSuiteSyncedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              contacts: true,
              memberships: true,
              campaigns: true,
            },
          },
          subscription: {
            select: { status: true, assignedAt: true, plan: { select: { slug: true, name: true } } },
          },
          sendingPolicy: {
            select: { suspendedAt: true, suspensionReason: true },
          },
          whatsAppAccount: {
            select: { status: true, displayName: true },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const next = rows.pop();
        nextCursor = next?.id ?? null;
      }
      return { items: rows, nextCursor };
    }),

  /**
   * Single-tenant detail. Includes counts, recent campaign activity,
   * channel health, subscription mirror, audit log. Same staff-
   * access audit row for every detail view (helps spot fishing).
   */
  get: staffProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: input.id },
        include: {
          subscription: { include: { plan: true } },
          whatsAppAccount: { include: { phoneNumbers: true } },
          sendingDomains: true,
          sendingPolicy: true,
          // Phase 5.5 M3: surface staff-set overrides on the detail
          // page so support can see + manage them inline.
          limitOverrides: { orderBy: { createdAt: 'desc' } },
          _count: {
            select: {
              contacts: true,
              memberships: true,
              campaigns: true,
              campaignSends: true,
              segments: true,
              importJobs: true,
            },
          },
        },
      });
      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found.' });
      }

      // Best-effort access audit — never blocks the read.
      void auditStaffAccess(ctx.staff, {
        action: 'admin.tenant.viewed',
        targetTenantId: tenant.id,
      });

      return tenant;
    }),

  /**
   * Re-sync subscription from G-Suite. M3 will replace this stub
   * with a real call to G-Suite. For now we just touch
   * gSuiteSyncedAt + audit so the UI button is wired end-to-end.
   *
   * Returns the audit row's id so the UI can show "synced at" + a
   * link to the audit entry.
   */
  resyncSubscription: staffProcedure
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: input.id },
          select: { id: true, gSuiteTenantId: true, gSuiteSyncedAt: true },
        });
        if (!tenant) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        if (!tenant.gSuiteTenantId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This tenant is not linked to G-Suite (DIRECT provisioning).',
          });
        }
        const before = { gSuiteSyncedAt: tenant.gSuiteSyncedAt };
        // M3 stub: real pullPlanFromGSuite lands once the G-Suite
        // contract is firm. For now we just stamp the timestamp so
        // ops sees the action took effect.
        const updated = await tx.tenant.update({
          where: { id: tenant.id },
          data: { gSuiteSyncedAt: new Date() },
          select: { gSuiteSyncedAt: true },
        });
        return {
          result: { gSuiteSyncedAt: updated.gSuiteSyncedAt },
          audit: {
            action: 'admin.tenant.resync_subscription',
            targetTenantId: tenant.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
          },
        };
      });
    }),

  /**
   * Emergency stop for a tenant's WhatsApp channel. Sets
   * WhatsAppAccount.status=DISCONNECTED (we don't revoke the token
   * here — the next refresh attempt will).
   */
  forceDisconnectWhatsApp: staffProcedure
    .input(reasonSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const account = await tx.whatsAppAccount.findUnique({
          where: { tenantId: input.id },
        });
        if (!account) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No WhatsApp account for this tenant.',
          });
        }
        const before = { status: account.status };
        const updated = await tx.whatsAppAccount.update({
          where: { id: account.id },
          data: {
            status: WAStatus.DISCONNECTED,
            disconnectedAt: new Date(),
          },
          select: { status: true, disconnectedAt: true },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.tenant.force_disconnect_whatsapp',
            targetTenantId: input.id,
            targetEntityId: account.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
            reason: input.reason,
          },
        };
      });
    }),

  /**
   * Manually lift a Phase 3 auto-suspension. Audit log captures the
   * reason for the lift (so we can correlate against the original
   * suspension trigger when reviewing).
   */
  liftSuspension: staffProcedure
    .input(reasonSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const policy = await tx.tenantSendingPolicy.findUnique({
          where: { tenantId: input.id },
        });
        if (!policy) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No sending policy row for this tenant.',
          });
        }
        if (!policy.suspendedAt) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Tenant is not currently suspended.',
          });
        }
        const before = {
          suspendedAt: policy.suspendedAt,
          suspensionReason: policy.suspensionReason,
        };
        const updated = await tx.tenantSendingPolicy.update({
          where: { tenantId: input.id },
          data: {
            suspendedAt: null,
            suspensionReason: null,
          },
          select: { suspendedAt: true, suspensionReason: true },
        });
        // Also resume PAUSED campaigns that paused on suspension.
        await tx.campaign.updateMany({
          where: {
            tenantId: input.id,
            status: CampaignStatus.PAUSED,
          },
          data: { status: CampaignStatus.SCHEDULED },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.tenant.lift_suspension',
            targetTenantId: input.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
            reason: input.reason,
          },
        };
      });
    }),

  // -------------------------------------------------------------------
  // Phase 5.5 M3 — plan assignment + limit overrides.
  // -------------------------------------------------------------------

  /**
   * Assign or change a tenant's plan. Upsert semantics: creates the
   * Subscription row when missing (first-time assignment from staff),
   * otherwise updates planId / status / currentPeriodEnd.
   *
   * Archived plans are rejected so we don't accidentally park a paying
   * tenant on a retired tier. Reason required for the audit log.
   */
  setSubscription: supportAdminProcedure
    .input(
      z.object({
        tenantId: z.string().min(1).max(64),
        planId: z.string().min(1).max(64),
        status: z.nativeEnum(SubscriptionStatus).default(SubscriptionStatus.ACTIVE),
        currentPeriodEnd: z.coerce.date().optional(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const [tenant, plan] = await Promise.all([
          tx.tenant.findUnique({
            where: { id: input.tenantId },
            select: { id: true },
          }),
          tx.plan.findUnique({
            where: { id: input.planId },
            select: { id: true, isArchived: true },
          }),
        ]);
        if (!tenant) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found.' });
        }
        if (!plan) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
        }
        if (plan.isArchived) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Archived plans cannot be assigned.',
          });
        }
        const before = await tx.subscription.findUnique({
          where: { tenantId: input.tenantId },
        });
        const data = {
          planId: input.planId,
          status: input.status,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          assignedByStaffUserId: ctx.staff.staffUserId,
          assignedAt: new Date(),
          // Clearing cancelAt on re-assignment — staff is explicitly
          // reactivating; the cancel grace window no longer applies.
          cancelAt: null,
        };
        const updated = before
          ? await tx.subscription.update({
              where: { tenantId: input.tenantId },
              data,
            })
          : await tx.subscription.create({
              data: { tenantId: input.tenantId, ...data },
            });
        return {
          result: updated,
          audit: {
            action: before
              ? 'admin.tenant.subscription_updated'
              : 'admin.tenant.subscription_assigned',
            targetTenantId: input.tenantId,
            targetEntityId: updated.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
            reason: input.reason,
          },
        };
      });
    }),

  /**
   * Cancel a tenant's subscription. Sets status=CANCELED + cancelAt=now.
   * Doesn't delete the row — keeping it preserves the planId for
   * historical reporting and lets a follow-up setSubscription reuse it.
   */
  cancelSubscription: supportAdminProcedure
    .input(reasonSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const sub = await tx.subscription.findUnique({
          where: { tenantId: input.id },
        });
        if (!sub) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Tenant has no subscription to cancel.',
          });
        }
        const before = { status: sub.status, cancelAt: sub.cancelAt };
        const updated = await tx.subscription.update({
          where: { tenantId: input.id },
          data: {
            status: SubscriptionStatus.CANCELED,
            cancelAt: new Date(),
          },
          select: { status: true, cancelAt: true },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.tenant.subscription_canceled',
            targetTenantId: input.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
            reason: input.reason,
          },
        };
      });
    }),

  /**
   * Add a per-tenant limit override. Stacks on top of plan features —
   * the resolver picks the override over the plan default for the
   * given metric. Optional `expiresAt` lets ops grant a temporary
   * bump (e.g., during a launch). Multiple overrides on the same
   * metric are allowed; the resolver picks the most recent non-expired.
   */
  addLimitOverride: supportAdminProcedure
    .input(
      z.object({
        tenantId: z.string().min(1).max(64),
        metric: z.nativeEnum(PlanMetric),
        included: z.number().int().min(-1).max(1_000_000_000),
        reason: z.string().trim().min(3).max(500),
        expiresAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: input.tenantId },
          select: { id: true },
        });
        if (!tenant) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found.' });
        }
        const created = await tx.tenantLimitOverride.create({
          data: {
            tenantId: input.tenantId,
            metric: input.metric,
            included: input.included,
            reason: input.reason,
            expiresAt: input.expiresAt ?? null,
            createdByStaffUserId: ctx.staff.staffUserId,
          },
        });
        return {
          result: created,
          audit: {
            action: 'admin.tenant.limit_override_added',
            targetTenantId: input.tenantId,
            targetEntityId: created.id,
            afterSnapshot: created,
            reason: input.reason,
          },
        };
      });
    }),

  /**
   * Remove an override row by id (hard delete — there's no history
   * to preserve beyond the audit row).
   */
  removeLimitOverride: supportAdminProcedure
    .input(
      z.object({
        tenantId: z.string().min(1).max(64),
        overrideId: z.string().min(1).max(64),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const row = await tx.tenantLimitOverride.findUnique({
          where: { id: input.overrideId },
        });
        if (!row || row.tenantId !== input.tenantId) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Override not found on this tenant.',
          });
        }
        await tx.tenantLimitOverride.delete({ where: { id: row.id } });
        return {
          result: { ok: true as const },
          audit: {
            action: 'admin.tenant.limit_override_removed',
            targetTenantId: input.tenantId,
            targetEntityId: row.id,
            beforeSnapshot: row,
            reason: input.reason,
          },
        };
      });
    }),
});

