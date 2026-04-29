/**
 * Per-WABA phone refresh routine (Phase 4 M4).
 *
 * Pulls every registered phone number from Meta plus the latest
 * business-profile blob, and upserts the local WhatsAppPhoneNumber
 * rows. Used by:
 *   - tRPC `whatsAppPhoneNumber.refresh` (manual button per number)
 *   - tRPC `whatsAppAccount.refreshPhoneNumbers` (the WABA-wide
 *     "Pull from Meta" button — already shipped in M3)
 *   - The wa-phone-refresh BullMQ cron (every 6h per connected WABA)
 *
 * Error policy: per-phone Meta failures are caught + logged + skipped
 * so a single bad number doesn't fail the whole refresh. Whole-call
 * failures (token revoked, WABA suspended) DO bubble up so callers
 * can surface them — but the cron in apps/worker swallows + Sentry's
 * them so a bad token doesn't churn the queue.
 */
import { decrypt, type EncryptedField } from '@getyn/crypto';
import {
  WAQualityRating,
  WAMessagingTier,
  WADisplayPhoneStatus,
  WAStatus,
  type Prisma,
} from '@getyn/db';

import {
  getPhoneNumber,
  getPhoneNumberBusinessProfile,
  listWabaPhoneNumbers,
  type MetaPhoneNumber,
  type MetaPhoneNumberDetail,
} from './meta-client';

export interface PhoneRefreshSummary {
  upserted: number;
  metaProfileFetches: { ok: number; failed: number };
  errors: Array<{ phoneNumberId: string; message: string }>;
}

interface AccountForRefresh {
  id: string;
  tenantId: string;
  wabaId: string;
  status: WAStatus;
  accessTokenEncrypted: unknown;
}

/** Map Meta tier strings, accepting numeric and string variants. */
export function mapTier(raw: string | undefined): WAMessagingTier {
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

export function mapQuality(raw: string | undefined): WAQualityRating {
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

export function mapPhoneStatus(raw: string | undefined): WADisplayPhoneStatus {
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
 * Refresh every phone for a WABA. Caller must have already verified
 * the account exists + is CONNECTED. `tx` is a Prisma transaction
 * (`PrismaClient` works too) so the same routine runs both inside
 * `withTenant` (web app) and against the global client (worker —
 * which sets `app.current_tenant_id` separately).
 */
export async function refreshPhoneNumbersForWaba(
  account: AccountForRefresh,
  tx: Prisma.TransactionClient,
): Promise<PhoneRefreshSummary> {
  const summary: PhoneRefreshSummary = {
    upserted: 0,
    metaProfileFetches: { ok: 0, failed: 0 },
    errors: [],
  };

  if (account.status !== WAStatus.CONNECTED) {
    return summary;
  }

  const accessToken = decrypt(
    account.accessTokenEncrypted as unknown as EncryptedField,
    account.tenantId,
  );

  // Whole-call failure (token revoked, WABA suspended) bubbles. Cron
  // catches + Sentry'es; the tRPC mutation surfaces to the user.
  const metaPhones: MetaPhoneNumber[] = await listWabaPhoneNumbers(
    account.wabaId,
    accessToken,
  );

  for (const p of metaPhones) {
    try {
      // Pull per-number detail to capture latest tier window. We could
      // skip this on 6h cron and rely on the listing alone, but the
      // listing's tier-window fields are inconsistent across Graph
      // versions — the per-number endpoint is the documented source
      // of truth. Cost: one extra HTTP per phone, every 6h. Worth it.
      // Widen to MetaPhoneNumberDetail (the listing-shape fallback `p`
      // is structurally compatible — extended fields just stay
      // undefined). Without this, the union loses the optional tier-
      // window fields and TS rejects the access below.
      const detail: MetaPhoneNumberDetail = await getPhoneNumber(
        p.id,
        accessToken,
      ).catch(() => p);

      // Best-effort business profile fetch. Rare for tenants to set
      // every field; missing profile is fine — we just store {} in
      // metadata. The listing endpoint doesn't return profile fields,
      // so this is the only way to get them.
      let profile = null as Awaited<
        ReturnType<typeof getPhoneNumberBusinessProfile>
      >;
      try {
        profile = await getPhoneNumberBusinessProfile(p.id, accessToken);
        summary.metaProfileFetches.ok += 1;
      } catch (profileErr) {
        summary.metaProfileFetches.failed += 1;
        // Non-fatal; the cron logs the count.
        void profileErr;
      }

      // Per-number tier-window fields. Meta's response shape varies
      // between Graph versions; we read defensively.
      const usage = detail.current_24h_usage ?? null;
      const reset = detail.next_24h_window_starts_at
        ? new Date(detail.next_24h_window_starts_at * 1000)
        : null;

      await tx.whatsAppPhoneNumber.upsert({
        where: {
          tenantId_phoneNumberId: {
            tenantId: account.tenantId,
            phoneNumberId: p.id,
          },
        },
        create: {
          tenantId: account.tenantId,
          whatsAppAccountId: account.id,
          phoneNumberId: p.id,
          phoneNumber: detail.display_phone_number ?? p.display_phone_number,
          verifiedName: detail.verified_name ?? p.verified_name,
          qualityRating: mapQuality(detail.quality_rating ?? p.quality_rating),
          messagingTier: mapTier(detail.messaging_limit ?? p.messaging_limit),
          displayPhoneNumberStatus: mapPhoneStatus(detail.status ?? p.status),
          pinSetAt: (detail.pin ?? p.pin) ? new Date() : null,
          currentTier24hUsage: usage ?? 0,
          tier24hWindowResetAt: reset,
          metadata: (profile ?? {}) as Prisma.JsonObject,
        },
        update: {
          phoneNumber: detail.display_phone_number ?? p.display_phone_number,
          verifiedName: detail.verified_name ?? p.verified_name,
          qualityRating: mapQuality(detail.quality_rating ?? p.quality_rating),
          messagingTier: mapTier(detail.messaging_limit ?? p.messaging_limit),
          displayPhoneNumberStatus: mapPhoneStatus(detail.status ?? p.status),
          // Only overwrite tier-window when Meta actually returned it —
          // some Graph versions omit it for newly-promoted numbers.
          ...(usage !== null ? { currentTier24hUsage: usage } : {}),
          ...(reset !== null ? { tier24hWindowResetAt: reset } : {}),
          ...(profile !== null
            ? { metadata: profile as unknown as Prisma.JsonObject }
            : {}),
        },
      });
      summary.upserted += 1;
    } catch (err) {
      summary.errors.push({
        phoneNumberId: p.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
