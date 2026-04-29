/**
 * Template sync — Phase 4 M5.
 *
 * Reconciles the WhatsAppTemplate rows for one WABA against Meta's
 * source of truth. Used by:
 *   - tRPC `whatsAppTemplate.syncNow` (manual, rate-limited)
 *   - The wa-template-sync hourly cron (per CONNECTED WABA)
 *   - `pollTemplateSubmission` after a tenant submits a draft (M6)
 *
 * # Reconciliation rules
 *
 * For each template Meta returns:
 *   - If a local row already has `metaTemplateId` matching Meta's id:
 *     update status / rejectionReason / quality / components / lastSyncedAt.
 *     `components` reflects Meta's source-of-truth — once submitted,
 *     Meta's render is authoritative even if the original draft
 *     differed.
 *   - If no `metaTemplateId` match but a local row has the same
 *     (whatsAppAccountId, name, language) AND status=DRAFT:
 *     this is the "submitted via Business Manager / outside our UI"
 *     case. Link them: set metaTemplateId, sync everything else.
 *   - Otherwise: create a new local row mirroring Meta.
 *
 * For local rows Meta DOESN'T return:
 *   - Status=DRAFT rows are left alone (never submitted, no Meta record).
 *   - Status=PENDING rows older than 7d become DISABLED — Meta dropped
 *     them. Newer PENDING rows stay (transient sync gaps).
 *   - APPROVED / REJECTED rows are left alone — Meta sometimes returns
 *     paginated subsets and dropping a row would lose history.
 *   - Soft-deleted rows (deletedAt set) are skipped entirely.
 *
 * Errors are local. Per-template parse failures are logged + skipped
 * so one bad row doesn't fail the whole sync. Whole-call failures
 * bubble — caller (cron / tRPC) decides retry.
 */
import { decrypt, type EncryptedField } from '@getyn/crypto';
import {
  WAQualityRating,
  WATemplateCategory,
  WATemplateStatus,
  WAStatus,
  type Prisma,
} from '@getyn/db';

import { listWabaTemplates, type MetaTemplate } from './meta-client';

interface AccountForTemplateSync {
  id: string;
  tenantId: string;
  wabaId: string;
  status: WAStatus;
  accessTokenEncrypted: unknown;
}

export interface TemplateSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  linked: number; // local DRAFT linked to a Meta-known template
  skipped: number;
  pendingExpired: number; // PENDING rows aged > 7d, marked DISABLED
  errors: Array<{ templateName: string; message: string }>;
}

function mapTemplateStatus(
  raw: MetaTemplate['status'],
): WATemplateStatus {
  switch (raw) {
    case 'APPROVED':
      return WATemplateStatus.APPROVED;
    case 'PENDING':
      return WATemplateStatus.PENDING;
    case 'REJECTED':
      return WATemplateStatus.REJECTED;
    case 'PAUSED':
      return WATemplateStatus.PAUSED;
    case 'DISABLED':
      return WATemplateStatus.DISABLED;
    case 'IN_APPEAL':
      return WATemplateStatus.PENDING;
    case 'PENDING_DELETION':
      return WATemplateStatus.DISABLED;
    default:
      return WATemplateStatus.PENDING;
  }
}

function mapTemplateCategory(
  raw: MetaTemplate['category'],
): WATemplateCategory {
  switch (raw) {
    case 'MARKETING':
      return WATemplateCategory.MARKETING;
    case 'UTILITY':
      return WATemplateCategory.UTILITY;
    case 'AUTHENTICATION':
      return WATemplateCategory.AUTHENTICATION;
    default:
      return WATemplateCategory.UTILITY;
  }
}

function mapTemplateQuality(raw: string | undefined): WAQualityRating {
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

const PENDING_EXPIRY_DAYS = 7;

export async function syncTemplatesForWaba(
  account: AccountForTemplateSync,
  tx: Prisma.TransactionClient,
): Promise<TemplateSyncSummary> {
  const summary: TemplateSyncSummary = {
    fetched: 0,
    created: 0,
    updated: 0,
    linked: 0,
    skipped: 0,
    pendingExpired: 0,
    errors: [],
  };

  if (account.status !== WAStatus.CONNECTED) {
    return summary;
  }

  const accessToken = decrypt(
    account.accessTokenEncrypted as unknown as EncryptedField,
    account.tenantId,
  );

  const metaTemplates = await listWabaTemplates(account.wabaId, accessToken);
  summary.fetched = metaTemplates.length;
  const seenLocalIds = new Set<string>();
  const now = new Date();

  for (const t of metaTemplates) {
    try {
      // Look up by Meta id first.
      let local = await tx.whatsAppTemplate.findFirst({
        where: {
          tenantId: account.tenantId,
          whatsAppAccountId: account.id,
          metaTemplateId: t.id,
          deletedAt: null,
        },
      });

      // Fall back to the (name, language, DRAFT) link case.
      if (!local) {
        local = await tx.whatsAppTemplate.findFirst({
          where: {
            tenantId: account.tenantId,
            whatsAppAccountId: account.id,
            name: t.name,
            language: t.language,
            metaTemplateId: null,
            deletedAt: null,
          },
        });
        if (local) {
          summary.linked += 1;
        }
      }

      const status = mapTemplateStatus(t.status);
      const category = mapTemplateCategory(t.category);
      const quality = mapTemplateQuality(t.quality_score?.score);

      if (local) {
        await tx.whatsAppTemplate.update({
          where: { id: local.id },
          data: {
            metaTemplateId: t.id,
            name: t.name,
            language: t.language,
            category,
            status,
            rejectionReason: t.rejected_reason ?? null,
            components: t.components as unknown as Prisma.JsonArray,
            qualityRating: quality,
            lastSyncedAt: now,
            // Stamp approvedAt on the APPROVED transition without
            // overwriting an existing value (re-syncs would otherwise
            // bump it forward).
            ...(status === WATemplateStatus.APPROVED && !local.approvedAt
              ? { approvedAt: now }
              : {}),
          },
        });
        summary.updated += 1;
        seenLocalIds.add(local.id);
      } else {
        const created = await tx.whatsAppTemplate.create({
          data: {
            tenantId: account.tenantId,
            whatsAppAccountId: account.id,
            metaTemplateId: t.id,
            name: t.name,
            language: t.language,
            category,
            status,
            rejectionReason: t.rejected_reason ?? null,
            components: t.components as unknown as Prisma.JsonArray,
            qualityRating: quality,
            lastSyncedAt: now,
            submittedAt: now, // best-effort; we don't know the real submit time
            approvedAt: status === WATemplateStatus.APPROVED ? now : null,
          },
        });
        summary.created += 1;
        seenLocalIds.add(created.id);
      }
    } catch (err) {
      summary.errors.push({
        templateName: t.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Stale PENDING expiry: rows submitted > 7d ago Meta no longer returns
  // are presumed dropped. Mark DISABLED. Don't touch APPROVED / REJECTED
  // — those are stable terminal states even when paginated subsets miss
  // them.
  const cutoff = new Date(now.getTime() - PENDING_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const expired = await tx.whatsAppTemplate.updateMany({
    where: {
      tenantId: account.tenantId,
      whatsAppAccountId: account.id,
      status: WATemplateStatus.PENDING,
      submittedAt: { lt: cutoff },
      id: { notIn: Array.from(seenLocalIds) },
      deletedAt: null,
    },
    data: {
      status: WATemplateStatus.DISABLED,
      lastSyncedAt: now,
    },
  });
  summary.pendingExpired = expired.count;

  return summary;
}
