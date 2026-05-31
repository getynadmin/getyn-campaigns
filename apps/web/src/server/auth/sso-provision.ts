/**
 * Phase 5 M1 — `provisionFromSso(claims)`.
 *
 * Core of SSO sign-in. Called from /api/auth/callback/auth0 with a
 * post-JWKS-verified, Zod-validated `SsoClaims` object. Resolves
 * (User, Tenant, Membership), syncs the plan from G-Suite
 * best-effort with a 1500ms timeout (per Phase 5 design decision (a)),
 * stamps the audit + redirects.
 *
 * # Contract
 * Inputs:
 *   - claims: validated SsoClaims (caller validated signature + Zod shape)
 *   - returnTo: optional same-origin path to redirect to
 *
 * Outputs:
 *   - { user, tenant, membership, redirectTo, planSyncPending }
 *
 * # Concurrency
 * Two simultaneous first-sign-ins for the same G-Suite tenant would
 * otherwise race to create two Campaigns tenants. Step 3 takes a
 * Postgres advisory lock keyed on a stable hash of
 * `gsuite_tenant_id`. Lock is released on commit or rollback.
 *
 * # Failure handling
 * - Claim parse failure: handled upstream; we never see it.
 * - User-resolution conflict (existing user with different
 *   auth0UserId): throw SsoIdentityConflictError. Caller maps to 409.
 * - Plan sync timeout / failure: log warning, set
 *   planSyncPending=true. User proceeds with cached/TRIAL plan.
 * - DB write failures: bubble. Caller maps to 500 + Sentry.
 */
import { createHash } from 'crypto';

import {
  AuthProvider,
  LegacyPlanTier,
  ProvisioningSource,
  prisma,
  type Membership,
  type Role,
  type Tenant,
  type User,
} from '@getyn/db';

import { normalizeSsoClaims, type SsoClaims } from '@getyn/types';

import { makeUniqueSlug } from '@/server/slug';

const PLAN_SYNC_TIMEOUT_MS = 1_500;

export class SsoIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoIdentityConflictError';
  }
}

export interface SsoProvisionResult {
  user: User;
  tenant: Tenant;
  membership: Membership;
  /** True when the plan-sync was skipped or timed out. */
  planSyncPending: boolean;
  /** Final redirect path post-provisioning. */
  redirectTo: string;
}

export async function provisionFromSso(
  claims: SsoClaims,
  options: { returnTo?: string | null } = {},
): Promise<SsoProvisionResult> {
  const n = normalizeSsoClaims(claims);

  // Advisory lock keyed on (mod 2^31 of sha256(gSuiteTenantId)). Same
  // tenant across concurrent calls → serialised through step 4. Hash
  // because pg_advisory_xact_lock takes a bigint, not a string.
  const lockKey = stableLockKey(n.gSuiteTenantId);

  const { user, tenant, membership } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock($1::bigint)`,
        lockKey,
      );

      // 1) Resolve user.
      const user = await resolveUser(tx, n);

      // 2) Resolve tenant + ensure membership.
      const { tenant, membership } = await resolveTenant(tx, user, n);

      // 3) Stamp lastSsoSyncAt — book-keeping.
      const stamped = await tx.user.update({
        where: { id: user.id },
        data: { lastSsoSyncAt: new Date() },
      });

      return { user: stamped, tenant, membership };
    },
  );

  // 4) Best-effort plan sync (outside the transaction — Meta API call).
  //    Bounded by PLAN_SYNC_TIMEOUT_MS so a slow G-Suite doesn't
  //    block sign-in. M3 will provide the real `pullPlanFromGSuite`;
  //    until then, we stub-call it and treat it as pending.
  let planSyncPending = false;
  try {
    const pulled = await Promise.race([
      pullPlanFromGSuiteStub(tenant.id, n.gSuiteTenantId),
      delayReject(PLAN_SYNC_TIMEOUT_MS, 'plan_sync_timeout'),
    ]);
    if (pulled === 'pending') planSyncPending = true;
  } catch {
    planSyncPending = true;
  }

  const redirectTo = pickRedirect(options.returnTo, tenant.slug);

  return { user, tenant, membership, planSyncPending, redirectTo };
}

// --------------------------------------------------------------------
// Steps
// --------------------------------------------------------------------

async function resolveUser(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  n: ReturnType<typeof normalizeSsoClaims>,
): Promise<User> {
  // a) Direct hit on auth0UserId — every subsequent SSO sign-in.
  const byAuth0 = await tx.user.findUnique({
    where: { auth0UserId: n.sub },
  });
  if (byAuth0) return byAuth0;

  // b) Fallback to email — covers two cases:
  //    - existing Supabase user (Phase 1) signing in via SSO for the
  //      first time → link the accounts.
  //    - existing Auth0 user with a different `sub` claiming the same
  //      email → IDENTITY CONFLICT, never silently switch.
  const byEmail = await tx.user.findUnique({ where: { email: n.email } });
  if (byEmail) {
    if (byEmail.auth0UserId && byEmail.auth0UserId !== n.sub) {
      throw new SsoIdentityConflictError(
        'An existing account uses this email under a different SSO identity. Contact support to reconcile.',
      );
    }
    return tx.user.update({
      where: { id: byEmail.id },
      data: {
        auth0UserId: n.sub,
        authProvider: AuthProvider.AUTH0,
        name: byEmail.name ?? n.name ?? null,
        avatarUrl: byEmail.avatarUrl ?? n.picture ?? null,
      },
    });
  }

  // c) Brand-new user. No Supabase row will ever exist.
  return tx.user.create({
    data: {
      email: n.email,
      name: n.name ?? null,
      avatarUrl: n.picture ?? null,
      supabaseUserId: null,
      auth0UserId: n.sub,
      authProvider: AuthProvider.AUTH0,
    },
  });
}

async function resolveTenant(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  user: User,
  n: ReturnType<typeof normalizeSsoClaims>,
): Promise<{ tenant: Tenant; membership: Membership }> {
  let tenant = await tx.tenant.findUnique({
    where: { gSuiteTenantId: n.gSuiteTenantId },
  });

  if (!tenant) {
    // First sign-in for this G-Suite tenant: provision.
    const slug = await makeUniqueSlug(n.gSuiteOrgName ?? 'workspace');
    tenant = await tx.tenant.create({
      data: {
        slug,
        name: n.gSuiteOrgName ?? 'New workspace',
        legacyPlanTier: LegacyPlanTier.TRIAL, // legacy display field; real plan via Subscription
        gSuiteTenantId: n.gSuiteTenantId,
        gSuiteOrgName: n.gSuiteOrgName ?? null,
        gSuiteSyncedAt: null,
        provisioningSource: ProvisioningSource.G_SUITE,
      },
    });
  }

  // Existing or fresh — ensure a Membership.
  const existing = await tx.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (existing) {
    // Re-stamp role from claims (G-Suite is the source of truth).
    if (existing.role !== n.role) {
      const updated = await tx.membership.update({
        where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        data: { role: n.role as Role },
      });
      return { tenant, membership: updated };
    }
    return { tenant, membership: existing };
  }

  const membership = await tx.membership.create({
    data: {
      userId: user.id,
      tenantId: tenant.id,
      role: n.role as Role,
    },
  });
  return { tenant, membership };
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

/**
 * Hash gSuiteTenantId → 31-bit positive int for pg_advisory_xact_lock.
 * Stable across processes; collision risk acceptable (lock contention
 * on the rare collision is harmless — just serialises two unrelated
 * tenants briefly).
 */
function stableLockKey(gSuiteTenantId: string): number {
  const hex = createHash('sha256').update(gSuiteTenantId).digest('hex');
  // First 8 hex chars → uint32 → clamp to 31 bits to stay positive.
  const n = Number.parseInt(hex.slice(0, 8), 16);
  return n & 0x7fffffff;
}

function pickRedirect(
  returnTo: string | null | undefined,
  tenantSlug: string,
): string {
  // Allow only same-origin relative paths starting with '/'. Reject
  // anything that looks like an absolute URL or scheme-relative path.
  if (
    typeof returnTo === 'string' &&
    returnTo.startsWith('/') &&
    !returnTo.startsWith('//')
  ) {
    return returnTo;
  }
  return `/t/${tenantSlug}/dashboard`;
}

function delayReject(ms: number, reason: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms));
}

/**
 * Phase 5 M3 stub. M3 swaps in `pullPlanFromGSuite` from a new
 * `@/server/billing/sync.ts`. For now we report 'pending' so the
 * sign-in proceeds; a background cron will populate the
 * Subscription mirror when it runs.
 */
async function pullPlanFromGSuiteStub(
  _campaignsTenantId: string,
  _gSuiteTenantId: string,
): Promise<'ok' | 'pending'> {
  return 'pending';
}
