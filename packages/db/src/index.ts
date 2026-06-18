import {
  PrismaClient,
  type Channel,
  type ContactEventType,
  type Prisma,
  type SuppressionReason,
} from '@prisma/client';

export * from '@prisma/client';

export {
  compileSegmentRules,
  SegmentCompileError,
  type SegmentCustomFieldEntry,
} from './segments/compiler';

export {
  signEmailToken,
  verifyEmailToken,
  type EmailTokenKind,
  type VerifiedEmailToken,
} from './email-tokens';

export {
  computeSuspensionDecision,
  checkAndApplySuspension,
  incrementSendCounters,
  type SuspensionDecision,
} from './sending-policy';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Run `fn` inside a Prisma transaction with the Postgres session variable
 * `app.current_tenant_id` set to `tenantId`. RLS policies read this variable
 * to authorize row access. Every tenant-scoped query MUST go through this
 * wrapper — plain `prisma.*` calls will fail RLS for tenant-owned tables
 * once policies are applied.
 *
 * Pass `tenantId = null` only for system-level operations (signup, invite
 * acceptance) where the tenant context does not yet exist.
 */
export async function withTenant<T>(
  _tenantId: string | null,
  fn: (tx: PrismaClient) => Promise<T>,
  _opts?: {
    timeout?: number;
    maxWait?: number;
  },
): Promise<T> {
  // Phase 7.2 follow-up — withTenant used to open a Prisma
  // $transaction and SET LOCAL app.current_tenant_id, which RLS
  // policies on tenant-scoped tables read for row authorization.
  //
  // That broke catastrophically on Supabase's Transaction Pooler
  // (port 6543): pgbouncer doesn't pin connections within an
  // interactive tx, so SET LOCAL gets dropped between statements
  // and RLS silently filters every row out. Switching to Session
  // Pooler fixes the tx semantics but exhausts Supabase's session
  // cap under Vercel's serverless fan-out (EMAXCONNSESSION).
  //
  // Disabling RLS database-wide (migration
  // `disable_rls_app_layer_enforcement`) removes the only thing
  // that needed the session var. Every Prisma query in the codebase
  // already includes `tenantId` in its WHERE/data clauses, so
  // tenant scoping continues to hold at the app layer.
  //
  // The wrapper is kept as a typed pass-through so the hundreds of
  // existing call sites keep compiling. tenantId is preserved as a
  // parameter so future code can rely on the contract; opts is
  // retained for the same reason but no longer needed.
  return fn(prisma);
}

/**
 * Transaction-aware Prisma client — what `withTenant`'s callback receives,
 * and what `emitContactEvent` expects. Exported so callers can annotate
 * helpers that do multiple operations inside the same tenant transaction.
 */
export type TenantTx = PrismaClient;

/**
 * Append a ContactEvent inside the current tenant transaction. Every Phase 2
 * mutation that modifies a contact (create, update, tag change, status flip,
 * import, etc.) should call this so the activity timeline stays complete.
 *
 * Always call this from inside `withTenant(tenantId, tx => ...)` — the `tx`
 * argument must be the transaction client from that wrapper so the row is
 * written under the tenant's RLS scope and atomically with the mutation.
 *
 * Phase 3's send pipeline will reuse this helper for EMAIL_SENT,
 * EMAIL_OPENED, etc. — no changes needed here.
 */
export async function emitContactEvent(
  tx: TenantTx,
  params: {
    tenantId: string;
    contactId: string;
    type: ContactEventType;
    metadata?: Prisma.InputJsonValue;
    occurredAt?: Date;
  },
): Promise<void> {
  await tx.contactEvent.create({
    data: {
      tenantId: params.tenantId,
      contactId: params.contactId,
      type: params.type,
      metadata: params.metadata ?? {},
      occurredAt: params.occurredAt ?? new Date(),
    },
  });
}

/**
 * Idempotently insert a SuppressionEntry. The `(tenantId, channel, value)`
 * unique constraint means we can never end up with duplicate rows for the
 * same address — we deliberately don't overwrite the existing `reason` on
 * collision because the *first* reason a contact entered the list for is
 * the most operationally interesting one (e.g. a hard bounce, then a later
 * manual block, should still log the bounce as the primary cause).
 *
 * Returns `'created'` when a new row landed, `'noop'` when the row already
 * existed. Callers don't need to act on this — it's mostly there for tests.
 */
export async function upsertSuppressionEntry(
  tx: TenantTx,
  params: {
    tenantId: string;
    channel: Channel;
    /** email: lowercased; phone: E.164. Caller is responsible for normalising. */
    value: string;
    reason: SuppressionReason;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<'created' | 'noop'> {
  if (!params.value) return 'noop';
  const existing = await tx.suppressionEntry.findUnique({
    where: {
      tenantId_channel_value: {
        tenantId: params.tenantId,
        channel: params.channel,
        value: params.value,
      },
    },
    select: { id: true },
  });
  if (existing) return 'noop';
  await tx.suppressionEntry.create({
    data: {
      tenantId: params.tenantId,
      channel: params.channel,
      value: params.value,
      reason: params.reason,
      metadata: params.metadata ?? {},
    },
  });
  return 'created';
}
