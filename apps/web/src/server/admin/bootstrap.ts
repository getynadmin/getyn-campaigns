/**
 * Phase 5 M7 — staff bootstrap.
 *
 * On first deploy, the StaffUser table is empty. INITIAL_STAFF_EMAILS
 * (comma-separated) lets us seed an initial SUPPORT_ADMIN list at
 * boot — once the table has at least one SUPPORT_ADMIN, that admin
 * can invite/remove the rest via the /admin/staff UI.
 *
 * Idempotent: re-running with the same env value is a no-op. Adding
 * an email later DOES insert it (so ops can grant access without a
 * deploy as long as the env var is updated and the worker / web
 * cycles).
 *
 * Called from a one-shot worker job + on web app boot. Cheap, two
 * indexed selects.
 */
import { StaffRole, prisma } from '@getyn/db';

export async function bootstrapInitialStaff(): Promise<{
  inserted: number;
  skipped: number;
}> {
  const raw = process.env.INITIAL_STAFF_EMAILS;
  if (!raw) return { inserted: 0, skipped: 0 };
  const emails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && /@/.test(e));
  if (emails.length === 0) return { inserted: 0, skipped: 0 };

  const existing = await prisma.staffUser.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const known = new Set(existing.map((s) => s.email));
  const toInsert = emails.filter((e) => !known.has(e));
  if (toInsert.length === 0) return { inserted: 0, skipped: emails.length };

  await prisma.staffUser.createMany({
    data: toInsert.map((email) => ({ email, role: StaffRole.SUPPORT_ADMIN })),
    skipDuplicates: true,
  });
  return { inserted: toInsert.length, skipped: emails.length - toInsert.length };
}
