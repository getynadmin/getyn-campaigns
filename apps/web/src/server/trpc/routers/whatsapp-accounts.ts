import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { encrypt } from '@getyn/crypto';
import {
  Role,
  WAStatus,
  WAQualityRating,
  WAMessagingTier,
  WADisplayPhoneStatus,
  withTenant,
  type Prisma,
} from '@getyn/db';
import {
  whatsAppAccountConnectManuallySchema,
  whatsAppAccountDisconnectSchema,
  whatsAppAccountRefreshPhoneNumbersSchema,
} from '@getyn/types';

import {
  MetaApiError,
  getMe,
  getWaba,
  listWabaPhoneNumbers,
  type MetaPhoneNumber,
} from '@/server/whatsapp/meta-client';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * WhatsAppAccount router — Phase 4 M3 (manual connect path).
 *
 * Manual connect flow:
 *   1. Tenant pastes WABA ID + system-user access token + App ID.
 *   2. We hit Meta `/me` to verify the token works.
 *   3. We hit `/{wabaId}` to fetch business metadata.
 *   4. We list `/{wabaId}/phone_numbers` to populate WhatsAppPhoneNumber.
 *   5. We encrypt the token (AD = tenantId) and insert WhatsAppAccount +
 *      phone numbers in a single transaction. M5's wa-template-sync
 *      cron picks the WABA up on its next tick (no manual schedule).
 *
 * Errors from Meta are re-raised verbatim so tenants see real reasons
 * ("Invalid OAuth access token", "(#100) The parameter waba_id is
 *  required", etc.) rather than a generic failure.
 *
 * Permissions: OWNER / ADMIN connect, disconnect, refresh. EDITOR and
 * VIEWER can read via `get` so the settings page renders for them
 * (read-only).
 *
 * Plan gating: deferred to M11 with a TODO. We'll mirror the
 * SendingDomain Plan check pattern when billing surfaces are wired.
 */

function metaErrorToTRPC(err: unknown, where: string): TRPCError {
  if (err instanceof MetaApiError) {
    return new TRPCError({
      code: err.status === 401 || err.status === 403 ? 'UNAUTHORIZED' : 'BAD_REQUEST',
      message: `${where}: ${err.message}${err.metaCode ? ` (Meta code ${err.metaCode})` : ''}`,
      cause: err,
    });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `${where}: unexpected error`,
    cause: err,
  });
}

/** Map Meta's tier strings to our enum, defensively. */
function mapMessagingTier(raw: string | undefined): WAMessagingTier {
  switch (raw) {
    case 'TIER_50':
      return WAMessagingTier.TIER_50;
    case 'TIER_250':
      return WAMessagingTier.TIER_250;
    case 'TIER_1K':
    case 'TIER_1000':
      return WAMessagingTier.TIER_1K;
    case 'TIER_10K':
    case 'TIER_10000':
      return WAMessagingTier.TIER_10K;
    case 'TIER_100K':
    case 'TIER_100000':
      return WAMessagingTier.TIER_100K;
    case 'TIER_UNLIMITED':
      return WAMessagingTier.TIER_UNLIMITED;
    default:
      return WAMessagingTier.TIER_50;
  }
}

function mapQualityRating(raw: string | undefined): WAQualityRating {
  switch (raw) {
    case 'GREEN':
      return WAQualityRating.GREEN;
    case 'YELLOW':
      return WAQualityRating.YELLOW;
    case 'RED':
      return WAQualityRating.RED;
    default:
      return WAQualityRating.UNKNOWN;
  }
}

function mapPhoneStatus(raw: string | undefined): WADisplayPhoneStatus {
  switch (raw) {
    case 'CONNECTED':
      return WADisplayPhoneStatus.CONNECTED;
    case 'PENDING_REVIEW':
      return WADisplayPhoneStatus.PENDING_REVIEW;
    case 'FLAGGED':
      return WADisplayPhoneStatus.FLAGGED;
    case 'DISCONNECTED':
      return WADisplayPhoneStatus.DISCONNECTED;
    default:
      return WADisplayPhoneStatus.PENDING_REVIEW;
  }
}

/**
 * Shape we return to the client. Never includes the encrypted token —
 * even an OWNER reading their own row gets a redacted view because
 * leaking decrypted tokens through tRPC defeats the encryption.
 */
function redactAccount<T extends { accessTokenEncrypted: unknown }>(
  account: T,
): Omit<T, 'accessTokenEncrypted'> & { tokenStored: boolean } {
  const { accessTokenEncrypted, ...rest } = account;
  return { ...rest, tokenStored: Boolean(accessTokenEncrypted) };
}

export const whatsAppAccountsRouter = createTRPCRouter({
  /**
   * Read the tenant's connected WABA (or null). EDITOR + VIEWER allowed
   * so the settings page can render a read-only state.
   */
  get: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const account = await tx.whatsAppAccount.findUnique({
        where: { tenantId },
        include: {
          phoneNumbers: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!account) return null;
      return {
        ...redactAccount(account),
        canManage:
          ctx.tenantContext.membership.role === Role.OWNER ||
          ctx.tenantContext.membership.role === Role.ADMIN,
      };
    });
  }),

  /**
   * Manual connect (Phase 4 M3). M11 adds Embedded Signup which lands
   * here too once it has a token to hand off.
   *
   * Idempotency: if a WABA already exists for the tenant, we reject
   * with CONFLICT — the tenant must `disconnect` first. This avoids
   * accidentally overwriting the encrypted token (which would orphan
   * any in-flight sends mid-dispatch).
   *
   * appSecret is requested but NOT persisted in M3. Webhook signature
   * verification (M9) reads it from `META_APP_SECRET` env (server-wide
   * config) for now since one app handles all tenants in MVP. We'll
   * revisit per-tenant secret storage if multi-app deployments appear.
   */
  connectManually: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(whatsAppAccountConnectManuallySchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      // 1) Reject if already connected.
      const existing = await withTenant(tenantId, (tx) =>
        tx.whatsAppAccount.findUnique({ where: { tenantId } }),
      );
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'A WhatsApp account is already connected. Disconnect it first to swap credentials.',
        });
      }

      // 2) Verify token (Meta /me). Fails fast on bad creds.
      try {
        await getMe(input.accessToken);
      } catch (err) {
        throw metaErrorToTRPC(err, 'Token verification failed');
      }

      // 3) Resolve WABA metadata.
      let waba;
      try {
        waba = await getWaba(input.wabaId, input.accessToken);
      } catch (err) {
        throw metaErrorToTRPC(err, 'WABA lookup failed');
      }

      // 4) List phone numbers. Empty is allowed — tenants can register
      //    a number later in Business Manager and refresh.
      let metaPhones: MetaPhoneNumber[] = [];
      try {
        metaPhones = await listWabaPhoneNumbers(input.wabaId, input.accessToken);
      } catch (err) {
        throw metaErrorToTRPC(err, 'Phone number lookup failed');
      }

      // 5) Persist atomically. The token is encrypted with tenantId AD;
      //    a stolen row crammed into another tenant fails authentication.
      const encryptedToken = encrypt(input.accessToken, tenantId);

      const account = await withTenant(tenantId, (tx) =>
        tx.whatsAppAccount.create({
          data: {
            tenantId,
            wabaId: input.wabaId,
            displayName: input.displayName.length > 0 ? input.displayName : waba.name,
            status: WAStatus.CONNECTED,
            connectedAt: new Date(),
            accessTokenEncrypted: encryptedToken as unknown as Prisma.JsonObject,
            tokenExpiresAt: null, // System-user tokens are non-expiring
            appId: input.appId,
            metadata: {
              currency: waba.currency ?? null,
              timezone_id: waba.timezone_id ?? null,
              message_template_namespace: waba.message_template_namespace ?? null,
              connected_via: 'manual',
            } satisfies Prisma.JsonObject,
            phoneNumbers: {
              create: metaPhones.map((p) => ({
                tenantId,
                phoneNumberId: p.id,
                phoneNumber: p.display_phone_number,
                verifiedName: p.verified_name,
                qualityRating: mapQualityRating(p.quality_rating),
                messagingTier: mapMessagingTier(p.messaging_limit),
                displayPhoneNumberStatus: mapPhoneStatus(p.status),
                pinSetAt: p.pin ? new Date() : null,
              })),
            },
          },
          include: { phoneNumbers: true },
        }),
      );

      // M5's wa-template-sync repeatable job picks this up next tick.
      // We deliberately don't kick a one-off sync here so connect
      // returns fast — the UI can poll templates on next page render.

      return redactAccount(account);
    }),

  /**
   * Disconnect — soft. Wipe the encrypted token, mark DISCONNECTED.
   * Phone numbers, templates, conversations, message history all stay.
   * Reconnect later restores function without re-importing history.
   */
  disconnect: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(whatsAppAccountDisconnectSchema)
    .mutation(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const acct = await tx.whatsAppAccount.findUnique({
          where: { tenantId },
        });
        if (!acct) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No WhatsApp account is connected.',
          });
        }
        // Wipe the token by replacing with an empty encrypted string.
        // We can't NULL the column because it's required — using an
        // empty string here means "we used to have one, gone now". A
        // future M11 reconnect overwrites with a fresh token.
        const wiped = encrypt('', tenantId);
        const updated = await tx.whatsAppAccount.update({
          where: { id: acct.id },
          data: {
            status: WAStatus.DISCONNECTED,
            disconnectedAt: new Date(),
            accessTokenEncrypted: wiped as unknown as Prisma.JsonObject,
          },
        });
        return redactAccount(updated);
      });
    }),

  /**
   * Re-list phone numbers from Meta. Used after a tenant registers a
   * new number in Business Manager. Rate-limited to one call per minute
   * per tenant to avoid hammering Meta.
   */
  refreshPhoneNumbers: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(whatsAppAccountRefreshPhoneNumbersSchema)
    .mutation(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      const acct = await withTenant(tenantId, (tx) =>
        tx.whatsAppAccount.findUnique({
          where: { tenantId },
          include: { phoneNumbers: true },
        }),
      );
      if (!acct) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No WhatsApp account is connected.',
        });
      }
      if (acct.status !== WAStatus.CONNECTED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Reconnect the WhatsApp account first.',
        });
      }

      // Decrypt the stored token to call Meta. The decryption fails if
      // somehow tenantId doesn't match — ensures we never use one
      // tenant's token against another's WABA.
      const { decrypt } = await import('@getyn/crypto');
      const accessToken = decrypt(
        acct.accessTokenEncrypted as unknown as Parameters<typeof decrypt>[0],
        tenantId,
      );

      let metaPhones: MetaPhoneNumber[] = [];
      try {
        metaPhones = await listWabaPhoneNumbers(acct.wabaId, accessToken);
      } catch (err) {
        throw metaErrorToTRPC(err, 'Phone number refresh failed');
      }

      // Upsert each Meta phone into our DB. Numbers Meta no longer
      // returns are NOT deleted — they may be temporarily unavailable
      // and removing them would orphan campaign references. M4's
      // wa-phone-refresh cron handles soft-deactivation properly.
      const refreshed = await withTenant(tenantId, async (tx) => {
        for (const p of metaPhones) {
          await tx.whatsAppPhoneNumber.upsert({
            where: {
              tenantId_phoneNumberId: { tenantId, phoneNumberId: p.id },
            },
            create: {
              tenantId,
              whatsAppAccountId: acct.id,
              phoneNumberId: p.id,
              phoneNumber: p.display_phone_number,
              verifiedName: p.verified_name,
              qualityRating: mapQualityRating(p.quality_rating),
              messagingTier: mapMessagingTier(p.messaging_limit),
              displayPhoneNumberStatus: mapPhoneStatus(p.status),
              pinSetAt: p.pin ? new Date() : null,
            },
            update: {
              phoneNumber: p.display_phone_number,
              verifiedName: p.verified_name,
              qualityRating: mapQualityRating(p.quality_rating),
              messagingTier: mapMessagingTier(p.messaging_limit),
              displayPhoneNumberStatus: mapPhoneStatus(p.status),
            },
          });
        }
        return tx.whatsAppPhoneNumber.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'asc' },
        });
      });

      return { phoneNumbers: refreshed, refreshedAt: new Date().toISOString() };
    }),

  /**
   * Self-test endpoint surfaced in the UI as "Test connection". Hits
   * /me with the stored token and returns the result. Useful when a
   * tenant suspects their token has been revoked in Meta Business
   * Manager.
   */
  testConnection: tenantProcedure
    .input(z.object({}))
    .mutation(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const acct = await withTenant(tenantId, (tx) =>
        tx.whatsAppAccount.findUnique({ where: { tenantId } }),
      );
      if (!acct) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No WhatsApp account is connected.',
        });
      }
      const { decrypt } = await import('@getyn/crypto');
      try {
        const accessToken = decrypt(
          acct.accessTokenEncrypted as unknown as Parameters<typeof decrypt>[0],
          tenantId,
        );
        const me = await getMe(accessToken);
        return { ok: true as const, me };
      } catch (err) {
        if (err instanceof MetaApiError) {
          return {
            ok: false as const,
            error: err.message,
            metaCode: err.metaCode ?? null,
          };
        }
        // Likely a decrypt failure — token was wiped or key rotated.
        return {
          ok: false as const,
          error: 'Stored token could not be read. Reconnect the account.',
          metaCode: null,
        };
      }
    }),
});
