import { prisma } from '@getyn/db';
import { QUEUE_NAMES } from '@getyn/types';
import { Worker } from 'bullmq';

import { loadEnv } from './env';
import { handleImportJob } from './handlers/imports';
import { createRedisConnection } from './redis';

const env = loadEnv();

/**
 * Dev ergonomics: if REDIS_URL is not set, log a clear message and exit 0.
 * This keeps `pnpm dev` at the monorepo root from crash-looping while a
 * dev is still setting up Upstash — the web app can continue running
 * without the worker (import enqueue will just fail at runtime with a
 * clearer message at that layer).
 */
if (!env.REDIS_URL) {
  console.warn(
    '[worker] REDIS_URL not set — worker will not start. Set it in .env.local (Upstash recommended, see README).',
  );
  process.exit(0);
}

const connection = createRedisConnection(env.REDIS_URL);

connection.on('connect', () => console.info('[worker] redis connected'));
connection.on('error', (err) => console.error('[worker] redis error:', err.message));

const workers: Worker[] = [];

// Imports queue
workers.push(
  new Worker(QUEUE_NAMES.imports, handleImportJob, {
    connection,
    concurrency: env.WORKER_IMPORTS_CONCURRENCY,
    // Each job gets a fresh lock that renews every 30s. If the worker
    // crashes mid-job, BullMQ re-queues it after the lock expires.
    lockDuration: 30_000,
  }),
);

for (const worker of workers) {
  worker.on('ready', () =>
    console.info(`[worker:${worker.name}] ready (concurrency=${worker.opts.concurrency})`),
  );
  worker.on('failed', (job, err) =>
    console.error(`[worker:${worker.name}] job ${job?.id} failed:`, err.message),
  );
  worker.on('completed', (job) =>
    console.info(`[worker:${worker.name}] job ${job.id} completed`),
  );
}

/**
 * Graceful shutdown: give in-flight jobs up to 20s to finish before
 * hard-closing the Redis connection and the Prisma pool.
 */
async function shutdown(signal: string): Promise<void> {
  console.info(`[worker] received ${signal}, shutting down...`);
  await Promise.allSettled(workers.map((w) => w.close()));
  await connection.quit();
  await prisma.$disconnect();
  console.info('[worker] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
