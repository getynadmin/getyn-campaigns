import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { decrypt, type EncryptedField } from '@getyn/crypto';
import { Role, WAStatus, withTenant, type Prisma } from '@getyn/db';
import {
  MetaApiError,
  getPhoneNumber,
  getPhoneNumberBusinessProfile,
  mapPhoneStatus,
  mapQuality,
  mapTier,
} from '@getyn/whatsapp';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * WhatsAppPhoneNumber router — Phase 4 M4.
 *
 * Per-number reads + targeted refresh. The whole-WABA refresh is on
 * `whatsAppAccount.refreshPhoneNumbers` (and the wa-phone-refresh
 * cron). This router is for the detail panel: pick one number, see
 * its business profile, refresh just that one.
 *
 * Rate limit (per kickoff M4 spec): one refresh per minute per phone.
 * Enforced via lastCheckedAt-style throttle column — but we don't have
 * one yet. M4 uses the in-memory `lastSyncedAt` column on the row
 * (which gets bumped to now() on every refresh). Sub-minute calls
 * fail with TOO_MANY_REQUESTS rather than letting tenants spam Meta.
 *
 * Read access (list/get) is open to every member. Refresh is OWNER /
 * ADMIN only.
 */

const phoneNumberIdSchema = z.object({ id: z.string().min(1).max(64) });

const RATE_LIMIT_SECONDS = 60;

export const whatsAppPhoneNumbersRouter = createTRPCRouter({
  /**
   * List the tenant's phone numbers. Mirrors `whatsAppAccount.get`'s
   * `phoneNumbers` field — exposed separately so the phone-detail
   * page can refetch without re-fetching the whole account.
   */
  list: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, (tx) =>
      tx.whatsAppPhoneNumber.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }),

  /**
   * Read one number with its (cached) business profile metadata.
   * The metadata column is a Json blob populated by the cron / refresh.
   */
  get: tenantProcedure.input(phoneNumberIdSchema).query(async ({ ctx, input }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const row = await withTenant(tenantId, (tx) =>
      tx.whatsAppPhoneNumber.findFirst({
        where: { id: input.id, tenantId },
      }),
    );
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Phone number not found.' });
    }
    return row;
  }),

  /**
   * Refresh this single number from Meta. Updates tier / quality /
   * status / business-profile fields. Rate-limited per spec.
   */
  refresh: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(phoneNumberIdSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      const row = await withTenant(tenantId, (tx) =>
        tx.whatsAppPhoneNumber.findFirst({
          where: { id: input.id, tenantId },
          include: { whatsAppAccount: true },
        }),
      );
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Phone number not found.' });
      }
      if (row.whatsAppAccount.status !== WAStatus.CONNECTED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Reconnect the WhatsApp account first.',
        });
      }

      // Rate limit — RATE_LIMIT_SECONDS since updatedAt.
      const now = Date.now();
      const lastUpdated = row.updatedAt.getTime();
      if (now - lastUpdated < RATE_LIMIT_SECONDS * 1000) {
        const wait = Math.ceil((RATE_LIMIT_SECONDS * 1000 - (now - lastUpdated)) / 1000);
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Refreshed too recently. Try again in ${wait}s.`,
        });
      }

      const accessToken = decrypt(
        row.whatsAppAccount.accessTokenEncrypted as unknown as EncryptedField,
        tenantId,
      );

      try {
        // Per-number detail — single source of truth for tier/usage.
        const detail = await getPhoneNumber(row.phoneNumberId, accessToken);

        // Business profile (best-effort; missing profile is fine).
        let profile = null as Awaited<
          ReturnType<typeof getPhoneNumberBusinessProfile>
        >;
        try {
          profile = await getPhoneNumberBusinessProfile(
            row.phoneNumberId,
            accessToken,
          );
        } catch {
          // swallow — profile is optional
        }

        const usage = detail.current_24h_usage ?? null;
        const reset = detail.next_24h_window_starts_at
          ? new Date(detail.next_24h_window_starts_at * 1000)
          : null;

        const updated = await withTenant(tenantId, (tx) =>
          tx.whatsAppPhoneNumber.update({
            where: { id: row.id },
            data: {
              phoneNumber: detail.display_phone_number ?? row.phoneNumber,
              verifiedName: detail.verified_name ?? row.verifiedName,
              qualityRating: mapQuality(detail.quality_rating),
              messagingTier: mapTier(detail.messaging_limit),
              displayPhoneNumberStatus: mapPhoneStatus(detail.status),
              ...(usage !== null ? { currentTier24hUsage: usage } : {}),
              ...(reset !== null ? { tier24hWindowResetAt: reset } : {}),
              ...(profile !== null
                ? { metadata: profile as unknown as Prisma.JsonObject }
                : {}),
            },
          }),
        );
        return updated;
      } catch (err) {
        if (err instanceof MetaApiError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Meta API: ${err.message}${err.metaCode ? ` (code ${err.metaCode})` : ''}`,
            cause: err,
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Refresh failed.',
          cause: err,
        });
      }
    }),
});
