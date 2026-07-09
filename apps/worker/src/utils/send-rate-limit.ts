/* eslint-disable no-console */
/**
 * Global outbound email rate limiter.
 *
 * Reads the cap from the `resend` IntegrationCredential row (falls
 * back to SEND_RATE_PER_HOUR env). Uses Redis INCR + TTL on a
 * per-hour bucket so all worker replicas share the same counter.
 *
 * Contract:
 *   const proceed = await claimSendSlot();
 *   if (!proceed) { …skip or reschedule… }
 *
 * When the current-hour bucket is at cap, `claimSendSlot` sleeps
 * until the top of the next hour (max 65 minutes) and then retries.
 * Callers therefore never see a `false` return today; the boolean
 * is reserved for future changes that let callers opt out of the
 * wait.
 *
 * Applied by:
 *   - apps/worker/src/handlers/sends.ts        (campaign dispatch)
 *   - apps/worker/src/handlers/automation.ts   (drip Email node)
 *   - apps/worker/src/handlers/email-agent.ts  (initial + follow-up)
 *
 * Not applied to email-agent-inbox approvals (single-shot operator
 * clicks — no throttle needed).
 */
import { Redis } from 'ioredis';

import { prisma, type Prisma } from '@getyn/db';
import { decrypt, type EncryptedField } from '@getyn/crypto';

import { createRedisConnection } from '../redis';

const CACHE_TTL_MS = 30_000;
const MAX_WAIT_MS = 65 * 60 * 1000; // absolute upper bound

let cached: { rate: number; perSecond: number; expiresAt: number } | null = null;
const DEFAULT_PER_SECOND = 2; // Resend free tier
let redisSingleton: Redis | null = null;

function asEnvelope(value: Prisma.JsonValue | null): EncryptedField | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (
    typeof o.ciphertext !== 'string' ||
    typeof o.iv !== 'string' ||
    typeof o.authTag !== 'string' ||
    typeof o.keyVersion !== 'number'
  ) {
    return null;
  }
  return {
    ciphertext: o.ciphertext,
    iv: o.iv,
    authTag: o.authTag,
    keyVersion: o.keyVersion,
  };
}

/**
 * Resolve the current rate cap (emails / hour). 0 = unlimited.
 * Cached for 30s so a burst of sends doesn't hammer Postgres.
 */
async function loadRates(): Promise<{ rate: number; perSecond: number }> {
  if (cached && cached.expiresAt > Date.now())
    return { rate: cached.rate, perSecond: cached.perSecond };
  let rate = 0;
  let perSecond = DEFAULT_PER_SECOND;
  try {
    const row = await prisma.integrationCredential.findUnique({
      where: { provider: 'resend' },
    });
    if (row?.enabled) {
      const cfg = row.config as {
        sendRatePerHour?: number;
        sendRatePerSecond?: number;
      } | null;
      const dbRate = Number(cfg?.sendRatePerHour ?? 0);
      if (Number.isFinite(dbRate) && dbRate >= 0) rate = dbRate;
      const dbPs = Number(cfg?.sendRatePerSecond ?? DEFAULT_PER_SECOND);
      if (Number.isFinite(dbPs) && dbPs > 0) perSecond = dbPs;
      void asEnvelope(row.secrets);
    }
  } catch (err) {
    console.warn('[send-rate-limit] failed to read config, treating as unlimited', err);
  }
  if (rate === 0) {
    const envRate = Number(process.env.SEND_RATE_PER_HOUR ?? 0);
    if (Number.isFinite(envRate) && envRate > 0) rate = envRate;
  }
  cached = { rate, perSecond, expiresAt: Date.now() + CACHE_TTL_MS };
  return { rate, perSecond };
}

export async function getSendRatePerHour(): Promise<number> {
  return (await loadRates()).rate;
}

/**
 * Force the next getSendRatePerHour() call to hit Postgres again.
 * Called by the admin update mutation via a Redis pub/sub if we ever
 * add cross-service invalidation. For now the 30s cache TTL is fine.
 */
export function invalidateSendRateCache(): void {
  cached = null;
}

function bucketKey(now = new Date()): string {
  // Bucketed on the calendar hour (UTC) so cap resets are predictable
  // for operators eyeballing metrics.
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  return `send_throttle:${y}${m}${d}${h}`;
}

function msUntilNextHour(now = new Date()): number {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - now.getTime();
}

async function getRedis(): Promise<Redis | null> {
  if (redisSingleton) return redisSingleton;
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[send-rate-limit] REDIS_URL missing — skipping throttle');
    return null;
  }
  redisSingleton = createRedisConnection(url);
  return redisSingleton;
}

/**
 * Attempt to claim a slot in the current-hour send bucket. Blocks
 * (up to ~65 minutes) if the bucket is full, then retries.
 *
 * Callers should invoke this immediately before the actual Resend
 * `emails.send` call. Skipping on error is intentional — a Redis
 * blip must not block sends.
 */
export async function claimSendSlot(): Promise<boolean> {
  const { rate, perSecond } = await loadRates();
  const redis = await getRedis();
  if (!redis) return true; // fail-open

  // Per-second gate first (Resend caps at ~2/s on free tier).
  if (perSecond > 0) {
    while (true) {
      const sec = Math.floor(Date.now() / 1000);
      const psKey = `send_throttle_s:${sec}`;
      const c = await redis.incr(psKey);
      if (c === 1) await redis.expire(psKey, 5);
      if (c <= perSecond) break;
      await redis.decr(psKey);
      // Sleep until the next whole second.
      const waitMs = 1000 - (Date.now() % 1000) + 10;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  if (rate === 0) return true; // hourly unlimited

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const key = bucketKey();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600 + 300);
    if (count <= rate) return true;
    const waitMs = Math.min(msUntilNextHour() + 100, 60_000);
    await redis.decr(key);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  console.warn('[send-rate-limit] gave up after MAX_WAIT_MS — sending anyway');
  return true;
}
