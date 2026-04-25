import { describe, expect, it } from 'vitest';

import {
  contactCreateSchema,
  contactListInputSchema,
  customFieldCreateSchema,
  customFieldKeySchema,
  customFieldUpdateSchema,
  hexColorSchema,
  tagCreateSchema,
} from '@getyn/types';

/**
 * Pure schema tests for the Phase 2 contacts / tags / custom-fields inputs.
 * These mirror what the tRPC procedures and React Hook Form resolvers see —
 * keeping the contract green here means the entire write path stays honest
 * without us spinning up a database.
 */

describe('contactCreateSchema', () => {
  it('accepts an email-only contact and lowercases the address', () => {
    const parsed = contactCreateSchema.parse({ email: 'Jane@Example.COM' });
    expect(parsed.email).toBe('jane@example.com');
    expect(parsed.phone).toBeUndefined();
  });

  it('accepts a phone-only contact', () => {
    const parsed = contactCreateSchema.parse({ phone: '+1 (555) 123-4567' });
    expect(parsed.phone).toBe('+1 (555) 123-4567');
    expect(parsed.email).toBeUndefined();
  });

  it('coerces empty phone strings to undefined (UI sends "" from blank inputs)', () => {
    // Phone has a regex that rejects "", so the schema's `.or(z.literal('')
    // .transform(() => undefined))` fallback kicks in. Names are looser —
    // they accept "" through the trim+max branch — so the router is the
    // place that drops empty names, not Zod.
    const parsed = contactCreateSchema.parse({
      email: 'a@b.com',
      phone: '',
    });
    expect(parsed.phone).toBeUndefined();
  });

  it('rejects a contact with neither email nor phone', () => {
    const result = contactCreateSchema.safeParse({ firstName: 'Jane' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = contactCreateSchema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a phone string with letters', () => {
    const result = contactCreateSchema.safeParse({ phone: '+1-CALL-NOW' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed language tag', () => {
    const result = contactCreateSchema.safeParse({
      email: 'a@b.com',
      language: 'english',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed BCP-47 language', () => {
    const parsed = contactCreateSchema.parse({
      email: 'a@b.com',
      language: 'en-US',
    });
    expect(parsed.language).toBe('en-US');
  });
});

describe('contactListInputSchema', () => {
  it('defaults limit to 25', () => {
    const parsed = contactListInputSchema.parse({});
    expect(parsed.limit).toBe(25);
  });

  it('rejects an oversized tag list (cap at 50)', () => {
    const tagIds = Array.from({ length: 51 }, () => `ck${'a'.repeat(23)}`);
    const result = contactListInputSchema.safeParse({ tagIds });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range limits', () => {
    expect(contactListInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(contactListInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('hexColorSchema', () => {
  it('accepts #RGB and #RRGGBB, case-insensitive', () => {
    expect(hexColorSchema.parse('#abc')).toBe('#abc');
    expect(hexColorSchema.parse('#A1B2C3')).toBe('#A1B2C3');
  });

  it('rejects strings without a leading #', () => {
    expect(hexColorSchema.safeParse('abcdef').success).toBe(false);
  });

  it('rejects invalid hex digits', () => {
    expect(hexColorSchema.safeParse('#zzzzzz').success).toBe(false);
  });
});

describe('tagCreateSchema', () => {
  it('accepts a name + valid color', () => {
    const parsed = tagCreateSchema.parse({ name: 'VIP', color: '#ff0044' });
    expect(parsed.name).toBe('VIP');
    expect(parsed.color).toBe('#ff0044');
  });

  it('trims the name', () => {
    const parsed = tagCreateSchema.parse({
      name: '  Newsletter  ',
      color: '#000',
    });
    expect(parsed.name).toBe('Newsletter');
  });

  it('rejects an empty name', () => {
    const result = tagCreateSchema.safeParse({ name: '   ', color: '#000' });
    expect(result.success).toBe(false);
  });
});

describe('customFieldKeySchema', () => {
  it('accepts lowercase letters / digits / underscores starting with a letter', () => {
    expect(customFieldKeySchema.parse('plan_tier')).toBe('plan_tier');
    expect(customFieldKeySchema.parse('lifetime_value_2024')).toBe(
      'lifetime_value_2024',
    );
  });

  it('rejects keys that start with a digit or contain uppercase / hyphens', () => {
    expect(customFieldKeySchema.safeParse('1_plan').success).toBe(false);
    expect(customFieldKeySchema.safeParse('PlanTier').success).toBe(false);
    expect(customFieldKeySchema.safeParse('plan-tier').success).toBe(false);
  });

  it('rejects single-character keys (min 2)', () => {
    expect(customFieldKeySchema.safeParse('p').success).toBe(false);
  });
});

describe('customFieldCreateSchema', () => {
  it('accepts a TEXT field without options', () => {
    const parsed = customFieldCreateSchema.parse({
      key: 'plan_tier',
      label: 'Plan tier',
      type: 'TEXT',
    });
    expect(parsed.type).toBe('TEXT');
  });

  it('requires options.choices for SELECT fields', () => {
    const missing = customFieldCreateSchema.safeParse({
      key: 'plan_tier',
      label: 'Plan tier',
      type: 'SELECT',
    });
    expect(missing.success).toBe(false);

    const empty = customFieldCreateSchema.safeParse({
      key: 'plan_tier',
      label: 'Plan tier',
      type: 'SELECT',
      options: { choices: [] },
    });
    expect(empty.success).toBe(false);

    const ok = customFieldCreateSchema.safeParse({
      key: 'plan_tier',
      label: 'Plan tier',
      type: 'SELECT',
      options: { choices: ['Free', 'Pro', 'Enterprise'] },
    });
    expect(ok.success).toBe(true);
  });
});

describe('customFieldUpdateSchema', () => {
  it('omits `type` (immutable post-creation) and accepts label + options changes', () => {
    const parsed = customFieldUpdateSchema.parse({
      id: `ck${'a'.repeat(23)}`,
      label: 'Plan tier (renamed)',
      options: { choices: ['Free', 'Pro'] },
    });
    expect(parsed.label).toBe('Plan tier (renamed)');
    expect(parsed.options?.choices).toEqual(['Free', 'Pro']);
  });

  it('strips a sneaky `type` field instead of mutating the field type', () => {
    // `type` isn't on the schema, and Zod's default `strip` mode drops it.
    // The invariant we want is "the parsed output never carries `type`" —
    // so even if a client manages to send it, the router can't accidentally
    // forward an immutable-field change down to Prisma.
    const parsed = customFieldUpdateSchema.parse({
      id: `ck${'a'.repeat(23)}`,
      label: 'X',
      type: 'NUMBER',
    } as unknown as Parameters<typeof customFieldUpdateSchema.parse>[0]);
    expect('type' in parsed).toBe(false);
  });
});
