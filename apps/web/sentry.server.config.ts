/**
 * Sentry — Node.js server runtime (route handlers, RSC, server actions).
 *
 * Reads SENTRY_DSN_WEB (server-side, no NEXT_PUBLIC_ needed). No-op when unset.
 *
 * `tracesSampleRate: 0.1` samples 10% of requests for perf — we mostly care
 * about errors here, not perf telemetry. Bump if we want flame graphs.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN_WEB ?? process.env.NEXT_PUBLIC_SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    initialScope: { tags: { runtime: 'node' } },
  });
}
