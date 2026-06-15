import { TRPCError } from '@trpc/server';

import { Role, withTenant } from '@getyn/db';
import {
  brandProfileUpsertSchema,
  isBrandProfileComplete,
} from '@getyn/types';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Phase 7 — TenantBrandProfile router.
 *
 * `get` returns the singleton profile for the current tenant (or null
 * if it hasn't been started yet). `upsert` creates or updates without
 * touching `completedAt` — that's reserved for `.complete` which also
 * validates the required fields.
 *
 * All tenants in a workspace can read the profile (the dashboard
 * widget shows it), but only OWNER/ADMIN/EDITOR can edit. VIEWER is
 * locked out of writes.
 */
export const tenantBrandRouter = createTRPCRouter({
  get: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, (tx) =>
      tx.tenantBrandProfile.findUnique({ where: { tenantId } }),
    );
  }),

  upsert: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(brandProfileUpsertSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;
      return withTenant(tenantId, (tx) =>
        tx.tenantBrandProfile.upsert({
          where: { tenantId },
          create: {
            tenantId,
            brandName: input.brandName,
            brandTagline: input.brandTagline ?? null,
            brandDescription: input.brandDescription,
            primaryColor: input.primaryColor,
            secondaryColor: input.secondaryColor ?? null,
            accentColor: input.accentColor ?? null,
            logoAssetId: input.logoAssetId ?? null,
            logoUrl: input.logoUrl ?? null,
            voiceTone: input.voiceTone,
            writingStyle: input.writingStyle ?? null,
            industry: input.industry ?? null,
            targetAudience: input.targetAudience ?? null,
            dosAndDonts: input.dosAndDonts ?? null,
            signatureBlock: input.signatureBlock ?? null,
            socialLinks: input.socialLinks,
            unsubscribeFooterCustom: input.unsubscribeFooterCustom ?? null,
            updatedByUserId: userId,
          },
          update: {
            brandName: input.brandName,
            brandTagline: input.brandTagline ?? null,
            brandDescription: input.brandDescription,
            primaryColor: input.primaryColor,
            secondaryColor: input.secondaryColor ?? null,
            accentColor: input.accentColor ?? null,
            logoAssetId: input.logoAssetId ?? null,
            logoUrl: input.logoUrl ?? null,
            voiceTone: input.voiceTone,
            writingStyle: input.writingStyle ?? null,
            industry: input.industry ?? null,
            targetAudience: input.targetAudience ?? null,
            dosAndDonts: input.dosAndDonts ?? null,
            signatureBlock: input.signatureBlock ?? null,
            socialLinks: input.socialLinks,
            unsubscribeFooterCustom: input.unsubscribeFooterCustom ?? null,
            updatedByUserId: userId,
          },
        }),
      );
    }),

  /**
   * Stamps `completedAt`. Validates that the minimum required fields
   * are set so the agent has enough context to generate anything
   * coherent — brand name, description, primary color.
   */
  complete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .mutation(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.tenantBrandProfile.findUnique({
          where: { tenantId },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Save your brand details first, then mark the profile complete.',
          });
        }
        if (
          !isBrandProfileComplete({
            brandName: existing.brandName,
            brandDescription: existing.brandDescription,
            primaryColor: existing.primaryColor,
          })
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Brand name, description, and primary color are required before the agent can use this profile.',
          });
        }
        return tx.tenantBrandProfile.update({
          where: { tenantId },
          data: { completedAt: new Date() },
        });
      });
    }),
});
