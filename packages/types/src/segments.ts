/**
 * Zod schemas for Phase 2 Segments.
 *
 * A segment is a saved predicate over contacts. Its `rules` JSON column on
 * the Segment model is validated at read + write time against
 * `segmentRulesSchema` — the compiler in the web app walks the validated
 * tree and produces a Prisma WhereInput.
 *
 * The rule tree is a recursive discriminated union:
 *
 *   rule
 *   ├── group:      { kind: 'group', operator: 'AND'|'OR', children: rule[] }
 *   └── condition:  { kind: 'condition', field, operator, value? }
 *
 * We intentionally keep the shape close to the seed.ts segments that shipped
 * with Milestone 3 so old rows stay valid after this milestone lands.
 *
 * Field naming: snake_case. Contact-scalar fields, enum fields, the `tag`
 * pseudo-field, and `custom_field:{customFieldId}` are all supported. Using
 * the *id* (not the key) for custom fields means renaming a field key in
 * Settings doesn't silently invalidate live segments.
 */
import { z } from 'zod';

import { cuidSchema } from './common';
import {
  contactSourceSchema,
  subscriptionStatusSchema,
} from './contacts';

// ---------------------------------------------------------------------------
// Field registry — what a condition's `field` can be
// ---------------------------------------------------------------------------

export const SEGMENT_TEXT_FIELDS = [
  'email',
  'phone',
  'first_name',
  'last_name',
  'language',
  'timezone',
] as const;
export type SegmentTextField = (typeof SEGMENT_TEXT_FIELDS)[number];

export const SEGMENT_ENUM_FIELDS = [
  'email_status',
  'sms_status',
  'whatsapp_status',
  'source',
] as const;
export type SegmentEnumField = (typeof SEGMENT_ENUM_FIELDS)[number];

export const SEGMENT_DATE_FIELDS = ['created_at', 'updated_at'] as const;
export type SegmentDateField = (typeof SEGMENT_DATE_FIELDS)[number];

/** `tag` is a pseudo-field; its value is a Tag.id. */
export const SEGMENT_TAG_FIELD = 'tag' as const;

/** `custom_field:{cuid}` — the suffix is a CustomField.id. */
const customFieldRefRegex = /^custom_field:[a-z0-9]{20,32}$/;

// ---------------------------------------------------------------------------
// Operator registries per field kind
// ---------------------------------------------------------------------------

export const SEGMENT_TEXT_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_set',
  'is_empty',
] as const;
export type SegmentTextOperator = (typeof SEGMENT_TEXT_OPERATORS)[number];

export const SEGMENT_ENUM_OPERATORS = [
  'equals',
  'not_equals',
  'in',
  'not_in',
] as const;
export type SegmentEnumOperator = (typeof SEGMENT_ENUM_OPERATORS)[number];

export const SEGMENT_DATE_OPERATORS = [
  'within_last_days',
  'before',
  'after',
  'is_set',
  'is_empty',
] as const;
export type SegmentDateOperator = (typeof SEGMENT_DATE_OPERATORS)[number];

export const SEGMENT_TAG_OPERATORS = ['equals', 'not_equals'] as const;
export type SegmentTagOperator = (typeof SEGMENT_TAG_OPERATORS)[number];

export const SEGMENT_NUMBER_OPERATORS = [
  'equals',
  'not_equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_set',
  'is_empty',
] as const;
export type SegmentNumberOperator = (typeof SEGMENT_NUMBER_OPERATORS)[number];

export const SEGMENT_BOOLEAN_OPERATORS = ['equals', 'is_set', 'is_empty'] as const;
export type SegmentBooleanOperator = (typeof SEGMENT_BOOLEAN_OPERATORS)[number];

/** Union of every operator literal — useful for UI pickers. */
export const SEGMENT_ALL_OPERATORS = Array.from(
  new Set([
    ...SEGMENT_TEXT_OPERATORS,
    ...SEGMENT_ENUM_OPERATORS,
    ...SEGMENT_DATE_OPERATORS,
    ...SEGMENT_TAG_OPERATORS,
    ...SEGMENT_NUMBER_OPERATORS,
    ...SEGMENT_BOOLEAN_OPERATORS,
  ]),
) as readonly string[];

// ---------------------------------------------------------------------------
// Primitive condition schemas
// ---------------------------------------------------------------------------

const textConditionSchema = z.object({
  kind: z.literal('condition'),
  field: z.enum(SEGMENT_TEXT_FIELDS),
  operator: z.enum(SEGMENT_TEXT_OPERATORS),
  value: z.string().trim().max(200).optional(),
});

const enumConditionSchema = z.object({
  kind: z.literal('condition'),
  field: z.enum(SEGMENT_ENUM_FIELDS),
  operator: z.enum(SEGMENT_ENUM_OPERATORS),
  value: z.union([
    subscriptionStatusSchema,
    contactSourceSchema,
    // `in` / `not_in` pass arrays. We don't know which enum until we see
    // the field, so accept either set and let the compiler cross-check.
    z.array(subscriptionStatusSchema).max(20),
    z.array(contactSourceSchema).max(20),
  ]),
});

const dateConditionSchema = z.object({
  kind: z.literal('condition'),
  field: z.enum(SEGMENT_DATE_FIELDS),
  operator: z.enum(SEGMENT_DATE_OPERATORS),
  // within_last_days: positive int; before/after: ISO date string.
  value: z.union([z.number().int().positive().max(3650), z.string()]).optional(),
});

const tagConditionSchema = z.object({
  kind: z.literal('condition'),
  field: z.literal(SEGMENT_TAG_FIELD),
  operator: z.enum(SEGMENT_TAG_OPERATORS),
  value: cuidSchema,
});

/**
 * Custom-field condition. Value + operator validity depends on the
 * referenced CustomField's `type`, which the *compiler* cross-checks
 * against the registry. Here we just enforce shape.
 */
const customFieldConditionSchema = z.object({
  kind: z.literal('condition'),
  field: z
    .string()
    .regex(
      customFieldRefRegex,
      'Custom field reference must look like "custom_field:<cuid>".',
    ),
  operator: z.enum([
    ...SEGMENT_TEXT_OPERATORS,
    ...SEGMENT_NUMBER_OPERATORS,
    ...SEGMENT_DATE_OPERATORS,
    ...SEGMENT_BOOLEAN_OPERATORS,
  ]),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])
    .optional(),
});

/**
 * A single condition. Accepts any of the field-shape variants above; we
 * can't use a discriminated union on `field` because custom-field refs
 * have a prefix, not a literal.
 */
export const segmentConditionSchema = z.union([
  textConditionSchema,
  enumConditionSchema,
  dateConditionSchema,
  tagConditionSchema,
  customFieldConditionSchema,
]);
export type SegmentCondition = z.infer<typeof segmentConditionSchema>;

// ---------------------------------------------------------------------------
// Recursive rule tree
// ---------------------------------------------------------------------------

/** A group is AND/OR over 1..n child rules (conditions or nested groups). */
export type SegmentGroup = {
  kind: 'group';
  operator: 'AND' | 'OR';
  children: SegmentRule[];
};

export type SegmentRule = SegmentGroup | SegmentCondition;

/**
 * Explicit recursive schema — Zod needs `z.lazy` for self-referential types.
 * We cap the tree at 3 levels and 30 total leaves to keep the Prisma query
 * it compiles to reasonable.
 */
export const segmentRuleSchema: z.ZodType<SegmentRule> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal('group'),
      operator: z.enum(['AND', 'OR']),
      children: z.array(segmentRuleSchema).min(1).max(20),
    }),
    segmentConditionSchema,
  ]),
);

/**
 * Top-level schema — the thing we store in `Segment.rules`. Must be a
 * group (single condition segments are still `{ kind: 'group', children: [cond] }`)
 * so the rule builder UI always has a container to render into.
 */
export const segmentRulesSchema = z
  .object({
    kind: z.literal('group'),
    operator: z.enum(['AND', 'OR']),
    children: z.array(segmentRuleSchema).min(1).max(20),
  })
  .superRefine((root, ctx) => {
    const { depth, leaves } = measure(root);
    if (depth > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Rule groups cannot be nested more than 3 levels deep.',
        path: [],
      });
    }
    if (leaves > 30) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Too many conditions (${leaves}). Split this into multiple segments.`,
        path: [],
      });
    }
  });
export type SegmentRules = z.infer<typeof segmentRulesSchema>;

function measure(rule: SegmentRule): { depth: number; leaves: number } {
  if (rule.kind === 'condition') return { depth: 1, leaves: 1 };
  let maxChildDepth = 0;
  let leafSum = 0;
  for (const child of rule.children) {
    const m = measure(child);
    maxChildDepth = Math.max(maxChildDepth, m.depth);
    leafSum += m.leaves;
  }
  return { depth: maxChildDepth + 1, leaves: leafSum };
}

// ---------------------------------------------------------------------------
// CRUD input schemas
// ---------------------------------------------------------------------------

export const segmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
  rules: segmentRulesSchema,
});
export type SegmentCreateInput = z.infer<typeof segmentCreateSchema>;

export const segmentUpdateSchema = z.object({
  id: cuidSchema,
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(400).optional().nullable(),
  rules: segmentRulesSchema.optional(),
});
export type SegmentUpdateInput = z.infer<typeof segmentUpdateSchema>;

export const segmentListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: cuidSchema.optional(),
});
export type SegmentListInput = z.infer<typeof segmentListInputSchema>;

/**
 * Used by the rule builder's "Preview" button — compile + count +
 * return a small sample without persisting a Segment row.
 */
export const segmentPreviewSchema = z.object({
  rules: segmentRulesSchema,
  sampleSize: z.number().int().min(0).max(25).default(10),
});
export type SegmentPreviewInput = z.infer<typeof segmentPreviewSchema>;
