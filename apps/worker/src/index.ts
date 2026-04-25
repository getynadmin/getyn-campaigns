import { createServer, type Server } from 'node:http';

import { prisma } from '@getyn/db';
import { QUEUE_NAMES } from '@getyn/types';
import { Worker } from 'bullmq';

import { loadEnv } from './env';
import { handleImportJob } from './handlers/imports';
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

// Imports queue — Phase 2's CSV ingestion. Phase 3 M6 will add `sends` and
// `webhooks` queues alongside this one.
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
