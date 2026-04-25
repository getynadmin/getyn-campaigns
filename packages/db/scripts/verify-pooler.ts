/* eslint-disable no-console */
/**
 * Milestone 1 smoke test: verify the pooled DATABASE_URL works AND that our
 * transaction-local `app.current_tenant_id` pattern survives pgBouncer
 * transaction-mode pooling.
 *
 * Run:  pnpm tsx scripts/verify-pooler.ts
 */
import { PrismaClient } from '@prisma/client';

// Run with: tsx --env-file=../../.env.local scripts/verify-pooler.ts
const url = process.env.DATABASE_URL ?? '';
const host = url.match(/@([^:/]+)/)?.[1] ?? '?';
const port = url.match(/:(\d+)\//)?.[1] ?? '?';
console.log(`[verify-pooler] connecting via ${host}:${port}`);

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  // 1. Basic connectivity
  const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
  if (rows[0]?.ok !== 1) throw new Error('SELECT 1 did not return 1');
  console.log('[verify-pooler] ✓ basic SELECT 1 works');

  // 2. Transaction-local session var pattern (mirrors withTenant)
  const tenantCount = await prisma.$transaction(async (tx) => {
    // Fetch any existing tenant so we have a real id
    const t = await tx.tenant.findFirst({ select: { id: true } });
    if (!t) {
      console.log('[verify-pooler] ⚠ no tenants in DB yet — skipping RLS check');
      return -1;
    }
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      t.id,
    );
    // RLS-scoped query. Should return exactly 1 tenant (the current one).
    const rows = await tx.tenant.findMany({ select: { id: true } });
    return rows.length;
  });

  if (tenantCount === 1) {
    console.log('[verify-pooler] ✓ RLS + transaction-local session var work through the pooler');
  } else if (tenantCount === -1) {
    console.log('[verify-pooler] (no tenant data — only connectivity was verified)');
  } else {
    throw new Error(
      `RLS leak: set app.current_tenant_id but got ${tenantCount} tenants back (expected 1)`,
    );
  }

  // 3. Verify the session var does NOT leak across transactions on the same
  //    pooled connection. Without `set_config(..., true)` bleeding, a fresh
  //    transaction should see an empty/null current_tenant_id.
  const leaked = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ val: string | null }[]>`
      SELECT current_setting('app.current_tenant_id', true) AS val
    `;
    return rows[0]?.val ?? null;
  });
  if (leaked === null || leaked === '') {
    console.log('[verify-pooler] ✓ session var does not bleed across transactions');
  } else {
    throw new Error(
      `Session var leaked to a new transaction: got "${leaked}" (expected null/empty)`,
    );
  }

  console.log('[verify-pooler] ALL CHECKS PASSED');
}

main()
  .catch((e) => {
    console.error('[verify-pooler] FAIL:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
