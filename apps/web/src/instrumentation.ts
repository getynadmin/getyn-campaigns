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

    // Phase 5 M7 — bootstrap StaffUser from INITIAL_STAFF_EMAILS on
    // every Node-runtime boot. Idempotent (createMany skipDuplicates),
    // safe to run repeatedly. Wrapped in try/catch so a DB blip during
    // boot doesn't crash the web app — a missing staff row only blocks
    // /admin, not the customer surface.
    try {
      const { bootstrapInitialStaff } = await import(
        '@/server/admin/bootstrap'
      );
      const result = await bootstrapInitialStaff();
      if (result.inserted > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[bootstrap] inserted ${result.inserted} StaffUser row(s) (${result.skipped} already existed)`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        '[bootstrap] StaffUser bootstrap failed (non-fatal):',
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
