/**
 * Next.js instrumentation hook (Phase 4 M0).
 *
 * Runs once per server runtime on boot. We branch on `NEXT_RUNTIME`
 * because the Node and Edge SDKs have different module shapes —
 * importing the wrong one in the wrong runtime crashes the bundle.
 *
 * The actual `Sentry.init` calls live in sentry.server.config.ts /
 * sentry.edge.config.ts so the boot sequence stays declarative.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
