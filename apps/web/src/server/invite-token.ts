import { randomBytes } from 'node:crypto';

import { INVITE_EXPIRY_DAYS, ONE_DAY_MS } from '@/lib/constants';

/**
 * Generate a 32-byte URL-safe token (≈ 43 chars base64url).
 * Not a JWT — we look it up in the `Invitation` table on each request.
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Compute the default expiry timestamp for a new invite. */
export function inviteExpiryDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_EXPIRY_DAYS * ONE_DAY_MS);
}

export type InviteStatus = 'valid' | 'expired' | 'already_accepted';

export interface InviteLike {
  expiresAt: Date;
  acceptedAt: Date | null;
}

/**
 * Pure status function — extracted so it can be unit-tested without a DB.
 * A token is `valid` only when it has not been accepted AND has not expired.
 */
export function inviteStatus(
  invite: InviteLike | null,
  now: Date = new Date(),
): InviteStatus | 'not_found' {
  if (!invite) return 'not_found';
  if (invite.acceptedAt) return 'already_accepted';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
