/* eslint-disable no-console */
/**
 * End-to-end RLS verification for Phase 2 tables.
 *
 *   Run:  tsx --env-file=../../.env.local scripts/verify-rls.ts
 *
 * The DATABASE_URL we use in development connects as `postgres`, which is a
 * Supabase superuser with BYPASSRLS. That role always skips RLS regardless
 * of `FORCE ROW LEVEL SECURITY`, so we can't use it directly to verify policies
 * fire. This script opens a transaction and `SET LOCAL ROLE authenticated` so
 * queries run as Supabase's built-in unprivileged role — which respects RLS.
 *
 * What we check per Phase 2 table (Contact, Tag, ContactTag, CustomField,
 * Segment, ImportJob, SuppressionEntry, ContactEvent):
 *
 *   1. Without setting `app.current_tenant_id`, SELECT returns 0 rows
 *      (policy denies). This is the "missing withTenant()" safety check.
 *   2. With a valid tenant id set, SELECT returns only that tenant's rows.
 *   3. For the two tenant-scoped rows we create in a second throwaway tenant,
 *      reading them back under the first tenant's scope returns 0 rows.
 *   4. Attempting to INSERT a Contact whose `tenantId` doesn't match the
 *      session tenant id fails the WITH CHECK clause.
 *
 * Anything that doesn't behave as expected throws — the script exits non-zero.
 */
import { PrismaClient } from '@prisma/client';

// `log: []` silences the expected error Prisma prints when we deliberately
// exercise the cross-tenant INSERT check — RLS denials surface as `42501` in
// the rejected promise, which is what we want to observe.
const prisma = new PrismaClient({ log: [] });

type Check = { name: string; run: () => Promise<void> };

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function withAuthenticatedTx<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  tenantId: string | null,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Drop to the unprivileged role so FORCE RLS actually applies.
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
    if (tenantId) {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        tenantId,
      );
    }
    return fn(tx);
  });
}

async function main(): Promise<void> {
  console.info('[verify-rls] starting…');

  // We need the seed's Acme tenant id (bypass RLS here — we're the superuser).
  const acme = await prisma.tenant.findUnique({ where: { slug: 'acme' } });
  if (!acme) {
    throw new Error(
      'No tenant with slug "acme" found. Run `pnpm db:seed` first.',
    );
  }
  console.info(`[verify-rls] using seed tenant: ${acme.name} (${acme.id})`);

  // Spin up a throwaway second tenant with a minimal cross-tenant footprint
  // so we can prove one tenant's rows don't leak into the other's scope.
  // Uses a stable id so re-runs are idempotent.
  const otherTenantId = `seed-verify-tenant-${acme.id.slice(0, 8)}`;
  const otherTenant = await prisma.tenant.upsert({
    where: { id: otherTenantId },
    update: {},
    create: {
      id: otherTenantId,
      slug: `verify-${acme.id.slice(0, 8)}`,
      name: 'RLS Verify Tenant',
    },
  });
  const otherContactId = `seed-verify-contact-${acme.id.slice(0, 8)}`;
  await prisma.contact.upsert({
    where: { id: otherContactId },
    update: {},
    create: {
      id: otherContactId,
      tenantId: otherTenant.id,
      email: `rls-probe-${acme.id.slice(0, 8)}@example.com`,
      firstName: 'RLS',
      lastName: 'Probe',
    },
  });

  const checks: Check[] = [
    {
      name: 'Contact: no tenant set → 0 rows',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.contact.count(),
          null,
        );
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
    {
      name: 'Contact: acme scope → 50 rows (seed)',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.contact.count(),
          acme.id,
        );
        assert(count === 50, `expected 50 but got ${count}`);
      },
    },
    {
      name: 'Contact: acme scope cannot see other tenant\'s probe contact',
      run: async () => {
        const found = await withAuthenticatedTx(
          (tx) => tx.contact.findUnique({ where: { id: otherContactId } }),
          acme.id,
        );
        assert(found === null, `expected null but got ${JSON.stringify(found)}`);
      },
    },
    {
      name: 'Contact: other-tenant scope sees exactly 1 row',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.contact.count(),
          otherTenant.id,
        );
        assert(count === 1, `expected 1 but got ${count}`);
      },
    },
    {
      name: 'Contact: INSERT with wrong tenantId fails WITH CHECK',
      run: async () => {
        let threw = false;
        try {
          await withAuthenticatedTx(
            (tx) =>
              tx.contact.create({
                data: {
                  // pretend to be acme, but try to write into the other tenant
                  tenantId: otherTenant.id,
                  email: 'cross-tenant-write@example.com',
                },
              }),
            acme.id,
          );
        } catch {
          threw = true;
        }
        assert(threw, 'cross-tenant insert should have been blocked by WITH CHECK');
      },
    },
    {
      name: 'Tag: no tenant set → 0 rows',
      run: async () => {
        const count = await withAuthenticatedTx((tx) => tx.tag.count(), null);
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
    {
      name: 'Tag: acme scope → 5 rows (seed)',
      run: async () => {
        const count = await withAuthenticatedTx((tx) => tx.tag.count(), acme.id);
        assert(count === 5, `expected 5 but got ${count}`);
      },
    },
    {
      name: 'CustomField: no tenant set → 0 rows',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.customField.count(),
          null,
        );
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
    {
      name: 'CustomField: acme scope → 2 rows (seed)',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.customField.count(),
          acme.id,
        );
        assert(count === 2, `expected 2 but got ${count}`);
      },
    },
    {
      name: 'Segment: no tenant set → 0 rows',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.segment.count(),
          null,
        );
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
    {
      name: 'Segment: acme scope → 2 rows (seed)',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.segment.count(),
          acme.id,
        );
        assert(count === 2, `expected 2 but got ${count}`);
      },
    },
    {
      name: 'ContactEvent: no tenant set → 0 rows',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.contactEvent.count(),
          null,
        );
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
    {
      name: 'ContactEvent: acme scope sees 88 rows (seed backfill)',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.contactEvent.count(),
          acme.id,
        );
        assert(count === 88, `expected 88 but got ${count}`);
      },
    },
    {
      name: 'ContactTag: no tenant set → 0 rows (gated via Contact EXISTS)',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.contactTag.count(),
          null,
        );
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
    {
      name: 'ContactTag: acme scope sees its links only',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.contactTag.count(),
          acme.id,
        );
        // 30 single tags + 8 double-tags where (i % 4 === 0) for i in [0..29]
        // => 8 extra links (i=0,4,8,12,16,20,24,28 when tag2 !== tag)
        // Seed uses pick(tags, i+2) — tag2 !== tag in all 8 cases, so 30 + 8 = 38.
        assert(count === 38, `expected 38 but got ${count}`);
      },
    },
    {
      name: 'SuppressionEntry: no tenant set → 0 rows',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.suppressionEntry.count(),
          null,
        );
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
    {
      name: 'ImportJob: no tenant set → 0 rows',
      run: async () => {
        const count = await withAuthenticatedTx(
          (tx) => tx.importJob.count(),
          null,
        );
        assert(count === 0, `expected 0 but got ${count}`);
      },
    },
  ];

  let failed = 0;
  for (const check of checks) {
    try {
      await check.run();
      console.info(`  ✓ ${check.name}`);
    } catch (err) {
      failed++;
      console.error(
        `  ✗ ${check.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (failed > 0) {
    console.error(`\n[verify-rls] FAIL: ${failed} of ${checks.length} checks failed`);
    process.exit(1);
  }
  console.info(`\n[verify-rls] ✅ all ${checks.length} checks passed`);
}

main()
  .catch((err) => {
    console.error('[verify-rls] FAIL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
