/* eslint-disable no-console */
import * as Sentry from '@sentry/node';
import { Queue, type Job } from 'bullmq';

import { WAStatus, WATemplateStatus, prisma, withTenant } from '@getyn/db';
import {
  QUEUE_NAMES,
  pollTemplateSubmissionPayloadSchema,
  syncWabaTemplatesPayloadSchema,
} from '@getyn/types';
import { syncTemplatesForWaba } from '@getyn/whatsapp';

import { loadEnv } from '../env';
import { createRedisConnection } from '../redis';

/**
 * wa-template-sync — Phase 4 M5.
 *
 * Three job shapes:
 *
 *   - 'tick' (cron, hourly): finds CONNECTED WABAs, fans out
 *     'sync-waba' jobs.
 *   - 'sync-waba' (per-WABA): pulls templates from Meta and reconciles
 *     against local rows.
 *   - 'poll-submission' (short-lived): kicked from the M6 submit
 *     mutation. Polls every 30s for up to 5 min for fast feedback on
 *     a freshly-submitted template's status.
 *
 * Errors:
 *   - sync-waba whole-call failures bubble; BullMQ retries 3x.
 *   - poll-submission fails silently after attempt 9 — the hourly
 *     tick will pick it up regardless.
 */

const env = loadEnv();

let _queue: Queue | null = null;
function getQueue(): Queue {
  if (!_queue) {
    if (!env.REDIS_URL) throw new Error('REDIS_URL unset in worker');
    const conn = createRedisConnection(env.REDIS_URL);
    _queue = new Queue(QUEUE_NAMES.waTemplateSync, { connection: conn });
  }
  return _queue;
}

export async function handleWaTemplateSyncTick(): Promise<{ enqueued: number }> {
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { status: WAStatus.CONNECTED },
    select: { id: true, tenantId: true },
  });
  const queue = getQueue();
  for (const a of accounts) {
    await queue.add(
      'sync-waba',
      { whatsAppAccountId: a.id, tenantId: a.tenantId },
      {
        jobId: `wa-template-sync:${a.id}`,
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
  }
  console.info(
    `[cron:wa-template-sync] enqueued ${accounts.length} WABA syncs`,
  );
  return { enqueued: accounts.length };
}

export async function handleWaTemplateSyncOne(job: Job): Promise<void> {
  const payload = syncWabaTemplatesPayloadSchema.parse(job.data);
  const account = await prisma.whatsAppAccount.findUnique({
    where: { id: payload.whatsAppAccountId },
  });
  if (!account || account.status !== WAStatus.CONNECTED) return;

  try {
    const summary = await withTenant(payload.tenantId, (tx) =>
      syncTemplatesForWaba(account, tx),
    );
    console.info(
      `[wa-template-sync] tenant=${payload.tenantId} fetched=${summary.fetched} created=${summary.created} updated=${summary.updated} linked=${summary.linked} pendingExpired=${summary.pendingExpired} errors=${summary.errors.length}`,
    );
    if (summary.errors.length > 0) {
      Sentry.captureMessage('wa-template-sync: per-template errors', {
        level: 'warning',
        tags: {
          queue: 'wa-template-sync',
          tenantId: payload.tenantId,
          channel: 'whatsapp',
        },
        extra: { errors: summary.errors },
      });
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        queue: 'wa-template-sync',
        tenantId: payload.tenantId,
        channel: 'whatsapp',
        failure: 'meta_api',
      },
      extra: { whatsAppAccountId: payload.whatsAppAccountId },
    });
    throw err;
  }
}

/**
 * Per-template fast poll. Runs up to 10 attempts at 30s intervals
 * after a tenant submits a template. Stops early if the template
 * leaves PENDING (transitions to APPROVED / REJECTED / etc).
 */
export async function handleWaTemplatePoll(job: Job): Promise<void> {
  const payload = pollTemplateSubmissionPayloadSchema.parse(job.data);
  const tpl = await prisma.whatsAppTemplate.findFirst({
    where: { id: payload.templateId, tenantId: payload.tenantId },
    include: { whatsAppAccount: true },
  });
  if (!tpl) return;
  if (tpl.status !== WATemplateStatus.PENDING) {
    // Already terminal or moved on — nothing to do.
    return;
  }
  if (tpl.whatsAppAccount.status !== WAStatus.CONNECTED) return;

  // Run a sync — cheap because Meta returns the whole template list.
  // The reconciler picks up the row by its metaTemplateId and updates
  // status. We swallow whole-call failures here (vs sync-waba) because
  // poll attempts are cheap and the hourly tick will catch up.
  try {
    await withTenant(payload.tenantId, (tx) =>
      syncTemplatesForWaba(tpl.whatsAppAccount, tx),
    );
  } catch (err) {
    console.warn(
      `[wa-template-sync:poll] tenant=${payload.tenantId} attempt=${payload.attempt} failed:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Re-read to decide whether to chain another poll.
  const after = await prisma.whatsAppTemplate.findUnique({
    where: { id: payload.templateId },
    select: { status: true },
  });
  if (after && after.status === WATemplateStatus.PENDING && payload.attempt < 9) {
    const queue = getQueue();
    await queue.add(
      'poll-submission',
      {
        templateId: payload.templateId,
        tenantId: payload.tenantId,
        attempt: payload.attempt + 1,
      },
      {
        delay: 30_000,
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 1,
      },
    );
  }
}
