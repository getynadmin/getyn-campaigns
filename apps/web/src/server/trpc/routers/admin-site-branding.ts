import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@getyn/db';

import { withAdminContext } from '@/server/admin/with-admin-context';
import { getSupabaseAdmin } from '@/server/auth/supabase-admin';
import {
  createAdminRouter,
  staffProcedure,
  supportAdminProcedure,
} from '../admin-trpc';

/**
 * Phase 5.6 M5 — admin.siteBranding.*
 *
 * Singleton CRUD + signed-upload URL minter for the brand-assets
 * Storage bucket. Asset URLs are persisted as the bucket's public
 * URL (the bucket is public-read) so the page can serve them
 * directly without going through a signed-URL refresh loop.
 */

const BUCKET = 'brand-assets';

// Tightly-typed field set so resetField can't be passed an
// invalid column name.
const ASSET_FIELDS = [
  'defaultSidebarLogoLightUrl',
  'defaultSidebarLogoDarkUrl',
  'loginPageLogoUrl',
  'faviconUrl',
] as const;
type AssetField = (typeof ASSET_FIELDS)[number];

const updateSchema = z.object({
  appName: z.string().trim().min(1).max(120),
  defaultSidebarLogoLightUrl: z.string().trim().url().or(z.literal('')).nullable(),
  defaultSidebarLogoDarkUrl: z.string().trim().url().or(z.literal('')).nullable(),
  loginPageLogoUrl: z.string().trim().url().or(z.literal('')).nullable(),
  faviconUrl: z.string().trim().url().or(z.literal('')).nullable(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB')
    .or(z.literal(''))
    .nullable(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB')
    .or(z.literal(''))
    .nullable(),
  loginPageTagline: z.string().trim().max(255).or(z.literal('')).nullable(),
  footerText: z.string().trim().max(500).or(z.literal('')).nullable(),
  customCss: z.string().max(100_000).or(z.literal('')).nullable(),
});

const uploadSchema = z.object({
  field: z.enum(ASSET_FIELDS),
  ext: z.enum(['png', 'jpg', 'jpeg', 'svg', 'ico', 'webp']),
});

export const adminSiteBrandingRouter = createAdminRouter({
  get: staffProcedure.query(async () => {
    const row = await prisma.siteBrandingSettings.findUnique({
      where: { id: 'singleton' },
    });
    if (!row) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'SiteBrandingSettings singleton missing — run migrations.',
      });
    }
    return row;
  }),

  update: supportAdminProcedure
    .input(updateSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const before = await tx.siteBrandingSettings.findUnique({
          where: { id: 'singleton' },
        });
        if (!before) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'SiteBrandingSettings singleton missing.',
          });
        }
        // Normalize empty strings to null so the DB column is null,
        // not an empty string.
        const data = {
          appName: input.appName,
          defaultSidebarLogoLightUrl:
            input.defaultSidebarLogoLightUrl?.trim() || null,
          defaultSidebarLogoDarkUrl:
            input.defaultSidebarLogoDarkUrl?.trim() || null,
          loginPageLogoUrl: input.loginPageLogoUrl?.trim() || null,
          faviconUrl: input.faviconUrl?.trim() || null,
          primaryColor: input.primaryColor?.trim() || null,
          accentColor: input.accentColor?.trim() || null,
          loginPageTagline: input.loginPageTagline?.trim() || null,
          footerText: input.footerText?.trim() || null,
          customCss: input.customCss?.trim() || null,
          updatedByStaffUserId: ctx.staff.staffUserId,
        };
        const updated = await tx.siteBrandingSettings.update({
          where: { id: 'singleton' },
          data,
        });
        return {
          result: updated,
          audit: {
            action: 'admin.site_branding.updated',
            beforeSnapshot: before,
            afterSnapshot: updated,
          },
        };
      });
    }),

  /**
   * Mint a signed upload URL for the brand-assets bucket. The web
   * client PUTs the file directly; the resulting public URL is sent
   * back so the client can immediately update the matching field via
   * `.update`.
   */
  requestUpload: supportAdminProcedure
    .input(uploadSchema)
    .mutation(async ({ input }) => {
      const path = `branding/${input.field}-${randomUUID()}.${input.ext}`;
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (error || !data) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Could not create upload URL: ${error?.message ?? 'unknown'}`,
        });
      }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      return {
        bucket: BUCKET,
        path,
        uploadUrl: data.signedUrl,
        token: data.token,
        publicUrl: pub.publicUrl,
      };
    }),

  /**
   * Clear a single asset field (logo / favicon). Convenience over
   * sending a full update payload from the client just to null one
   * column.
   */
  resetField: supportAdminProcedure
    .input(z.object({ field: z.enum(ASSET_FIELDS) }))
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const before = await tx.siteBrandingSettings.findUnique({
          where: { id: 'singleton' },
        });
        const updated = await tx.siteBrandingSettings.update({
          where: { id: 'singleton' },
          data: {
            [input.field as AssetField]: null,
            updatedByStaffUserId: ctx.staff.staffUserId,
          },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.site_branding.field_reset',
            beforeSnapshot: before,
            afterSnapshot: updated,
            reason: `cleared ${input.field}`,
          },
        };
      });
    }),
});
