import { describe, expect, it } from 'vitest';

import {
  generateInviteToken,
  inviteExpiryDate,
  inviteStatus,
} from './invite-token';

describe('generateInviteToken', () => {
  it('produces a URL-safe base64url string of the expected length', () => {
    const token = generateInviteToken();
    // 32 bytes → 43 base64url chars (no padding).
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never produces the same token twice in a tight loop', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i += 1) set.add(generateInviteToken());
    expect(set.size).toBe(1000);
  });
});

describe('inviteStatus', () => {
  const now = new Date('2026-01-15T12:00:00Z');

  it('returns not_found when the invitation is missing', () => {
    expect(inviteStatus(null, now)).toBe('not_found');
  });

  it('returns already_accepted once acceptedAt is set', () => {
    expect(
      inviteStatus(
        {
          acceptedAt: new Date('2026-01-10T00:00:00Z'),
          expiresAt: new Date('2026-01-20T00:00:00Z'),
        },
        now,
      ),
    ).toBe('already_accepted');
  });

  it('returns expired when expiresAt is in the past and not accepted', () => {
    expect(
      inviteStatus(
        { acceptedAt: null, expiresAt: new Date('2026-01-14T00:00:00Z') },
        now,
      ),
    ).toBe('expired');
  });

  it('treats exact-equal expiry as expired (boundary)', () => {
    expect(inviteStatus({ acceptedAt: null, expiresAt: now }, now)).toBe('expired');
  });

  it('returns valid for an unaccepted, unexpired invitation', () => {
    expect(
      inviteStatus(
        { acceptedAt: null, expiresAt: new Date('2026-01-20T00:00:00Z') },
        now,
      ),
    ).toBe('valid');
  });
});

describe('inviteExpiryDate', () => {
  it('lands 7 days after the provided "now"', () => {
    const now = new Date('2026-04-01T00:00:00Z');
    const exp = inviteExpiryDate(now);
    const days = (exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(7);
  });
});
