/**
 * Sentry — browser bundle.
 *
 * Phase 4 M0. Picks up SENTRY_DSN_WEB at build time (Next inlines
 * NEXT_PUBLIC_* at build; we expose the DSN as NEXT_PUBLIC_SENTRY_DSN_WEB
 * so it lands in the client bundle). If the DSN is unset, the SDK is a
 * no-op — keeps local dev clean.
 *
 * Tags every event with `runtime: 'browser'`. Server + edge configs
 * tag differently so we can filter by where the error occurred.
 *
 * Sample rates kept conservative for MVP — bump once we have volume.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    initialScope: { tags: { runtime: 'browser' } },
  });
}
