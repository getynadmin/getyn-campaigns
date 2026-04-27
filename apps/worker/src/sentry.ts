/**
 * Sentry — worker process (Phase 4 M0).
 *
 * Imported FIRST in src/index.ts so init runs before any handler can
 * throw. No-op when SENTRY_DSN_WORKER is unset (local dev).
 *
 * Every captured event gets `runtime: 'worker'` so we can filter
 * worker errors apart from web errors in Sentry. Per-job tags
 * (queue, jobName, tenantId) are attached at capture time in index.ts.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN_WORKER;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    initialScope: { tags: { runtime: 'worker' } },
  });
  console.info('[worker] sentry initialised');
} else {
  console.info('[worker] SENTRY_DSN_WORKER unset — sentry disabled');
}

export { Sentry };
