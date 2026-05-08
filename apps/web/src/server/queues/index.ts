import 'server-only';

import {
  JOB_NAMES,
  QUEUE_NAMES,
  importJobPayloadSchema,
  pollTemplateSubmissionPayloadSchema,
  prepareCampaignPayloadSchema,
  prepareWaCampaignPayloadSchema,
  resendWebhookPayloadSchema,
  type ImportJobPayload,
  type PollTemplateSubmissionPayload,
  type PrepareCampaignPayload,
  type PrepareWaCampaignPayload,
  type ResendWebhookPayload,
} from '@getyn/types';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/**
 * BullMQ producer wiring for the web app. The worker (apps/worker) consumes
 * these jobs. We keep two things strictly in sync with the worker via
 * packages/types:
 *   - the queue name (QUEUE_NAMES.imports)
 *   - the payload schema (importJobPayloadSchema)
 *
 * Connections are lazy: we only open Redis on the first enqueue call. That
 * means a cold tRPC request that never enqueues pays zero Redis cost.
 */

let cachedConnection: Redis | null = null;
let cachedImportsQueue: Queue<ImportJobPayload> | null = null;
let cachedSendsQueue: Queue | null = null;
let cachedWebhooksQueue: Queue<ResendWebhookPayload> | null = null;

function getConnection(): Redis {
  if (cachedConnection) return cachedConnection;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL is not set — cannot enqueue background jobs. See README for Upstash setup.',
    );
  }
  cachedConnection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return cachedConnection;
}

function getImportsQueue(): Queue<ImportJobPayload> {
  if (cachedImportsQueue) return cachedImportsQueue;
  cachedImportsQueue = new Queue<ImportJobPayload>(QUEUE_NAMES.imports, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      // Keep recent history for the admin UI; trim aggressively otherwise.
      removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 30 },
    },
  });
  return cachedImportsQueue;
}

/**
 * Enqueue an import job. Called from `importJob.start` tRPC mutation once
 * the wizard finishes and the CSV is in Supabase Storage.
 *
 * Uses BullMQ's `jobId` field set to `importJobId` so that re-submitting the
 * same importJobId (e.g. on a retry after the HTTP request times out) is a
 * no-op instead of creating duplicates.
 */
export async function enqueueImportJob(payload: ImportJobPayload): Promise<void> {
  const validated = importJobPayloadSchema.parse(payload);
  const queue = getImportsQueue();
  await queue.add(JOB_NAMES.imports.processImport, validated, {
    jobId: validated.importJobId,
  });
}

function getSendsQueue(): Queue {
  if (cachedSendsQueue) return cachedSendsQueue;
  cachedSendsQueue = new Queue(QUEUE_NAMES.sends, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 30 },
    },
  });
  return cachedSendsQueue;
}

function getWebhooksQueue(): Queue<ResendWebhookPayload> {
  if (cachedWebhooksQueue) return cachedWebhooksQueue;
  cachedWebhooksQueue = new Queue<ResendWebhookPayload>(QUEUE_NAMES.webhooks, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 3, count: 5000 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  });
  return cachedWebhooksQueue;
}

/**
 * Enqueue a Resend webhook event for async processing. The receiver at
 * /api/webhooks/resend hands events here so the HTTP response stays fast
 * (<100ms) regardless of DB load.
 */
export async function enqueueResendWebhookEvent(
  payload: ResendWebhookPayload,
): Promise<void> {
  const validated = resendWebhookPayloadSchema.parse(payload);
  const queue = getWebhooksQueue();
  // jobId scoped on (messageId, eventType) — duplicate POSTs collapse.
  await queue.add(JOB_NAMES.webhooks.processResendEvent, validated, {
    jobId: `resend:${validated.messageId}:${validated.eventType}`,
  });
}

/**
 * Enqueue a `prepare-campaign` job. Called from `campaign.sendNow` and
 * `campaign.schedule`. The worker takes over from there: resolves the
 * segment, materializes CampaignSend rows, and chain-enqueues
 * `dispatch-batch` jobs.
 *
 * `jobId` is set to `prepare:${campaignId}` so a duplicate enqueue (HTTP
 * retry, scheduler firing twice in a race) collapses instead of running
 * twice.
 *
 * `delay` is used by `campaign.schedule` to wait until `scheduledAt` —
 * BullMQ delays the job until then. The worker's pickup order respects
 * the delay.
 */
export async function enqueuePrepareCampaign(
  payload: PrepareCampaignPayload,
  options: { delayMs?: number } = {},
): Promise<void> {
  const validated = prepareCampaignPayloadSchema.parse(payload);
  const queue = getSendsQueue();
  await queue.add(JOB_NAMES.sends.prepareCampaign, validated, {
    jobId: `prepare:${validated.campaignId}`,
    ...(options.delayMs !== undefined ? { delay: options.delayMs } : {}),
  });
}

// ----------------------------------------------------------------------------
// Phase 4 M5/M6 — wa-template-sync producer
//
// The web app enqueues a poll-submission job after a tenant submits a
// template via the M6 authoring UI. The worker chain handles up to 10
// follow-up polls at 30s intervals before yielding to the hourly tick.
// ----------------------------------------------------------------------------

let cachedWaTemplateSyncQueue: Queue | null = null;

function getWaTemplateSyncQueue(): Queue {
  if (cachedWaTemplateSyncQueue) return cachedWaTemplateSyncQueue;
  cachedWaTemplateSyncQueue = new Queue(QUEUE_NAMES.waTemplateSync, {
    connection: getConnection(),
    defaultJobOptions: {
      removeOnComplete: { age: 60 * 60, count: 200 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  });
  return cachedWaTemplateSyncQueue;
}

export async function enqueuePollTemplateSubmission(
  payload: PollTemplateSubmissionPayload,
): Promise<void> {
  const validated = pollTemplateSubmissionPayloadSchema.parse(payload);
  const queue = getWaTemplateSyncQueue();
  await queue.add(JOB_NAMES.waTemplateSync.pollSubmission, validated, {
    // First poll fires 30s after submit so Meta has time to assign a status.
    delay: 30_000,
    attempts: 1,
    jobId: `poll:${validated.templateId}:${validated.attempt}`,
  });
}

// ----------------------------------------------------------------------------
// Phase 4 M8 — wa-sends producer
// ----------------------------------------------------------------------------

let cachedWaSendsQueue: Queue<PrepareWaCampaignPayload> | null = null;

function getWaSendsQueue(): Queue<PrepareWaCampaignPayload> {
  if (cachedWaSendsQueue) return cachedWaSendsQueue;
  cachedWaSendsQueue = new Queue<PrepareWaCampaignPayload>(QUEUE_NAMES.waSends, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 30 },
    },
  });
  return cachedWaSendsQueue;
}

/**
 * Enqueue prepare-wa-campaign. Kickoff from sendNow / schedule.
 * Idempotent on jobId — re-clicks won't double-prepare.
 */
export async function enqueuePrepareWaCampaign(
  payload: PrepareWaCampaignPayload,
  options: { delayMs?: number } = {},
): Promise<void> {
  const validated = prepareWaCampaignPayloadSchema.parse(payload);
  const queue = getWaSendsQueue();
  await queue.add(JOB_NAMES.waSends.prepareCampaign, validated, {
    jobId: `prepare-wa_${validated.campaignId}`,
    ...(options.delayMs !== undefined ? { delay: options.delayMs } : {}),
  });
}
