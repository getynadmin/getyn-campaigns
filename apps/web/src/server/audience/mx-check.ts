/**
 * MX-record probe for the Email Verifier's Deep Scan.
 *
 * Per-domain, not per-email — 18k contacts typically share 1-3k
 * unique domains, so we de-dupe before issuing any DNS queries.
 *
 * Concurrency: limited to 50 parallel resolutions. Higher saturates
 * the Vercel function's outbound socket pool and most DNS resolvers
 * start dropping/rate-limiting anyway.
 *
 * Per-domain timeout: 4 seconds. Slow resolvers shouldn't stall the
 * whole batch — a timeout on a lookup is treated the same as
 * "unknown" (NOT marked as dead), so a transient DNS hiccup never
 * unsubscribes legitimate contacts.
 *
 * Caches inside a single call only — the worker function is short-
 * lived; an in-memory cache that survives invocations would be
 * stale fast. If users run Deep Scan often we could promote this to
 * Redis with a 24h TTL.
 */
import { resolveMx } from 'node:dns/promises';

export type MxStatus = 'HAS_MX' | 'NO_MX' | 'UNKNOWN';

interface ProbeOptions {
  concurrency?: number;
  timeoutMs?: number;
}

const DEFAULT_CONCURRENCY = 50;
const DEFAULT_TIMEOUT_MS = 4_000;

async function probeOne(
  domain: string,
  timeoutMs: number,
): Promise<MxStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<MxStatus>((resolve) => {
    timer = setTimeout(() => resolve('UNKNOWN'), timeoutMs);
  });
  const lookup = resolveMx(domain).then(
    (records) => (records && records.length > 0 ? 'HAS_MX' : 'NO_MX') as MxStatus,
    (err: NodeJS.ErrnoException) => {
      // ENOTFOUND / ENODATA are "domain has no MX". Anything else
      // (SERVFAIL, TIMEOUT, REFUSED) → UNKNOWN to avoid false
      // positives on flaky DNS.
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
        return 'NO_MX' as MxStatus;
      }
      return 'UNKNOWN' as MxStatus;
    },
  );
  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Probe an arbitrary set of domains. Returns a Map keyed by lowercase
 * domain → MxStatus. Order in / out is not preserved (we resolve in
 * parallel with a bounded pool).
 */
export async function probeMxBulk(
  domains: Iterable<string>,
  opts: ProbeOptions = {},
): Promise<Map<string, MxStatus>> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const queue = Array.from(new Set([...domains].map((d) => d.toLowerCase())));
  const results = new Map<string, MxStatus>();

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const idx = cursor;
      cursor += 1;
      const d = queue[idx];
      if (!d) continue;
      results.set(d, await probeOne(d, timeoutMs));
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
