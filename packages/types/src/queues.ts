import { z } from 'zod';

import { cuidSchema } from './common';

// -----------------------------------------------------------------------------
// Queue names — the single source of truth for BullMQ queue identifiers.
// Both the producer (apps/web) and the consumer (apps/worker) import these,
// so renames are safe across the monorepo.
// -----------------------------------------------------------------------------

export const QUEUE_NAMES = {
  imports: 'imports',
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

// -----------------------------------------------------------------------------
// Job name registry per queue. Keeps BullMQ's `name` field strongly typed on
// both sides of the wire.
// -----------------------------------------------------------------------------

export const JOB_NAMES = {
  imports: {
    processImport: 'processImport',
  },
} as const;
