/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src';

/**
 * Re-applies the RLS + partial-index SQL against the current database.
 *
 * `prisma db push` (the Phase 1 dev workflow) does not execute files in the
 * `migrations/` folder, so raw SQL (RLS policies, partial unique indexes on
 * Contact) would never get installed. `pnpm db:push` invokes this afterwards,
 * and it's also runnable standalone via `pnpm db:rls` against a fresh database.
 *
 * What we re-apply:
 *   - `0001_rls/migration.sql`                       → Phase 1 policies
 *   - tail of `0002_phase2_audience/migration.sql`   → Phase 2 partial indexes
 *                                                     + policies
 *   - tail of `0003_phase3_email/migration.sql`      → Phase 3 RLS policies +
 *                                                     TenantSendingPolicy backfill
 *                                                     + renderedHtml immutability trigger
 *
 * The 0002 / 0003 files start with CREATE TABLE / ADD CONSTRAINT statements
 * (produced by `prisma migrate diff`) which are NOT idempotent — re-running
 * them blows up on "relation already exists". So we only re-apply the portion
 * after the marker `-- Partial unique indexes`, which is exclusively
 * DROP/CREATE IF NOT EXISTS, DROP POLICY IF EXISTS/CREATE POLICY, and
 * idempotent INSERT...WHERE NOT EXISTS — safe to re-run.
 *
 * Future phase migrations with raw SQL must follow the same marker convention
 * so this script can pick up their tail too.
 */

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');
const RAW_SQL_MARKER = '-- Partial unique indexes';

function readSqlTail(migrationFolder: string, marker?: string): string {
  const full = readFileSync(
    join(MIGRATIONS_DIR, migrationFolder, 'migration.sql'),
    'utf-8',
  );
  if (!marker) return full;
  const idx = full.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `Marker "${marker}" not found in ${migrationFolder}/migration.sql. ` +
        `Every raw-SQL migration must include this marker above its RLS/index block.`,
    );
  }
  return full.slice(idx);
}

function splitStatements(sql: string): string[] {
  // Split on semicolon-at-end-of-line, strip comment-only statements.
  // `-- comment` lines inside a block of SQL are fine because we only filter
  // out standalone comment-only statements after a split.
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !s.split('\n').every((line) => line.trim().startsWith('--')));
}

async function runBlock(label: string, sql: string): Promise<void> {
  const statements = splitStatements(sql);
  console.info(`[rls] ${label}: ${statements.length} statement(s)`);
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
}

async function main(): Promise<void> {
  await runBlock('0001_rls (full)', readSqlTail('0001_rls'));
  await runBlock(
    '0002_phase2_audience (tail)',
    readSqlTail('0002_phase2_audience', RAW_SQL_MARKER),
  );
  await runBlock(
    '0003_phase3_email (tail)',
    readSqlTail('0003_phase3_email', RAW_SQL_MARKER),
  );
  console.info('[rls] done');
}

main()
  .catch((err) => {
    console.error('[rls] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
