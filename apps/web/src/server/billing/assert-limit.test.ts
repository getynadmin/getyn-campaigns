/**
 * Phase 5.5 M8 — limit gate semantics.
 *
 * Covers the three operationally-critical behaviors of the gate:
 *   - -1 short-circuits without a usage count (hot path)
 *   - 0 produces "plan doesn't include X" copy
 *   - n produces "current/limit" copy and throws when delta would overflow
 */
import type { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./resolve-limits', () => ({
  resolveTenantLimit: vi.fn(),
}));
vi.mock('./measure-usage', () => ({
  getCurrentUsage: vi.fn(),
}));

import { resolveTenantLimit } from './resolve-limits';
import { getCurrentUsage } from './measure-usage';
import { assertWithinLimit, checkLimit } from './assert-limit';

const mockLimit = resolveTenantLimit as unknown as ReturnType<typeof vi.fn>;
const mockUsage = getCurrentUsage as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe('checkLimit', () => {
  it('short-circuits on unlimited (-1) without counting usage', async () => {
    mockLimit.mockResolvedValueOnce(-1);
    const result = await checkLimit('t', 'EMAILS_PER_MONTH' as never, 1000);
    expect(result.allowed).toBe(true);
    expect(mockUsage).not.toHaveBeenCalled();
  });

  it('allows when current + delta is exactly at cap', async () => {
    mockLimit.mockResolvedValueOnce(100);
    mockUsage.mockResolvedValueOnce(99);
    const result = await checkLimit('t', 'EMAILS_PER_MONTH' as never, 1);
    expect(result.allowed).toBe(true);
  });

  it('rejects when current + delta would exceed cap', async () => {
    mockLimit.mockResolvedValueOnce(100);
    mockUsage.mockResolvedValueOnce(99);
    const result = await checkLimit('t', 'EMAILS_PER_MONTH' as never, 2);
    expect(result.allowed).toBe(false);
  });

  it('rejects every call when limit is 0', async () => {
    mockLimit.mockResolvedValueOnce(0);
    mockUsage.mockResolvedValueOnce(0);
    const result = await checkLimit('t', 'CUSTOM_SENDING_DOMAINS' as never, 1);
    expect(result.allowed).toBe(false);
  });
});

describe('assertWithinLimit', () => {
  it('does not throw on unlimited', async () => {
    mockLimit.mockResolvedValueOnce(-1);
    await expect(
      assertWithinLimit('t', 'EMAILS_PER_MONTH' as never, 5),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN with feature-not-included copy when limit is 0', async () => {
    mockLimit.mockResolvedValueOnce(0);
    mockUsage.mockResolvedValueOnce(0);
    await expect(
      assertWithinLimit('t', 'AI_CREDITS_PER_MONTH' as never, 1),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining("Your plan doesn't include"),
    } as Partial<TRPCError>);
  });

  it('throws FORBIDDEN with current/limit numbers when over cap', async () => {
    mockLimit.mockResolvedValueOnce(100);
    mockUsage.mockResolvedValueOnce(99);
    await expect(
      assertWithinLimit('t', 'EMAILS_PER_MONTH' as never, 5),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('99/100'),
    } as Partial<TRPCError>);
  });
});
