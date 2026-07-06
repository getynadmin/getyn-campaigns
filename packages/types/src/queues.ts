import { z } from 'zod';

import { cuidSchema } from './common';

// -----------------------------------------------------------------------------
// Queue names — the single source of truth for BullMQ queue identifiers.
// Both the producer (apps/web) and the consumer (apps/worker) import these,
// so renames are safe across the monorepo.
// -----------------------------------------------------------------------------

export const QUEUE_NAMES = {
  imports: 'imports',
  sends: 'sends',
  webhooks: 'webhooks',
  // Phase 8 M1 — inbound reply parsing. Web receives Resend/SendGrid
  // inbound webhooks, persists InboundEmail row, enqueues here. Worker
  // decodes the reply-token and fans out to campaign/agent/automation.
  inboundEmails: 'inbound-emails',
  // Phase 8 M3 — Drip Campaigns engine.
  //  - tick (repeatable, 60s): scans due AutomationEnrollment rows,
  //    fans out per-enrollment `step` jobs.
  //  - step: processes exactly one enrollment's current node.
  //  - wake: when a message node flips DRAFT→LIVE, wakes enrollments
  //    paused at that node.
  //  - enrollByEvent: on segment/tag change, enroll qualifying
  //    contacts into automations that trigger on that event (M3 v2).
  automations: 'automations',
  // Phase 8 M5 — Email Agent engine.
  //  - enroll: kick off initial outreach for a fresh EmailAgentEnrollment.
  //  - followupTick (repeatable, 60s): find due follow-ups, fan out.
  //  - processReply: classify + draft reply for an inbound EmailAgentMessage.
  emailAgent: 'email-agent',
  // Phase 5 M4 — G-Suite lifecycle events (subscription / suspension /
  // delete). One queue for both real-webhook ingestion and admin-side
  // mock fires; the worker can't tell the difference.
  gsuiteWebhooks: 'gsuite-webhooks',
  // Phase 5 M4 — tenant data purge (destructive, requires confirmation
  // and revokes external connections in order before DB row deletes).
  tenantPurge: 'tenant-purge',
  // Phase 4 — WhatsApp Business background jobs
  waPhoneRefresh: 'wa-phone-refresh',
  waTemplateSync: 'wa-template-sync',
  waSends: 'wa-sends',
  waPollStatus: 'wa-poll-status',
  waWebhooks: 'wa-webhooks',
  waPollInbound: 'wa-poll-inbound',
  // Phase 7.1 — agent attachment ingest pipeline. CPU-bound
  // (sharp, pdf-parse, xlsx) so a separate queue keeps it from
  // blocking agent-turn jobs / send fan-outs.
  attachmentParse: 'attachment-parse',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// -----------------------------------------------------------------------------
// Job payload schemas
// -----------------------------------------------------------------------------

/**
 * Payload for the `imports` queue. The web app enqueues one job per ImportJob
 * row once the user finishes the wizard and confirms. The worker streams the
 * CSV from Supabase Storage, batches rows, upserts contacts, and reports
 * progress back to the ImportJob row.
 *
 * The payload is deliberately minimal — everything else (mapping, tagIds,
 * dedupe strategy, etc.) lives on the `ImportJob` row. This keeps Redis
 * payloads small and lets us change job settings without re-enqueuing.
 */
export const importJobPayloadSchema = z.object({
  importJobId: cuidSchema,
  tenantId: cuidSchema,
});
export type ImportJobPayload = z.infer<typeof importJobPayloadSchema>;

/**
 * Payloads for the `sends` queue (Phase 3 M6).
 *
 * `prepare-campaign` runs once per campaign — resolves the segment, filters
 * by suppression, materializes CampaignSend rows, and enqueues
 * `dispatch-batch` jobs in chunks of 500.
 */
export const prepareCampaignPayloadSchema = z.object({
  campaignId: cuidSchema,
  tenantId: cuidSchema,
});
export type PrepareCampaignPayload = z.infer<
  typeof prepareCampaignPayloadSchema
>;

/**
 * `dispatch-batch` runs once per chunk of recipients. Each job receives up
 * to 500 (campaignSendId, contactId, email) tuples. The worker renders the
 * per-recipient HTML, calls Resend, updates CampaignSend status, emits
 * CampaignEvent and ContactEvent.
 */
export const dispatchBatchPayloadSchema = z.object({
  campaignId: cuidSchema,
  tenantId: cuidSchema,
  /** A/B variant for this batch — null when the campaign isn't an A/B test. */
  abVariant: z.enum(['A', 'B']).nullable().default(null),
  sendIds: z.array(cuidSchema).min(1).max(500),
});
export type DispatchBatchPayload = z.infer<typeof dispatchBatchPayloadSchema>;

/**
 * `evaluate-ab` runs as a single delayed job per A/B campaign. After the
 * test cohort has been sending for `winnerDecisionAfterMinutes`, this job
 * picks the winner by metric (open_rate or click_rate) and releases the
 * held-back cohort with the winning variant.
 */
export const evaluateAbPayloadSchema = z.object({
  campaignId: cuidSchema,
  tenantId: cuidSchema,
});
export type EvaluateAbPayload = z.infer<typeof evaluateAbPayloadSchema>;

/**
 * Payload for the `webhooks` queue (Phase 3 M7).
 *
 * The web's /api/webhooks/resend route verifies the signature and immediately
 * enqueues the parsed event so the worker can process it asynchronously.
 * That keeps webhook responses fast (<100ms) regardless of DB load.
 */
export const resendWebhookPayloadSchema = z.object({
  tenantId: cuidSchema.optional(),
  eventType: z.string(),
  messageId: z.string(),
  payload: z.record(z.unknown()),
  receivedAt: z.string().datetime(),
});
export type ResendWebhookPayload = z.infer<typeof resendWebhookPayloadSchema>;

/**
 * Payload for the `inbound-emails` queue (Phase 8 M1).
 *
 * The web's /api/webhooks/inbound-email route verifies the provider
 * signature, persists an InboundEmail row with matchedTo=UNMATCHED,
 * and enqueues this id for the worker to do token-routing off the
 * request path.
 *
 * A single-column id is enough — the worker re-reads the row to see
 * the raw payload + toAddress + fromAddress and does the routing
 * decision there. Keeps Redis payload small and lets us re-run
 * routing on the same row (e.g. after fixing a bug) without
 * re-uploading the payload.
 */
export const inboundEmailProcessPayloadSchema = z.object({
  inboundEmailId: cuidSchema,
});
export type InboundEmailProcessPayload = z.infer<
  typeof inboundEmailProcessPayloadSchema
>;

// -----------------------------------------------------------------
// Phase 8 M3 — Drip automation engine
// -----------------------------------------------------------------

/**
 * `automation-tick` — the repeatable heartbeat. No payload: it
 * always scans everyone's due-and-active enrollments. Set as a
 * BullMQ repeatable job every 60s.
 */
export const automationTickPayloadSchema = z.object({});
export type AutomationTickPayload = z.infer<typeof automationTickPayloadSchema>;

/**
 * `automation-step` — process one enrollment's current node. Split
 * from the tick so failure of one enrollment doesn't stall the
 * batch.
 */
export const automationStepPayloadSchema = z.object({
  enrollmentId: cuidSchema,
  tenantId: cuidSchema,
});
export type AutomationStepPayload = z.infer<typeof automationStepPayloadSchema>;

/**
 * `automation-wake-node` — fired when a message node flips
 * DRAFT→LIVE. Wakes every enrollment paused at that node so the
 * next tick processes them.
 */
export const automationWakePayloadSchema = z.object({
  automationId: cuidSchema,
  nodeId: z.string().min(1).max(64),
  tenantId: cuidSchema,
});
export type AutomationWakePayload = z.infer<typeof automationWakePayloadSchema>;

// -----------------------------------------------------------------
// Phase 8 M5 — Email Agent engine
// -----------------------------------------------------------------

/**
 * `email-agent-enroll` — draft + send the initial outreach for one
 * enrollment, schedule its first follow-up. Fired by
 * emailAgent.enroll / activate mutations.
 */
export const emailAgentEnrollPayloadSchema = z.object({
  enrollmentId: cuidSchema,
  tenantId: cuidSchema,
});
export type EmailAgentEnrollPayload = z.infer<
  typeof emailAgentEnrollPayloadSchema
>;

/**
 * `email-agent-followup-tick` — repeatable heartbeat, no payload.
 * Scans due enrollments and fires per-enrollment step jobs. Split
 * from step so a slow LLM call on one enrollment doesn't block
 * others in the batch.
 */
export const emailAgentFollowupTickPayloadSchema = z.object({});
export type EmailAgentFollowupTickPayload = z.infer<
  typeof emailAgentFollowupTickPayloadSchema
>;

/**
 * `email-agent-process-reply` — Haiku classifies, Sonnet drafts.
 * Fired by the M1 inbound-email worker when a reply matches an
 * EmailAgentEnrollment.
 */
export const emailAgentProcessReplyPayloadSchema = z.object({
  inboundEmailId: cuidSchema,
  enrollmentId: cuidSchema,
  tenantId: cuidSchema,
});
export type EmailAgentProcessReplyPayload = z.infer<
  typeof emailAgentProcessReplyPayloadSchema
>;

/**
 * `email-agent-ingest-knowledge-source` — extract + summarize one
 * EmailAgentKnowledgeSource row. Enqueued when a URL / FILE source
 * is created and when the operator hits Refresh on a URL row.
 */
export const emailAgentIngestKnowledgeSourcePayloadSchema = z.object({
  knowledgeSourceId: cuidSchema,
  tenantId: cuidSchema,
});
export type EmailAgentIngestKnowledgeSourcePayload = z.infer<
  typeof emailAgentIngestKnowledgeSourcePayloadSchema
>;

// -----------------------------------------------------------------------------
// Job name registry per queue. Keeps BullMQ's `name` field strongly typed on
// both sides of the wire.
// -----------------------------------------------------------------------------

export const JOB_NAMES = {
  // Phase 5 M4
  gsuiteWebhooks: {
    process: 'process-gsuite-event',
  },
  tenantPurge: {
    purge: 'purge-tenant',
  },
  imports: {
    processImport: 'processImport',
  },
  sends: {
    prepareCampaign: 'prepare-campaign',
    dispatchBatch: 'dispatch-batch',
    evaluateAb: 'evaluate-ab',
  },
  webhooks: {
    processResendEvent: 'process-resend-event',
  },
  inboundEmails: {
    process: 'process-inbound-email',
  },
  // Phase 8 M3
  automations: {
    tick: 'automation-tick',
    step: 'automation-step',
    wake: 'automation-wake-node',
  },
  // Phase 8 M5
  emailAgent: {
    enroll: 'email-agent-enroll',
    followupTick: 'email-agent-followup-tick',
    processReply: 'email-agent-process-reply',
    // Phase 8 M6 — pull URL / file content into
    // EmailAgentKnowledgeSource.extractedText + summarize with Haiku.
    ingestKnowledgeSource: 'email-agent-ingest-knowledge-source',
  },
  // Phase 4 — WhatsApp Business
  waPhoneRefresh: {
    refreshWaba: 'refresh-waba',
  },
  waTemplateSync: {
    tick: 'tick',
    syncWaba: 'sync-waba',
    pollSubmission: 'poll-submission',
  },
  waSends: {
    prepareCampaign: 'prepare-wa-campaign',
    dispatchBatch: 'dispatch-wa-batch',
    dispatchSingle: 'dispatch-wa-single', // free-form inbox replies
    resumeAfterTier: 'resume-after-tier', // re-enqueue prep when tier window resets
  },
  waPollStatus: {
    tick: 'tick',
    pollCampaign: 'poll-campaign',
  },
  waWebhooks: {
    process: 'process-wa-event',
  },
  waPollInbound: {
    tick: 'tick',
    pollWaba: 'poll-waba',
  },
  // Phase 7.1
  attachmentParse: {
    parse: 'parse-attachment',
  },
} as const;

/**
 * Payload for the wa-phone-refresh queue (Phase 4 M4).
 *
 * Runs once per connected WABA every 6 hours. Pulls latest tier /
 * quality / 24h-window data from Meta and updates the local
 * WhatsAppPhoneNumber rows. Errors are logged + skipped — Meta API
 * blips must not flag a tenant's WABA as broken.
 */
export const refreshWabaPayloadSchema = z.object({
  whatsAppAccountId: cuidSchema,
  tenantId: cuidSchema,
});
export type RefreshWabaPayload = z.infer<typeof refreshWabaPayloadSchema>;

/**
 * Payloads for the wa-template-sync queue (Phase 4 M5).
 *
 * `sync-waba` — pulls every template from Meta for one WABA. Reconciles
 * against local rows: matches by (name, language) when metaTemplateId
 * is missing locally, updates status / rejectionReason / quality on
 * existing rows, creates rows for templates Meta has that we don't.
 *
 * `poll-submission` — short-lived per-template poll triggered after a
 * tenant submits a template. Tries 10 times over ~5 min for fast feedback;
 * falls back to the hourly tick after.
 */
export const syncWabaTemplatesPayloadSchema = z.object({
  whatsAppAccountId: cuidSchema,
  tenantId: cuidSchema,
});
export type SyncWabaTemplatesPayload = z.infer<
  typeof syncWabaTemplatesPayloadSchema
>;

export const pollTemplateSubmissionPayloadSchema = z.object({
  templateId: cuidSchema,
  tenantId: cuidSchema,
  /** 0..9 — kill the chain after 10 attempts. */
  attempt: z.number().int().min(0).max(9),
});
export type PollTemplateSubmissionPayload = z.infer<
  typeof pollTemplateSubmissionPayloadSchema
>;

/**
 * Payloads for the wa-sends queue (Phase 4 M8).
 *
 * `prepare-wa-campaign` — runs once per WhatsApp campaign. Resolves
 * the segment, filters out non-SUBSCRIBED whatsappStatus + WHATSAPP
 * suppression entries, validates each contact has an E.164 phone,
 * pre-flights the WABA / phone / template, materialises (contactId,
 * phone) tuples, creates WhatsAppCampaignSend rows in QUEUED status,
 * fans out `dispatch-wa-batch` in chunks of 100 (smaller than email
 * batches because Meta's per-second rate limits are tighter).
 *
 * `dispatch-wa-batch` — receives ≤100 send tuples; renders template
 * variables per recipient and POSTs to Meta. On per-phone tier limit
 * exhaustion mid-batch, the campaign pauses and `resume-after-tier`
 * is scheduled to re-enqueue prep at the next tier-window reset.
 *
 * `dispatch-wa-single` — free-form inbox replies (M10 hook). Same
 * code path as dispatch-wa-batch but for a single message.
 */
export const prepareWaCampaignPayloadSchema = z.object({
  campaignId: cuidSchema,
  tenantId: cuidSchema,
});
export type PrepareWaCampaignPayload = z.infer<
  typeof prepareWaCampaignPayloadSchema
>;

export const dispatchWaBatchPayloadSchema = z.object({
  campaignId: cuidSchema,
  tenantId: cuidSchema,
  /** Send rows already materialised in WhatsAppCampaignSend (QUEUED). */
  sendIds: z.array(cuidSchema).min(1).max(100),
});
export type DispatchWaBatchPayload = z.infer<
  typeof dispatchWaBatchPayloadSchema
>;

export const dispatchWaSinglePayloadSchema = z.object({
  tenantId: cuidSchema,
  conversationId: cuidSchema,
  /** WhatsAppMessage row id created in OUTBOUND/QUEUED state. */
  messageId: cuidSchema,
});
export type DispatchWaSinglePayload = z.infer<
  typeof dispatchWaSinglePayloadSchema
>;

export const resumeAfterTierPayloadSchema = z.object({
  campaignId: cuidSchema,
  tenantId: cuidSchema,
});
export type ResumeAfterTierPayload = z.infer<
  typeof resumeAfterTierPayloadSchema
>;

/**
 * Payloads for the wa-poll-status queue (Phase 4 M8).
 *
 * `tick` (cron, every 2 min): finds active WhatsApp campaigns
 * (sent within the last 72h with non-terminal sends) and fans out
 * `poll-campaign`.
 *
 * `poll-campaign`: pulls Meta status for non-terminal sends in the
 * given campaign and updates DELIVERED / READ / FAILED transitions.
 */
export const pollCampaignPayloadSchema = z.object({
  campaignId: cuidSchema,
  tenantId: cuidSchema,
});
export type PollCampaignPayload = z.infer<typeof pollCampaignPayloadSchema>;

/**
 * Payload for the wa-webhooks queue (Phase 4 M9).
 *
 * The /api/webhooks/whatsapp/[appId] receiver verifies the
 * X-Hub-Signature-256 header, persists the raw event to
 * WhatsAppWebhookEvent (with a deterministic dedupeKey for
 * idempotency), and enqueues this payload. The worker then
 * dispatches to inbound / status / template-status / quality
 * branches based on payload contents.
 */
export const waWebhookProcessPayloadSchema = z.object({
  webhookEventId: cuidSchema,
});
export type WaWebhookProcessPayload = z.infer<
  typeof waWebhookProcessPayloadSchema
>;

// ----------------------------------------------------------------------------
// Phase 5 M4 — G-Suite lifecycle ingestion
// ----------------------------------------------------------------------------

/**
 * Set of G-Suite event types we react to. Mirrors the kickoff M3
 * contract assumptions (`subscription.updated` / `subscription.canceled`
 * / `tenant.suspended` / `tenant.reactivated` / `tenant.deleted`).
 * Until the G-Suite team confirms the spec, the dispatcher reads any
 * eventType but only the known set has reactions; unknown types
 * persist + audit but no-op.
 */
export const gsuiteEventTypeSchema = z.enum([
  'subscription.updated',
  'subscription.canceled',
  'tenant.suspended',
  'tenant.reactivated',
  'tenant.deleted',
]);
export type GsuiteEventType = z.infer<typeof gsuiteEventTypeSchema>;

/**
 * Worker payload for processing a single G-Suite event row. The
 * webhook receiver persists the raw payload to GSuiteWebhookEvent
 * (idempotent on gSuiteEventId) and enqueues this id. The worker
 * reads the row, dispatches by eventType, stamps processedAt.
 */
export const gsuiteWebhookPayloadSchema = z.object({
  webhookEventId: cuidSchema,
});
export type GsuiteWebhookPayload = z.infer<typeof gsuiteWebhookPayloadSchema>;

/**
 * Tenant purge payload. Deliberately requires a non-trivial
 * confirmation token (the deleteConfirmedAt timestamp from G-Suite
 * OR a staff override) — guards against accidentally enqueuing a
 * purge from misrouted code paths.
 */
export const tenantPurgePayloadSchema = z.object({
  tenantId: cuidSchema,
  /** ISO timestamp from G-Suite's confirmation OR staff-issued audit ref. */
  deleteConfirmedAt: z.string().datetime(),
  /** Which path triggered: 'gsuite' (webhook) or 'grace_expired' (cron). */
  trigger: z.enum(['gsuite', 'grace_expired', 'staff_force']),
});
export type TenantPurgePayload = z.infer<typeof tenantPurgePayloadSchema>;

/**
 * Payload for `attachment-parse` (Phase 7.1).
 *
 * The web's upload route creates the AgentAttachment row + uploads
 * the binary to Storage synchronously, then enqueues one of these so
 * parsing + AI-summarization happen off the request path.
 */
export const attachmentParsePayloadSchema = z.object({
  agentAttachmentId: cuidSchema,
  tenantId: cuidSchema,
});
export type AttachmentParsePayload = z.infer<
  typeof attachmentParsePayloadSchema
>;
