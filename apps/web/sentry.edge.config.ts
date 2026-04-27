/**
 * Sentry — Edge runtime (middleware, edge route handlers).
 *
 * Same DSN as Node server config; tagged `runtime: 'edge'` so we can
 * tell middleware errors apart from regular server errors.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN_WEB ?? process.env.NEXT_PUBLIC_SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    initialScope: { tags: { runtime: 'edge' } },
  });
}
