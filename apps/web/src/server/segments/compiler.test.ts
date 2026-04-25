import { describe, expect, it } from 'vitest';

import { segmentRulesSchema, type SegmentRules } from '@getyn/types';

import {
  compileSegmentRules,
  SegmentCompileError,
  type SegmentCustomFieldEntry,
} from '@getyn/db';

/**
 * Compiler tests. We go through every field category + operator so future
 * changes to the compiler can't silently break existing saved segments.
 *
 * The tests are pure — no DB. We shape the input by hand rather than
 * round-tripping through the Prisma client.
 */

const NO_CUSTOM_FIELDS: SegmentCustomFieldEntry[] = [];

// Stable `now` so `within_last_days` asserts are deterministic.
const FIXED_NOW = new Date('2026-04-25T12:00:00.000Z');

function compile(rules: SegmentRules, customFields: SegmentCustomFieldEntry[] = NO_CUSTOM_FIELDS) {
  return compileSegmentRules(rules, { customFields, now: FIXED_NOW });
}

describe('segmentRulesSchema', () => {
  it('rejects an empty group', () => {
    const result = segmentRulesSchema.safeParse({
      kind: 'group',
      operator: 'AND',
      children: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects nesting deeper than 3 levels', () => {
    const nested: SegmentRules = {
      kind: 'group',
      operator: 'AND',
      children: [
        {
          kind: 'group',
          operator: 'AND',
          children: [
            {
              kind: 'group',
              operator: 'AND',
              children: [
                {
                  kind: 'group',
                  operator: 'AND',
                  children: [
                    { kind: 'condition', field: 'email', operator: 'is_set' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = segmentRulesSchema.safeParse(nested);
    expect(result.success).toBe(false);
  });

  it('accepts the seed-shipped Active VIPs segment', () => {
    const parsed = segmentRulesSchema.safeParse({
      kind: 'group',
      operator: 'AND',
      children: [
        {
          kind: 'condition',
          field: 'email_status',
          operator: 'equals',
          value: 'SUBSCRIBED',
        },
        {
          kind: 'condition',
          field: 'tag',
          operator: 'equals',
          value: 'ck' + 'x'.repeat(23),
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('compileSegmentRules — text fields', () => {
  it('compiles email equals', () => {
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [{ kind: 'condition', field: 'email', operator: 'equals', value: 'a@b.com' }],
    });
    expect(where).toEqual({ AND: [{ email: 'a@b.com' }] });
  });

  it('compiles first_name contains (case-insensitive)', () => {
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [
        { kind: 'condition', field: 'first_name', operator: 'contains', value: 'am' },
      ],
    });
    expect(where).toEqual({
      AND: [{ firstName: { contains: 'am', mode: 'insensitive' } }],
    });
  });

  it('compiles is_set / is_empty', () => {
    const where = compile({
      kind: 'group',
      operator: 'OR',
      children: [
        { kind: 'condition', field: 'phone', operator: 'is_set' },
        { kind: 'condition', field: 'phone', operator: 'is_empty' },
      ],
    });
    expect(where).toEqual({
      OR: [{ phone: { not: null } }, { phone: null }],
    });
  });

  it('throws if equals value is not a string', () => {
    expect(() =>
      compile({
        kind: 'group',
        operator: 'AND',
        children: [
          // Value is a number, but `email` is a text field — the compiler
          // must reject it at runtime even though the discriminated union
          // in the custom-field branch makes this structurally valid TS.
          { kind: 'condition', field: 'email', operator: 'equals', value: 42 as unknown as string },
        ],
      }),
    ).toThrow(SegmentCompileError);
  });
});

describe('compileSegmentRules — enum fields', () => {
  it('compiles email_status equals', () => {
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [
        {
          kind: 'condition',
          field: 'email_status',
          operator: 'equals',
          value: 'SUBSCRIBED',
        },
      ],
    });
    expect(where).toEqual({ AND: [{ emailStatus: 'SUBSCRIBED' }] });
  });

  it('compiles source in [IMPORT, MANUAL]', () => {
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [
        {
          kind: 'condition',
          field: 'source',
          operator: 'in',
          value: ['IMPORT', 'MANUAL'],
        },
      ],
    });
    expect(where).toEqual({ AND: [{ source: { in: ['IMPORT', 'MANUAL'] } }] });
  });

  it('throws on empty `in` arrays', () => {
    expect(() =>
      compile({
        kind: 'group',
        operator: 'AND',
        children: [
          {
            kind: 'condition',
            field: 'email_status',
            operator: 'in',
            value: [],
          },
        ],
      }),
    ).toThrow(SegmentCompileError);
  });
});

describe('compileSegmentRules — date fields', () => {
  it('compiles within_last_days with deterministic threshold', () => {
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [
        {
          kind: 'condition',
          field: 'created_at',
          operator: 'within_last_days',
          value: 7,
        },
      ],
    });
    const threshold = new Date(FIXED_NOW.getTime() - 7 * 86_400_000);
    expect(where).toEqual({ AND: [{ createdAt: { gte: threshold } }] });
  });

  it('compiles before/after with ISO strings', () => {
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [
        {
          kind: 'condition',
          field: 'created_at',
          operator: 'before',
          value: '2026-04-01T00:00:00.000Z',
        },
      ],
    });
    expect(where).toEqual({
      AND: [{ createdAt: { lt: new Date('2026-04-01T00:00:00.000Z') } }],
    });
  });
});

describe('compileSegmentRules — tag', () => {
  it('compiles tag equals (some)', () => {
    const tagId = 'ck' + 'a'.repeat(23);
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [
        { kind: 'condition', field: 'tag', operator: 'equals', value: tagId },
      ],
    });
    expect(where).toEqual({ AND: [{ tags: { some: { tagId } } }] });
  });

  it('compiles tag not_equals (none)', () => {
    const tagId = 'ck' + 'b'.repeat(23);
    const where = compile({
      kind: 'group',
      operator: 'AND',
      children: [
        { kind: 'condition', field: 'tag', operator: 'not_equals', value: tagId },
      ],
    });
    expect(where).toEqual({ AND: [{ tags: { none: { tagId } } }] });
  });
});

describe('compileSegmentRules — custom fields', () => {
  const numberField: SegmentCustomFieldEntry = {
    id: 'ck' + 'c'.repeat(23),
    key: 'ltv',
    type: 'NUMBER',
  };

  it('translates id → key for JSON path', () => {
    const where = compile(
      {
        kind: 'group',
        operator: 'AND',
        children: [
          {
            kind: 'condition',
            field: `custom_field:${numberField.id}`,
            operator: 'gt',
            value: 1000,
          },
        ],
      },
      [numberField],
    );
    expect(where).toEqual({
      AND: [{ customFields: { path: ['ltv'], gt: 1000 } }],
    });
  });

  it('rejects NUMBER operator on TEXT field', () => {
    const textField: SegmentCustomFieldEntry = {
      id: 'ck' + 'd'.repeat(23),
      key: 'plan',
      type: 'TEXT',
    };
    expect(() =>
      compile(
        {
          kind: 'group',
          operator: 'AND',
          children: [
            {
              kind: 'condition',
              field: `custom_field:${textField.id}`,
              operator: 'gt',
              value: 10,
            },
          ],
        },
        [textField],
      ),
    ).toThrow(SegmentCompileError);
  });

  it('throws if referenced custom field no longer exists', () => {
    expect(() =>
      compile(
        {
          kind: 'group',
          operator: 'AND',
          children: [
            {
              kind: 'condition',
              field: `custom_field:ck${'z'.repeat(23)}`,
              operator: 'equals',
              value: 'anything',
            },
          ],
        },
        [],
      ),
    ).toThrow(SegmentCompileError);
  });
});

describe('compileSegmentRules — nested groups', () => {
  it('compiles nested AND inside OR', () => {
    const where = compile({
      kind: 'group',
      operator: 'OR',
      children: [
        {
          kind: 'group',
          operator: 'AND',
          children: [
            { kind: 'condition', field: 'email_status', operator: 'equals', value: 'SUBSCRIBED' },
            { kind: 'condition', field: 'email', operator: 'is_set' },
          ],
        },
        { kind: 'condition', field: 'source', operator: 'equals', value: 'IMPORT' },
      ],
    });
    expect(where).toEqual({
      OR: [
        {
          AND: [
            { emailStatus: 'SUBSCRIBED' },
            { email: { not: null } },
          ],
        },
        { source: 'IMPORT' },
      ],
    });
  });
});
