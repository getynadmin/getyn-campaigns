/**
 * Phase 5 M7 — staff-only DB context helper.
 *
 * Counterpart to `withTenant(tenantId, fn)`. Where withTenant sets
 * `app.current_tenant_id` so RLS policies match, withAdminContext
 * sets a marker that allows the service-role Prisma client to read
 * cross-tenant data — and crucially, writes an audit row at the
 * start of any privileged action.
 *
 * # Audit-first policy
 * Every privileged staff action MUST construct an audit log entry
 * via this helper. The pattern:
 *
 *   await withAdminContext(staff, async (tx) => {
 *     // 1) Capture before-snapshot of whatever we're mutating
 *     // 2) Mutate
 *     // 3) Write StaffAuditLog row inside the same tx
 *   });
 *
 * Audit writes go through the same transaction as the mutation so
 * a failure rolls both back atomically. The transaction is the
 * point of truth — there's no way to act without leaving an entry.
 *
 * # Not a DB session helper
 * Unlike `withTenant`, this does NOT set a PG session variable.
 * Staff queries use the service-role client which bypasses RLS by
 * default. We rely on the route-level + middleware-level checks to
 * ensure only staff reach this code path.
 */
import { Prisma, prisma, type StaffRole } from '@getyn/db';

import type { StaffContext } from './staff-session';

export type AdminTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface AdminAuditArgs {
  action: string;
  targetTenantId?: string | null;
  targetEntityId?: string | null;
  // unknown so callers can pass Prisma rows with Date fields without
  // pre-serializing — toJsonSnapshot below normalizes via JSON
  // round-trip (Dates → ISO strings; functions / undefined dropped).
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * JSON-safe snapshot. Dates → ISO strings, undefined fields dropped,
 * functions dropped. The lossy bits don't matter for audit purposes;
 * the goal is "what changed", not "every type-preserving detail".
 */
function toJsonSnapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Run `fn` inside a Prisma transaction, then write a StaffAuditLog
 * row carrying whatever audit metadata `fn` returns alongside its
 * result. The audit row is part of the same transaction — if `fn`
 * throws, the audit row never lands.
 */
export async function withAdminContext<T>(
  staff: StaffContext,
  fn: (tx: AdminTx) => Promise<{ result: T; audit: AdminAuditArgs }>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const { result, audit } = await fn(tx);
    await tx.staffAuditLog.create({
      data: {
        staffUserId: staff.staffUserId,
        staffEmail: staff.staffEmail,
        action: audit.action,
        targetTenantId: audit.targetTenantId ?? null,
        targetEntityId: audit.targetEntityId ?? null,
        beforeSnapshot: toJsonSnapshot(audit.beforeSnapshot) ?? Prisma.JsonNull,
        afterSnapshot: toJsonSnapshot(audit.afterSnapshot) ?? Prisma.JsonNull,
        reason: audit.reason ?? null,
        ipAddress: audit.ipAddress ?? null,
        userAgent: audit.userAgent ?? null,
      },
    });
    return result;
  });
}

/**
 * Convenience: write an audit-only entry without a side-effect
 * mutation. Used for read-only "tenant accessed by staff" trail.
 */
export async function auditStaffAccess(
  staff: StaffContext,
  args: AdminAuditArgs,
): Promise<void> {
  await prisma.staffAuditLog.create({
    data: {
      staffUserId: staff.staffUserId,
      staffEmail: staff.staffEmail,
      action: args.action,
      targetTenantId: args.targetTenantId ?? null,
      targetEntityId: args.targetEntityId ?? null,
      beforeSnapshot: (args.beforeSnapshot ?? null) as Prisma.InputJsonValue,
      afterSnapshot: (args.afterSnapshot ?? null) as Prisma.InputJsonValue,
      reason: args.reason ?? null,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    },
  });
}

/**
 * Role-check helper. `SUPPORT_ADMIN` is a superset of `SUPPORT`.
 */
export function requireStaffRole(
  staff: StaffContext,
  required: StaffRole,
): void {
  if (required === 'SUPPORT_ADMIN' && staff.role !== 'SUPPORT_ADMIN') {
    throw new Error('Action requires SUPPORT_ADMIN role.');
  }
}
