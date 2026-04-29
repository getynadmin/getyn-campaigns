/* eslint-disable no-console */
import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';

import { WAStatus, prisma, withTenant } from '@getyn/db';
import { refreshWabaPayloadSchema } from '@getyn/types';
import { refreshPhoneNumbersForWaba } from '@getyn/whatsapp';

/**
 * wa-phone-refresh — Phase 4 M4.
 *
 * BullMQ delivers two job shapes here:
 *
 *   1. The repeatable scheduler tick (job.name = 'tick'): pulls every
 *      CONNECTED WhatsAppAccount and enqueues one `refresh-waba` job
 *      per account. Runs every 6h. We do this fan-out indirectly so
 *      each account refresh gets its own retry envelope and can fail
 *      independently.
 *
 *   2. The fan-out job (job.name = 'refresh-waba'): processes a
 *      single account. Calls Meta + upserts WhatsAppPhoneNumber rows.
 *
 * Error policy:
 *   - Per-phone errors are caught inside refreshPhoneNumbersForWaba;
 *     they accumulate in the summary but never fail the job.
 *   - Token-revoked / WABA-suspended throws bubble up here, where we
 *     log + capture to Sentry with a tenant tag. We do NOT mark the
 *     account DISCONNECTED — a transient Meta blip shouldn't take a
 *     tenant offline. M9's webhook handler is the authoritative path
 *     for status changes.
 */
export async function handleWaPhoneRefreshTick(): Promise<{
  enqueued: number;
}> {
  // Bypasses RLS — service role inside the worker. Find every CONNECTED
  // account and queue an individual refresh.
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { status: WAStatus.CONNECTED },
    select: { id: true, tenantId: true },
  });

  // Late-import the queue helper to avoid a circular import via
  // index.ts pulling sentry first (sentry init must run first).
  const { Queue } = await import('bullmq');
  const { createRedisConnection } = await import('../redis');
  const { loadEnv } = await import('../env');
  const env = loadEnv();
  if (!env.REDIS_URL) return { enqueued: 0 };
  const conn = createRedisConnection(env.REDIS_URL);
  const queue = new Queue('wa-phone-refresh', { connection: conn });
  for (const a of accounts) {
    await queue.add(
      'refresh-waba',
      { whatsAppAccountId: a.id, tenantId: a.tenantId },
      {
        jobId: `wa-phone-refresh:${a.id}`,
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
  }
  await queue.close();
  await conn.quit();
  console.info(`[cron:wa-phone-refresh] enqueued ${accounts.length} account refreshes`);
  return { enqueued: accounts.length };
}

export async function handleWaPhoneRefreshOne(job: Job): Promise<void> {
  const payload = refreshWabaPayloadSchema.parse(job.data);
  const account = await prisma.whatsAppAccount.findUnique({
    where: { id: payload.whatsAppAccountId },
  });
  if (!account) {
    console.warn(
      `[wa-phone-refresh] account ${payload.whatsAppAccountId} not found; skipping`,
    );
    return;
  }
  if (account.status !== WAStatus.CONNECTED) {
    return; // Disconnected mid-flight; nothing to refresh.
  }

  try {
    const summary = await withTenant(payload.tenantId, (tx) =>
      refreshPhoneNumbersForWaba(account, tx),
    );
    console.info(
      `[wa-phone-refresh] tenant=${payload.tenantId} upserted=${summary.upserted} profile_ok=${summary.metaProfileFetches.ok} profile_failed=${summary.metaProfileFetches.failed} per_phone_errors=${summary.errors.length}`,
    );
    if (summary.errors.length > 0) {
      Sentry.captureMessage('wa-phone-refresh: per-phone errors', {
        level: 'warning',
        tags: {
          queue: 'wa-phone-refresh',
          tenantId: payload.tenantId,
          channel: 'whatsapp',
        },
        extra: { errors: summary.errors },
      });
    }
  } catch (err) {
    // Whole-WABA failure (typically token revoked or WABA suspended).
    // Surface to Sentry — alert rule "WABA disconnections" picks this
    // up. Re-throw so BullMQ's retry/backoff applies; if it persists
    // past attempts, we leave the account in CONNECTED state and the
    // tenant sees the "Test connection" button reveal the reason.
    Sentry.captureException(err, {
      tags: {
        queue: 'wa-phone-refresh',
        tenantId: payload.tenantId,
        channel: 'whatsapp',
        failure: 'meta_api',
      },
      extra: { whatsAppAccountId: payload.whatsAppAccountId },
    });
    throw err;
  }
}
