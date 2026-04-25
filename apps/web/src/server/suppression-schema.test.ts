import { describe, expect, it } from 'vitest';

import {
  contactEventListInputSchema,
  suppressionCreateSchema,
  suppressionListInputSchema,
} from '@getyn/types';

/**
 * Pure schema tests for the M7 suppression + events inputs. We avoid the
 * database here — the only contract that matters at this layer is what
 * shapes the tRPC procedures will and won't accept.
 */

describe('suppressionCreateSchema', () => {
  it('lowercases email values on parse', () => {
    const parsed = suppressionCreateSchema.parse({
      channel: 'EMAIL',
      value: 'Foo@Example.COM',
      reason: 'MANUAL',
    });
    expect(parsed.value).toBe('foo@example.com');
  });

  it('preserves casing for non-email channels (phone is E.164)', () => {
    const parsed = suppressionCreateSchema.parse({
      channel: 'SMS',
      value: '+15551234567',
      reason: 'MANUAL',
    });
    expect(parsed.value).toBe('+15551234567');
  });

  it('defaults reason to MANUAL when omitted', () => {
    const parsed = suppressionCreateSchema.parse({
      channel: 'EMAIL',
      value: 'a@b.com',
    });
    expect(parsed.reason).toBe('MANUAL');
  });

  it('rejects an empty value', () => {
    const result = suppressionCreateSchema.safeParse({
      channel: 'EMAIL',
      value: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-MANUAL reasons (auto-paths bypass this schema)', () => {
    const result = suppressionCreateSchema.safeParse({
      channel: 'EMAIL',
      value: 'a@b.com',
      reason: 'BOUNCED',
    });
    expect(result.success).toBe(false);
  });

  it('caps note length to 280 chars', () => {
    const long = 'x'.repeat(281);
    const result = suppressionCreateSchema.safeParse({
      channel: 'EMAIL',
      value: 'a@b.com',
      note: long,
    });
    expect(result.success).toBe(false);
  });
});

describe('suppressionListInputSchema', () => {
  it('applies a default limit of 50', () => {
    const parsed = suppressionListInputSchema.parse({});
    expect(parsed.limit).toBe(50);
  });

  it('rejects out-of-range limits', () => {
    expect(suppressionListInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(suppressionListInputSchema.safeParse({ limit: 200 }).success).toBe(false);
  });
});

describe('contactEventListInputSchema', () => {
  it('requires a cuid contactId', () => {
    expect(
      contactEventListInputSchema.safeParse({ contactId: 'not-a-cuid' }).success,
    ).toBe(false);
    const ok = contactEventListInputSchema.safeParse({
      contactId: `ck${'a'.repeat(23)}`,
    });
    expect(ok.success).toBe(true);
  });

  it('defaults limit to 25', () => {
    const parsed = contactEventListInputSchema.parse({
      contactId: `ck${'a'.repeat(23)}`,
    });
    expect(parsed.limit).toBe(25);
  });
});
