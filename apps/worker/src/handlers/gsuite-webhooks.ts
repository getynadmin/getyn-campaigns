/* eslint-disable no-console */
/**
 * Phase 5 M4 — G-Suite webhook event handler.
 *
 * Reads the persisted GSuiteWebhookEvent row, dispatches by
 * eventType, stamps processedAt at the end. Idempotent — re-runs
 * (BullMQ retry, mock-fire double-click) short-circuit on
 * processedAt !== null.
 *
 * # Branches
 *   subscription.updated  → re-pull plan (M3 stub; replaced when
 *                           the G-Suite spec is firm)
 *   subscription.canceled → set BillingSubscription.status=CANCELED,
 *                           stamp cancelAt, transition tenant to
 *                           read-only mode via Tenant.billingStatus
 *   tenant.suspended      → BillingSubscription.status=SUSPENDED,
 *                           halt queues for this tenant (workers
 *                           re-check state per job)
 *   tenant.reactivated    → reverse suspension/cancellation
 *   tenant.deleted        → schedule tenant-purge job. Requires
 *                           `payload.deleteConfirmedAt` so a
 *                           misrouted event can't trigger purge.
 *
 * Unknown eventTypes are logged + stamped processedAt with
 * processError=null. We persist them for audit but no-op them.
 */
import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';

import {
  BillingStatus,
  BillingSubscriptionStatus,
  prisma,
  type Prisma,
} from '@getyn/db';
import {
  gsuiteWebhookPayloadSchema,
  type GsuiteWebhookPayload,
} from '@getyn/types';

export async function handleGsuiteWebhookEvent(job: Job): Promise<void> {
  const payload: GsuiteWebhookPayload = gsuiteWebhookPayloadSchema.parse(
    job.data,
  );
  const event = await prisma.gSuiteWebhookEvent.findUnique({
    where: { id: payload.webhookEventId },
  });
  if (!event) return;
  if (event.processedAt) return; // idempotent: already done

  try {
    switch (event.eventType) {
      case 'subscription.updated':
        await handleSubscriptionUpdated(event);
        break;
      case 'subscription.canceled':
        await handleSubscriptionCanceled(event);
        break;
      case 'tenant.suspended':
        await handleTenantSuspended(event);
        break;
      case 'tenant.reactivated':
        await handleTenantReactivated(event);
        break;
      case 'tenant.deleted':
        await handleTenantDeleted(event);
        break;
      default:
        console.info(
          `[gsuite-webhooks] unknown eventType=${event.eventType} id=${event.id}; skipping`,
        );
    }
    await prisma.gSuiteWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), processError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    await prisma.gSuiteWebhookEvent.update({
      where: { id: event.id },
      data: { processError: message.slice(0, 1000) },
    });
    Sentry.captureException(err, {
      tags: {
        queue: 'gsuite-webhooks',
        eventType: event.eventType,
        failure: 'process',
      },
      extra: { webhookEventId: event.id, gSuiteEventId: event.gSuiteEventId },
    });
    throw err;
  }
}

// --------------------------------------------------------------------
// Branches
// --------------------------------------------------------------------

interface WebhookRow {
  id: string;
  tenantId: string | null;
  eventType: string;
  rawPayload: Prisma.JsonValue;
}

/**
 * subscription.updated: re-pull plan from G-Suite as source of truth.
 * M3's pullPlanFromGSuite ships the real implementation; here we
 * mark the row processed + log so the path is exercised in mock
 * fires.
 */
async function handleSubscriptionUpdated(event: WebhookRow): Promise<void> {
  if (!event.tenantId) {
    console.warn(
      `[gsuite-webhooks:subscription.updated] no local tenant for event ${event.id}`,
    );
    return;
  }
  // M3 will: pullPlanFromGSuite(tenant.gSuiteTenantId)
  console.info(
    `[gsuite-webhooks:subscription.updated] tenant=${event.tenantId} — M3 will pull plan when contract is firm`,
  );
}

async function handleSubscriptionCanceled(event: WebhookRow): Promise<void> {
  if (!event.tenantId) return;
  const payload = event.rawPayload as { payload?: { cancelAt?: string } };
  const cancelAt = payload.payload?.cancelAt
    ? new Date(payload.payload.cancelAt)
    : new Date();

  await prisma.$transaction(async (tx) => {
    // Update BillingSubscription mirror (if present).
    await tx.billingSubscription.updateMany({
      where: { tenantId: event.tenantId! },
      data: {
        status: BillingSubscriptionStatus.CANCELED,
        cancelAt,
        lastSyncedAt: new Date(),
      },
    });
    // Bump the legacy Tenant.billingStatus too so older code paths
    // that read it still see the right thing.
    await tx.tenant.update({
      where: { id: event.tenantId! },
      data: { billingStatus: BillingStatus.CANCELED },
    });
  });

  console.info(
    `[gsuite-webhooks:subscription.canceled] tenant=${event.tenantId} cancelAt=${cancelAt.toISOString()}`,
  );
}

async function handleTenantSuspended(event: WebhookRow): Promise<void> {
  if (!event.tenantId) return;
  await prisma.billingSubscription.updateMany({
    where: { tenantId: event.tenantId },
    data: {
      status: BillingSubscriptionStatus.SUSPENDED,
      lastSyncedAt: new Date(),
    },
  });
  // No legacy enum value for SUSPENDED — Tenant.billingStatus stays
  // as-is. deriveTenantState reads BillingSubscription as primary.
  Sentry.captureMessage('gsuite tenant.suspended', {
    level: 'warning',
    tags: {
      queue: 'gsuite-webhooks',
      tenantId: event.tenantId,
      event: 'tenant_suspended',
    },
  });
  console.info(`[gsuite-webhooks:tenant.suspended] tenant=${event.tenantId}`);
}

async function handleTenantReactivated(event: WebhookRow): Promise<void> {
  if (!event.tenantId) return;
  await prisma.$transaction(async (tx) => {
    await tx.billingSubscription.updateMany({
      where: { tenantId: event.tenantId! },
      data: {
        status: BillingSubscriptionStatus.ACTIVE,
        cancelAt: null,
        lastSyncedAt: new Date(),
      },
    });
    await tx.tenant.update({
      where: { id: event.tenantId! },
      data: { billingStatus: BillingStatus.ACTIVE },
    });
  });
  console.info(
    `[gsuite-webhooks:tenant.reactivated] tenant=${event.tenantId}`,
  );
}

/**
 * tenant.deleted: schedule a purge job. Requires the payload to
 * carry deleteConfirmedAt — guards against accidentally enqueueing
 * a destructive job from a misrouted event.
 */
async function handleTenantDeleted(event: WebhookRow): Promise<void> {
  if (!event.tenantId) return;
  const payload = event.rawPayload as {
    payload?: { deleteConfirmedAt?: string };
  };
  const confirmedAt = payload.payload?.deleteConfirmedAt;
  if (!confirmedAt) {
    Sentry.captureMessage('gsuite tenant.deleted missing deleteConfirmedAt', {
      level: 'error',
      tags: { queue: 'gsuite-webhooks', tenantId: event.tenantId },
    });
    throw new Error(
      'tenant.deleted event missing deleteConfirmedAt — refusing to schedule purge.',
    );
  }

  // Mark tenant as purging so write guards engage immediately.
  await prisma.tenant.update({
    where: { id: event.tenantId },
    data: {
      settings: { purging: true } as Prisma.JsonObject,
    },
  });

  // Lazy-import the producer so this module stays free of the
  // queues/redis dependency chain.
  const { Queue } = await import('bullmq');
  const { createRedisConnection } = await import('../redis');
  const env = (await import('../env')).loadEnv();
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL unset — cannot schedule tenant purge');
  }
  const conn = createRedisConnection(env.REDIS_URL);
  const q = new Queue('tenant-purge', { connection: conn });
  await q.add(
    'purge-tenant',
    {
      tenantId: event.tenantId,
      deleteConfirmedAt: confirmedAt,
      trigger: 'gsuite',
    },
    {
      jobId: `purge_${event.tenantId}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    },
  );
  await q.close();
  await conn.quit();

  console.info(
    `[gsuite-webhooks:tenant.deleted] purge scheduled for tenant=${event.tenantId}`,
  );
}
