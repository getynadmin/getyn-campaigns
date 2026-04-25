import { createServer, type Server } from 'node:http';

import { prisma } from '@getyn/db';
import { QUEUE_NAMES } from '@getyn/types';
import { Queue, Worker } from 'bullmq';

import { loadEnv } from './env';
import { handleDailyReset, handleRatesDriftCorrect } from './handlers/cron';
import { handleImportJob } from './handlers/imports';
import { handleSendsJob } from './handlers/sends';
import { createRedisConnection } from './redis';

const env = loadEnv();
const startedAt = Date.now();

/**
 * Dev ergonomics: if REDIS_URL is not set, log a clear message and exit 0.
 * This keeps `pnpm dev` at the monorepo root from crash-looping while a
 * dev is still setting up Upstash — the web app can continue running
 * without the worker (import enqueue will just fail at runtime with a
 * clearer message at that layer).
 *
 * In production `loadEnv()` enforces the variable's presence — we never
 * reach this branch on Railway.
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

// Imports queue — Phase 2's CSV ingestion.
workers.push(
  new Worker(QUEUE_NAMES.imports, handleImportJob, {
    connection,
    concurrency: env.WORKER_IMPORTS_CONCURRENCY,
    // Each job gets a fresh lock that renews every 30s. If the worker
    // crashes mid-job, BullMQ re-queues it after the lock expires.
    lockDuration: 30_000,
  }),
);

// Sends queue — Phase 3 M6's campaign send pipeline.
//
// Three job types share this queue (prepare-campaign / dispatch-batch /
// evaluate-ab) — handleSendsJob dispatches by job.name. Concurrency 4
// means 4 dispatch-batch jobs can run in parallel; each job processes
// up to 500 sends. The bottleneck is Resend's 10 req/s rate limit, which
// we throttle inside the dispatch handler — running more workers
// accelerates queueing but doesn't violate the upstream cap.
workers.push(
  new Worker(QUEUE_NAMES.sends, handleSendsJob, {
    connection,
    concurrency: 4,
    // dispatch-batch can run for several minutes; bump the lock so a
    // slow Resend response doesn't trigger a re-queue.
    lockDuration: 120_000,
  }),
);

// Cron queue — repeatable maintenance jobs.
//
// Two repeatable jobs:
//   1. daily-reset @ 00:00 UTC each day — resets currentDailyCount and
//      resumes campaigns that paused on yesterday's daily cap.
//   2. rates-drift @ top of each hour — recomputes
//      cachedComplaintRate30d / cachedBounceRate30d from raw events
//      so the suspension-decision counters don't drift from the
//      incremental updates the M7 webhook handler does.
//
// addRepeatableJob is idempotent on (queue, name, repeat-key) so
// restarting the worker doesn't pile up duplicates.
const CRON_QUEUE_NAME = 'cron';
const cronQueue = new Queue(CRON_QUEUE_NAME, { connection });

workers.push(
  new Worker(
    CRON_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case 'daily-reset':
          return handleDailyReset();
        case 'rates-drift':
          return handleRatesDriftCorrect();
        default:
          throw new Error(`Unknown cron job: ${job.name}`);
      }
    },
    {
      connection,
      concurrency: 1, // Cron jobs are serialized — never run two daily
                     // resets simultaneously across replicas.
      lockDuration: 600_000, // 10 min — drift-correct can take a while
    },
  ),
);

// Register repeatables on boot. BullMQ deduplicates by (name,
// repeatPattern) so this is safe to call every boot.
async function setupCronJobs(): Promise<void> {
  // 00:00 UTC daily.
  await cronQueue.add(
    'daily-reset',
    {},
    {
      repeat: { pattern: '0 0 * * *', tz: 'UTC' },
      jobId: 'cron:daily-reset',
    },
  );
  // Every hour at :05 (avoid clashing with daily-reset at midnight).
  await cronQueue.add(
    'rates-drift',
    {},
    {
      repeat: { pattern: '5 * * * *', tz: 'UTC' },
      jobId: 'cron:rates-drift',
    },
  );
  console.info('[worker:cron] repeatable jobs registered');
}
void setupCronJobs().catch((err) =>
  console.error('[worker:cron] setup failed:', err),
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
 * Tiny HTTP server for liveness/readiness probes.
 *
 * Railway (and most container hosts) need a TCP listener to consider a
 * service healthy. The worker is otherwise a pure BullMQ consumer with
 * no inbound HTTP — so we expose a single `/health` endpoint that
 * reports redis + worker state. Returns 200 only when redis is `ready`
 * and every BullMQ Worker is running; otherwise 503.
 *
 * Using node:http (not Express/Fastify) keeps the dependency surface
 * small — the worker's deploy artifact stays tight.
 */
const healthServer: Server = createServer((req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    return;
  }

  const redisStatus = connection.status; // 'ready' | 'connecting' | 'reconnecting' | ...
  const queues = workers.map((w) => ({
    name: w.name,
    running: w.isRunning(),
    concurrency: w.opts.concurrency,
  }));
  const allWorkersRunning = queues.every((q) => q.running);
  const ok = redisStatus === 'ready' && allWorkersRunning;

  res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      ok,
      redis: redisStatus,
      queues,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: process.env.npm_package_version ?? 'dev',
    }),
  );
});

healthServer.listen(env.PORT, () => {
  console.info(`[worker] health endpoint listening on :${env.PORT}/health`);
});

/**
 * Graceful shutdown: give in-flight jobs up to 20s to finish, close the
 * health server so the host stops routing new probes, then hard-close
 * Redis + Prisma. Order matters: stop accepting new probes -> close
 * workers -> close transport.
 */
async function shutdown(signal: string): Promise<void> {
  console.info(`[worker] received ${signal}, shutting down...`);
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await Promise.allSettled(workers.map((w) => w.close()));
  await connection.quit();
  await prisma.$disconnect();
  console.info('[worker] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
