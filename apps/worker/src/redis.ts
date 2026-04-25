import { Redis } from 'ioredis';

/**
 * Build an ioredis connection for BullMQ. BullMQ's `Worker` class requires
 * `maxRetriesPerRequest: null` so pending jobs aren't silently dropped on
 * connection blips. For Upstash specifically, `enableReadyCheck: false` is
 * also recommended because the ready check uses CLUSTER commands that
 * Upstash's proxy doesn't expose.
 *
 * We accept either `redis://` or `rediss://` URLs — Upstash uses `rediss://`
 * for TLS. Local dev with `brew install redis` uses the non-TLS variant.
 */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
