import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PlanMetric, prisma, type Prisma } from '@getyn/db';

import { withAdminContext } from '@/server/admin/with-admin-context';
import { dynamicPricingSchema } from '@/server/billing/dynamic-pricing';
import {
  createAdminRouter,
  staffProcedure,
  supportAdminProcedure,
} from '../admin-trpc';

/**
 * Phase 5.5 M2 — admin.plan.*
 *
 * CRUD over Plan + PlanFeature. Reads are open to all staff; mutations
 * require SUPPORT_ADMIN — plans drive paid limits across every tenant
 * so the blast radius is large.
 *
 * Plan deletion is intentionally not exposed: archive instead. A live
 * Subscription pointing at a deleted plan would orphan the tenant; the
 * `isArchived` flag hides retired plans from new-subscription pickers
 * without breaking existing rows.
 *
 * Every mutation goes through withAdminContext so a StaffAuditLog row
 * lands atomically — plans-team changes are high-stakes.
 */

const metricEnum = z.nativeEnum(PlanMetric);

const featureInputSchema = z.object({
  metric: metricEnum,
  // -1 means unlimited; 0 means feature disabled; >0 is the cap.
  included: z.number().int().min(-1).max(1_000_000_000),
  overageCentsPer1k: z.number().int().min(0).max(1_000_000).nullable(),
});

const planUpsertSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and dashes only'),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2_000).nullable(),
  priceMonthlyCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  priceYearlyCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  currency: z.string().trim().length(3).default('USD'),
  features: z.array(featureInputSchema).max(20),
  /**
   * Phase 9 — dynamic pricing config. When present, the /pricing page
   * renders a slider driven by this config and priceMonthly/Yearly on
   * the plan row are ignored. When null, the plan is a legacy fixed
   * tier and the row prices apply.
   */
  pricing: dynamicPricingSchema.nullable().default(null),
});

const idSchema = z.object({ id: z.string().min(1).max(64) });

export const adminPlansRouter = createAdminRouter({
  /**
   * Full list incl. features. Plans table is small (<20 rows even at
   * scale) so we skip pagination.
   */
  list: staffProcedure.query(async () => {
    const rows = await prisma.plan.findMany({
      include: {
        features: { orderBy: { metric: 'asc' } },
        _count: { select: { subscriptions: true } },
      },
      orderBy: [{ isArchived: 'asc' }, { priceMonthlyCents: 'asc' }, { name: 'asc' }],
    });
    return rows;
  }),

  get: staffProcedure.input(idSchema).query(async ({ input }) => {
    const plan = await prisma.plan.findUnique({
      where: { id: input.id },
      include: { features: { orderBy: { metric: 'asc' } } },
    });
    if (!plan) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
    }
    return plan;
  }),

  /**
   * Create a plan + its features in one transaction. Slug collision
   * surfaces as CONFLICT; field-level errors bubble as BAD_REQUEST.
   */
  create: supportAdminProcedure
    .input(planUpsertSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const existing = await tx.plan.findUnique({
          where: { slug: input.slug },
          select: { id: true },
        });
        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A plan with that slug already exists.',
          });
        }
        const created = await tx.plan.create({
          data: {
            slug: input.slug,
            name: input.name,
            description: input.description,
            priceMonthlyCents: input.priceMonthlyCents,
            priceYearlyCents: input.priceYearlyCents,
            currency: input.currency,
            metadata: input.pricing
              ? ({ pricing: input.pricing } as Prisma.InputJsonValue)
              : ({} as Prisma.InputJsonValue),
            createdByStaffUserId: ctx.staff.staffUserId,
            features: {
              create: input.features.map((f) => ({
                metric: f.metric,
                included: f.included,
                overageCentsPer1k: f.overageCentsPer1k,
              })),
            },
          },
          include: { features: true },
        });
        return {
          result: created,
          audit: {
            action: 'admin.plan.created',
            targetEntityId: created.id,
            afterSnapshot: created,
          },
        };
      });
    }),

  /**
   * Replace a plan's mutable fields + features in one transaction.
   * Slug is mutable (rare but supported); the unique check guards
   * against collision with another plan.
   *
   * Features are diffed rather than nuked-and-replaced so the audit
   * row reflects only what actually changed.
   */
  update: supportAdminProcedure
    .input(idSchema.merge(planUpsertSchema))
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const before = await tx.plan.findUnique({
          where: { id: input.id },
          include: { features: true },
        });
        if (!before) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
        }
        if (before.slug !== input.slug) {
          const slugTaken = await tx.plan.findFirst({
            where: { slug: input.slug, NOT: { id: input.id } },
            select: { id: true },
          });
          if (slugTaken) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Another plan already uses that slug.',
            });
          }
        }

        // Diff features by (metric).
        const beforeByMetric = new Map(
          before.features.map((f) => [f.metric, f] as const),
        );
        const inputMetrics = new Set(input.features.map((f) => f.metric));

        const toDelete = before.features
          .filter((f) => !inputMetrics.has(f.metric))
          .map((f) => f.id);
        const toUpsert: Prisma.PlanFeatureUpsertWithWhereUniqueWithoutPlanInput[] =
          input.features.map((f) => ({
            where: { planId_metric: { planId: input.id, metric: f.metric } },
            update: {
              included: f.included,
              overageCentsPer1k: f.overageCentsPer1k,
            },
            create: {
              metric: f.metric,
              included: f.included,
              overageCentsPer1k: f.overageCentsPer1k,
            },
          }));

        if (toDelete.length) {
          await tx.planFeature.deleteMany({ where: { id: { in: toDelete } } });
        }
        const updated = await tx.plan.update({
          where: { id: input.id },
          data: {
            slug: input.slug,
            name: input.name,
            description: input.description,
            priceMonthlyCents: input.priceMonthlyCents,
            priceYearlyCents: input.priceYearlyCents,
            currency: input.currency,
            metadata: input.pricing
              ? ({ pricing: input.pricing } as Prisma.InputJsonValue)
              : ({} as Prisma.InputJsonValue),
            features: { upsert: toUpsert },
          },
          include: { features: true },
        });
        void beforeByMetric; // kept above for symmetric reading; diff already computed
        return {
          result: updated,
          audit: {
            action: 'admin.plan.updated',
            targetEntityId: updated.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
          },
        };
      });
    }),

  /**
   * Soft-delete via the isArchived flag. Existing subscriptions on
   * archived plans keep working; new subscriptions can no longer
   * select them.
   */
  setArchived: supportAdminProcedure
    .input(idSchema.extend({ isArchived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const before = await tx.plan.findUnique({
          where: { id: input.id },
          select: { id: true, isArchived: true, isDefault: true },
        });
        if (!before) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
        }
        if (input.isArchived && before.isDefault) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Cannot archive the default plan. Set another plan as default first.',
          });
        }
        const updated = await tx.plan.update({
          where: { id: input.id },
          data: { isArchived: input.isArchived },
          select: { id: true, isArchived: true },
        });
        return {
          result: updated,
          audit: {
            action: input.isArchived
              ? 'admin.plan.archived'
              : 'admin.plan.unarchived',
            targetEntityId: input.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
          },
        };
      });
    }),

  /**
   * Toggle a plan as the default. Only one plan may be the default
   * at a time — the schema enforces this with a partial unique index
   * on `isDefault=true`. We clear all other defaults in the same
   * transaction to avoid tripping it.
   *
   * Setting the default plan does NOT auto-assign it to new tenants
   * — that's a separate AppSettings.defaultPlanAutoAssign flag.
   */
  setDefault: supportAdminProcedure
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const target = await tx.plan.findUnique({
          where: { id: input.id },
          select: { id: true, isArchived: true, isDefault: true },
        });
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
        }
        if (target.isArchived) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Archived plans cannot be set as default.',
          });
        }
        if (target.isDefault) {
          return {
            result: { id: target.id, isDefault: true as const },
            audit: {
              action: 'admin.plan.set_default_noop',
              targetEntityId: target.id,
            },
          };
        }
        // Clear other defaults first so the partial unique index is
        // never violated mid-transaction.
        await tx.plan.updateMany({
          where: { isDefault: true, NOT: { id: input.id } },
          data: { isDefault: false },
        });
        const updated = await tx.plan.update({
          where: { id: input.id },
          data: { isDefault: true },
          select: { id: true, isDefault: true },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.plan.set_default',
            targetEntityId: input.id,
            afterSnapshot: updated,
          },
        };
      });
    }),
});
