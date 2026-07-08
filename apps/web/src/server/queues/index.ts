import 'server-only';

import {
  JOB_NAMES,
  QUEUE_NAMES,
  attachmentParsePayloadSchema,
  automationStepPayloadSchema,
  automationWakePayloadSchema,
  emailAgentEnrollPayloadSchema,
  emailAgentIngestKnowledgeSourcePayloadSchema,
  emailAgentProcessReplyPayloadSchema,
  importJobPayloadSchema,
  inboundEmailProcessPayloadSchema,
  pollTemplateSubmissionPayloadSchema,
  prepareCampaignPayloadSchema,
  prepareWaCampaignPayloadSchema,
  resendWebhookPayloadSchema,
  type AttachmentParsePayload,
  type AutomationStepPayload,
  type AutomationWakePayload,
  type EmailAgentEnrollPayload,
  type EmailAgentIngestKnowledgeSourcePayload,
  type EmailAgentProcessReplyPayload,
  type ImportJobPayload,
  type InboundEmailProcessPayload,
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
let cachedInboundEmailsQueue: Queue<InboundEmailProcessPayload> | null = null;
let cachedAutomationsQueue: Queue | null = null;
let cachedEmailAgentQueue: Queue | null = null;

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
  // BullMQ's job scheduler (v5+) rejects custom jobIds containing
  // `:` — it reserves the character for its internal repeat-key
  // encoding. Use `_` separators instead.
  await queue.add(JOB_NAMES.webhooks.processResendEvent, validated, {
    jobId: `resend_${validated.messageId}_${validated.eventType}`,
  });
}

function getInboundEmailsQueue(): Queue<InboundEmailProcessPayload> {
  if (cachedInboundEmailsQueue) return cachedInboundEmailsQueue;
  cachedInboundEmailsQueue = new Queue<InboundEmailProcessPayload>(
    QUEUE_NAMES.inboundEmails,
    {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 60 * 60 * 24 * 3, count: 5000 },
        removeOnFail: { age: 60 * 60 * 24 * 30 },
      },
    },
  );
  return cachedInboundEmailsQueue;
}

/**
 * Phase 8 M1 — enqueue an inbound-email row for token-routing.
 *
 * The webhook receiver at /api/webhooks/inbound-email persists the
 * raw payload synchronously (so nothing is lost on worker downtime)
 * and hands the row id here. The worker re-reads the row, decodes
 * the +token in the To: address, and fans out to CampaignSend /
 * EmailAgentEnrollment / AutomationEnrollment.
 *
 * jobId is scoped on the inboundEmailId itself so duplicate provider
 * retries collapse.
 */
export async function enqueueInboundEmailProcess(
  payload: InboundEmailProcessPayload,
): Promise<void> {
  const validated = inboundEmailProcessPayloadSchema.parse(payload);
  const queue = getInboundEmailsQueue();
  await queue.add(JOB_NAMES.inboundEmails.process, validated, {
    jobId: `inbound_${validated.inboundEmailId}`,
  });
}

// -----------------------------------------------------------------
// Phase 8 M3 — automations
// -----------------------------------------------------------------

function getAutomationsQueue(): Queue {
  if (cachedAutomationsQueue) return cachedAutomationsQueue;
  cachedAutomationsQueue = new Queue(QUEUE_NAMES.automations, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 3, count: 5000 },
      removeOnFail: { age: 60 * 60 * 24 * 14 },
    },
  });
  return cachedAutomationsQueue;
}

/**
 * Kick off a single enrollment step (fresh enroll, manual re-trigger,
 * wake after DRAFT→LIVE). The 60s tick handles the routine case;
 * this is for interactive nudges.
 *
 * jobId scoped so back-to-back nudges on the same enrollment collapse.
 */
export async function enqueueAutomationStep(
  payload: AutomationStepPayload,
): Promise<void> {
  const validated = automationStepPayloadSchema.parse(payload);
  const queue = getAutomationsQueue();
  await queue.add(JOB_NAMES.automations.step, validated, {
    jobId: `step_${validated.enrollmentId}_${Date.now()}`,
  });
}

/**
 * Bulk-enqueue step jobs — one Redis roundtrip via BullMQ's addBulk.
 * Used by enrollFromSegment where a single mutation may want to fire
 * thousands of step jobs. On Vercel serverless the previous
 * fire-and-forget-loop pattern got killed mid-flight when the
 * function returned; addBulk lets the mutation await a single call
 * that finishes cleanly before response.
 */
export async function enqueueAutomationSteps(
  payloads: AutomationStepPayload[],
): Promise<void> {
  if (payloads.length === 0) return;
  const validated = payloads.map((p) => automationStepPayloadSchema.parse(p));
  const queue = getAutomationsQueue();
  const now = Date.now();
  await queue.addBulk(
    validated.map((p, i) => ({
      name: JOB_NAMES.automations.step,
      data: p,
      opts: { jobId: `step_${p.enrollmentId}_${now}_${i}` },
    })),
  );
}

/**
 * Wake enrollments paused at a specific DRAFT node after it flips
 * LIVE. Idempotent — the handler sets nextActionAt=now on qualifying
 * rows; duplicates just no-op.
 */
export async function enqueueAutomationWake(
  payload: AutomationWakePayload,
): Promise<void> {
  const validated = automationWakePayloadSchema.parse(payload);
  const queue = getAutomationsQueue();
  await queue.add(JOB_NAMES.automations.wake, validated, {
    jobId: `wake_${validated.automationId}_${validated.nodeId}`,
  });
}

// -----------------------------------------------------------------
// Phase 8 M5 — Email Agent
// -----------------------------------------------------------------

function getEmailAgentQueue(): Queue {
  if (cachedEmailAgentQueue) return cachedEmailAgentQueue;
  cachedEmailAgentQueue = new Queue(QUEUE_NAMES.emailAgent, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 3, count: 5000 },
      removeOnFail: { age: 60 * 60 * 24 * 30 },
    },
  });
  return cachedEmailAgentQueue;
}

/**
 * Trigger the initial outreach draft-and-send for one enrollment.
 * Fired by emailAgent.enroll and by activate (for pre-existing
 * enrollments). Idempotent on enrollmentId — the worker skips
 * enrollments that already have an outbound message.
 */
export async function enqueueEmailAgentEnroll(
  payload: EmailAgentEnrollPayload,
): Promise<void> {
  const validated = emailAgentEnrollPayloadSchema.parse(payload);
  const queue = getEmailAgentQueue();
  await queue.add(JOB_NAMES.emailAgent.enroll, validated, {
    jobId: `enroll_${validated.enrollmentId}`,
  });
}

/**
 * Classify + draft a reply. Fired by the M1 inbound-email worker
 * once it's matched the reply to an EmailAgentEnrollment.
 */
export async function enqueueEmailAgentProcessReply(
  payload: EmailAgentProcessReplyPayload,
): Promise<void> {
  const validated = emailAgentProcessReplyPayloadSchema.parse(payload);
  const queue = getEmailAgentQueue();
  await queue.add(JOB_NAMES.emailAgent.processReply, validated, {
    jobId: `reply_${validated.inboundEmailId}`,
  });
}

/**
 * Phase 8 M6 — pull + summarize a knowledge source. Fired on
 * knowledge-source create (URL / FILE kinds) and on the Refresh
 * button. Bucketed on knowledgeSourceId so back-to-back triggers
 * collapse.
 */
export async function enqueueEmailAgentIngest(
  payload: EmailAgentIngestKnowledgeSourcePayload,
): Promise<void> {
  const validated = emailAgentIngestKnowledgeSourcePayloadSchema.parse(payload);
  const queue = getEmailAgentQueue();
  await queue.add(JOB_NAMES.emailAgent.ingestKnowledgeSource, validated, {
    jobId: `ingest_${validated.knowledgeSourceId}`,
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
    jobId: `prepare_${validated.campaignId}`,
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
    jobId: `poll_${validated.templateId}_${validated.attempt}`,
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

// ----------------------------------------------------------------------------
// Phase 4 M9 — wa-webhooks producer
// ----------------------------------------------------------------------------

let cachedWaWebhooksQueue: Queue | null = null;

function getWaWebhooksQueue(): Queue {
  if (cachedWaWebhooksQueue) return cachedWaWebhooksQueue;
  cachedWaWebhooksQueue = new Queue(QUEUE_NAMES.waWebhooks, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 3, count: 5000 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  });
  return cachedWaWebhooksQueue;
}

export async function enqueueWaWebhookEvent(payload: {
  webhookEventId: string;
}): Promise<void> {
  const queue = getWaWebhooksQueue();
  await queue.add(JOB_NAMES.waWebhooks.process, payload, {
    jobId: `wa-webhook_${payload.webhookEventId}`,
  });
}

// ----------------------------------------------------------------------------
// Phase 5 M4 — G-Suite webhook + tenant purge producers
// ----------------------------------------------------------------------------

let cachedGsuiteQueue: Queue | null = null;
function getGsuiteQueue(): Queue {
  if (cachedGsuiteQueue) return cachedGsuiteQueue;
  cachedGsuiteQueue = new Queue(QUEUE_NAMES.gsuiteWebhooks, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 7, count: 5000 },
      removeOnFail: { age: 60 * 60 * 24 * 30 },
    },
  });
  return cachedGsuiteQueue;
}

export async function enqueueGsuiteWebhookEvent(payload: {
  webhookEventId: string;
}): Promise<void> {
  const queue = getGsuiteQueue();
  await queue.add(JOB_NAMES.gsuiteWebhooks.process, payload, {
    jobId: `gsuite-event_${payload.webhookEventId}`,
  });
}

let cachedPurgeQueue: Queue | null = null;
function getPurgeQueue(): Queue {
  if (cachedPurgeQueue) return cachedPurgeQueue;
  cachedPurgeQueue = new Queue(QUEUE_NAMES.tenantPurge, {
    connection: getConnection(),
    defaultJobOptions: {
      // Purge is destructive — retry sparingly, don't loop forever.
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 60 * 60 * 24 * 90 },
      removeOnFail: { age: 60 * 60 * 24 * 90 },
    },
  });
  return cachedPurgeQueue;
}

export async function enqueueTenantPurge(payload: {
  tenantId: string;
  deleteConfirmedAt: string;
  trigger: 'gsuite' | 'grace_expired' | 'staff_force';
  delayMs?: number;
}): Promise<void> {
  const queue = getPurgeQueue();
  await queue.add(
    JOB_NAMES.tenantPurge.purge,
    {
      tenantId: payload.tenantId,
      deleteConfirmedAt: payload.deleteConfirmedAt,
      trigger: payload.trigger,
    },
    {
      jobId: `purge_${payload.tenantId}`,
      ...(payload.delayMs ? { delay: payload.delayMs } : {}),
    },
  );
}

// Phase 7.1 — agent attachment parse queue.
let cachedAttachmentParseQueue: Queue<AttachmentParsePayload> | null = null;
function getAttachmentParseQueue(): Queue<AttachmentParsePayload> {
  if (cachedAttachmentParseQueue) return cachedAttachmentParseQueue;
  cachedAttachmentParseQueue = new Queue<AttachmentParsePayload>(
    QUEUE_NAMES.attachmentParse,
    {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 60 * 60 * 24 * 3, count: 1000 },
        removeOnFail: { age: 60 * 60 * 24 * 14 },
      },
    },
  );
  return cachedAttachmentParseQueue;
}

export async function enqueueAttachmentParse(
  payload: AttachmentParsePayload,
): Promise<void> {
  const validated = attachmentParsePayloadSchema.parse(payload);
  const queue = getAttachmentParseQueue();
  await queue.add(JOB_NAMES.attachmentParse.parse, validated, {
    // jobId = agentAttachmentId so a retry on the upload route doesn't
    // double-parse a single attachment.
    jobId: validated.agentAttachmentId,
  });
}
