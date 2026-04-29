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
  // Phase 4 — WhatsApp Business background jobs
  waPhoneRefresh: 'wa-phone-refresh',
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

// -----------------------------------------------------------------------------
// Job name registry per queue. Keeps BullMQ's `name` field strongly typed on
// both sides of the wire.
// -----------------------------------------------------------------------------

export const JOB_NAMES = {
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
  // Phase 4 — WhatsApp Business
  waPhoneRefresh: {
    refreshWaba: 'refresh-waba',
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
