/**
 * Phase 5 M4 — tenant operational state.
 *
 * Single source of truth for "what is this tenant allowed to do
 * right now?". Every mutation that touches paid surfaces (campaign
 * sends, imports, AI, WhatsApp outbound) gates on this.
 *
 * # States
 *   ACTIVE       — full access
 *   READ_ONLY    — subscription canceled, in grace period.
 *                  Existing data accessible; no new campaigns/
 *                  sends/imports/AI/WhatsApp outbound. Inbox
 *                  inbound continues (customers still ping).
 *   SUSPENDED    — G-Suite suspended the tenant (abuse / billing
 *                  failure / manual ops action). Same writes as
 *                  READ_ONLY blocked + inbound webhook processing
 *                  also paused (the worker checks state).
 *   PURGING      — tenant.deleted received OR grace period
 *                  expired. Purge job in flight. Everything blocked.
 *   ACTIVE_TRIAL — subscription is TRIALING in BillingSubscription
 *                  (treated identically to ACTIVE for guards;
 *                  surface as a banner separately).
 *
 * # Derivation
 * Reads `Tenant.billingStatus` (Phase 1 legacy enum) AND
 * `BillingSubscription.status` (Phase 5 source of truth) and resolves
 * conflicts: BillingSubscription wins when it exists. Tenants
 * without a BillingSubscription row fall back to the legacy enum
 * (DIRECT-provisioned tenants in the pre-M3 world).
 *
 * # Grace period
 * 30 days from `cancelAt` (or status-flip time) before the purge
 * job is scheduled. Reactivation during the window restores ACTIVE.
 */
import type { BillingSubscription, Tenant } from '@getyn/db';

export type TenantOperationalMode =
  | 'ACTIVE'
  | 'READ_ONLY'
  | 'SUSPENDED'
  | 'PURGING';

export interface TenantOperationalState {
  mode: TenantOperationalMode;
  /** Set when in READ_ONLY due to subscription cancellation. */
  readOnlyUntil?: Date;
  /** Human-readable label for banners + error messages. */
  reason: string;
  /** True when paid mutations should be blocked. */
  blocksWrites: boolean;
  /** True when inbound webhook processing should also pause (SUSPENDED only). */
  blocksInboundProcessing: boolean;
}

const GRACE_PERIOD_DAYS = 30;

export function deriveTenantState(
  tenant: Pick<Tenant, 'billingStatus' | 'settings'>,
  subscription: Pick<
    BillingSubscription,
    'status' | 'cancelAt' | 'currentPeriodEnd'
  > | null,
): TenantOperationalState {
  // BillingSubscription wins when present.
  if (subscription) {
    switch (subscription.status) {
      case 'SUSPENDED':
        return {
          mode: 'SUSPENDED',
          reason: 'Workspace suspended by G-Suite.',
          blocksWrites: true,
          blocksInboundProcessing: true,
        };
      case 'CANCELED':
        return {
          mode: 'READ_ONLY',
          readOnlyUntil: computeGraceEnd(subscription.cancelAt),
          reason: 'Subscription canceled. Read-only until grace period ends.',
          blocksWrites: true,
          blocksInboundProcessing: false,
        };
      case 'PAST_DUE':
        // PAST_DUE doesn't block writes — G-Suite handles dunning and
        // ultimately flips to CANCELED if payment never resolves.
        // We surface a banner separately but keep sends going.
        return {
          mode: 'ACTIVE',
          reason: 'Payment past due — resolve in G-Suite.',
          blocksWrites: false,
          blocksInboundProcessing: false,
        };
      case 'TRIALING':
      case 'ACTIVE':
        return {
          mode: 'ACTIVE',
          reason: 'Active.',
          blocksWrites: false,
          blocksInboundProcessing: false,
        };
    }
  }

  // Tenants without a BillingSubscription row (pre-M3 / DIRECT) fall
  // back to the legacy Tenant.billingStatus enum.
  if (tenant.billingStatus === 'CANCELED') {
    return {
      mode: 'READ_ONLY',
      reason: 'Subscription canceled.',
      blocksWrites: true,
      blocksInboundProcessing: false,
    };
  }
  if (tenant.billingStatus === 'PAST_DUE') {
    return {
      mode: 'ACTIVE',
      reason: 'Payment past due.',
      blocksWrites: false,
      blocksInboundProcessing: false,
    };
  }

  // Settings.purging flag (set by gsuite handler when scheduling purge).
  const settings = (tenant.settings ?? {}) as { purging?: boolean };
  if (settings.purging === true) {
    return {
      mode: 'PURGING',
      reason: 'Workspace deletion in progress.',
      blocksWrites: true,
      blocksInboundProcessing: true,
    };
  }

  return {
    mode: 'ACTIVE',
    reason: 'Active.',
    blocksWrites: false,
    blocksInboundProcessing: false,
  };
}

function computeGraceEnd(cancelAt: Date | null | undefined): Date {
  const base = cancelAt ?? new Date();
  return new Date(base.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
}

/** True if `now` is past the tenant's grace period. */
export function isGraceExpired(
  state: TenantOperationalState,
  now: Date = new Date(),
): boolean {
  return (
    state.mode === 'READ_ONLY' &&
    state.readOnlyUntil !== undefined &&
    state.readOnlyUntil < now
  );
}

/**
 * tRPC-friendly assertion. Throws TRPCError with a customer-facing
 * message when the tenant's state blocks the requested mutation.
 * Use at the top of every mutation that should be blocked under
 * read-only / suspended / purging.
 */
export function assertWritable(state: TenantOperationalState): void {
  if (!state.blocksWrites) return;
  // Throw a plain Error tagged so callers can map to TRPCError when
  // they're inside tRPC. Worker callers just see the message + log.
  // (We avoid importing @trpc/server here because this module is
  // shared with non-tRPC contexts.)
  const err = new Error(friendlyMessage(state));
  err.name = 'TenantNotWritableError';
  throw err;
}

function friendlyMessage(state: TenantOperationalState): string {
  switch (state.mode) {
    case 'SUSPENDED':
      return 'This workspace is suspended. Reactivate in G-Suite to resume sends.';
    case 'READ_ONLY':
      return state.readOnlyUntil
        ? `Subscription canceled. Workspace is read-only until ${state.readOnlyUntil.toLocaleDateString()}.`
        : 'Workspace is read-only.';
    case 'PURGING':
      return 'Workspace deletion in progress. No further actions allowed.';
    default:
      return 'Workspace is not active.';
  }
}
