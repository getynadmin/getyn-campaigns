import 'server-only';

import {
  JOB_NAMES,
  QUEUE_NAMES,
  importJobPayloadSchema,
  type ImportJobPayload,
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
