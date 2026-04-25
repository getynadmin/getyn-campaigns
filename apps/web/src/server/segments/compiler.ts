import type { Prisma } from '@getyn/db';
import {
  SEGMENT_DATE_FIELDS,
  SEGMENT_ENUM_FIELDS,
  SEGMENT_TEXT_FIELDS,
  type SegmentCondition,
  type SegmentRule,
  type SegmentRules,
} from '@getyn/types';

/**
 * Compile a validated segment rule tree into a Prisma `ContactWhereInput`.
 *
 * Callers must pass the tenant's CustomField registry (id → key, type).
 * The compiler uses it to:
 *   (a) translate `custom_field:{id}` fields to JSON-path filters keyed by
 *       the field's current `key` — renaming a key keeps segments working.
 *   (b) reject operator/value combinations the field type doesn't support.
 *
 * The compiler never touches the database itself; it's pure so it's cheap
 * to unit-test and safe to run on stale rule trees (the caller is
 * responsible for validating shape via `segmentRulesSchema` first).
 *
 * Prisma's JSON `path` filter is Postgres-only — fine here since our
 * datasource is Postgres end-to-end.
 */

export type SegmentCustomFieldEntry = {
  id: string;
  key: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
};

export type CompileContext = {
  /** Seeded from a `customField.findMany` query before compile. */
  customFields: readonly SegmentCustomFieldEntry[];
  /** Used to evaluate `within_last_days` deterministically in tests. */
  now?: Date;
};

export class SegmentCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentCompileError';
  }
}

/**
 * Entry point. Compiles the root group into a WhereInput fragment. The
 * caller is responsible for ANDing the result with `{ tenantId, deletedAt: null }`
 * — the compiler deliberately ignores tenancy so it's reusable.
 */
export function compileSegmentRules(
  rules: SegmentRules,
  ctx: CompileContext,
): Prisma.ContactWhereInput {
  return compileRule(rules, ctx);
}

function compileRule(
  rule: SegmentRule,
  ctx: CompileContext,
): Prisma.ContactWhereInput {
  if (rule.kind === 'group') {
    const compiled = rule.children.map((c) => compileRule(c, ctx));
    if (rule.operator === 'AND') return { AND: compiled };
    return { OR: compiled };
  }
  return compileCondition(rule, ctx);
}

// ===========================================================================
// Condition compiler — dispatches on field category
// ===========================================================================

function compileCondition(
  cond: SegmentCondition,
  ctx: CompileContext,
): Prisma.ContactWhereInput {
  // Custom fields first — prefix match.
  if (cond.field.startsWith('custom_field:')) {
    return compileCustomFieldCondition(cond, ctx);
  }
  if (cond.field === 'tag') {
    return compileTagCondition(cond);
  }
  if ((SEGMENT_TEXT_FIELDS as readonly string[]).includes(cond.field)) {
    return compileTextCondition(cond);
  }
  if ((SEGMENT_ENUM_FIELDS as readonly string[]).includes(cond.field)) {
    return compileEnumCondition(cond);
  }
  if ((SEGMENT_DATE_FIELDS as readonly string[]).includes(cond.field)) {
    return compileDateCondition(cond, ctx);
  }
  throw new SegmentCompileError(`Unknown segment field: ${cond.field}`);
}

// ---------------------------------------------------------------------------
// Text fields (email, phone, first_name, last_name, language, timezone)
// ---------------------------------------------------------------------------

const TEXT_FIELD_COLUMN: Record<string, keyof Prisma.ContactWhereInput> = {
  email: 'email',
  phone: 'phone',
  first_name: 'firstName',
  last_name: 'lastName',
  language: 'language',
  timezone: 'timezone',
};

function compileTextCondition(
  cond: SegmentCondition,
): Prisma.ContactWhereInput {
  const column = TEXT_FIELD_COLUMN[cond.field];
  if (!column) {
    throw new SegmentCompileError(`Unknown text field: ${cond.field}`);
  }

  const value = cond.value;
  switch (cond.operator) {
    case 'equals':
      if (typeof value !== 'string') {
        throw new SegmentCompileError(`${cond.field} equals requires a string value.`);
      }
      return { [column]: value } as Prisma.ContactWhereInput;
    case 'not_equals':
      if (typeof value !== 'string') {
        throw new SegmentCompileError(`${cond.field} not_equals requires a string value.`);
      }
      return { NOT: { [column]: value } } as Prisma.ContactWhereInput;
    case 'contains':
      if (typeof value !== 'string') {
        throw new SegmentCompileError(`${cond.field} contains requires a string value.`);
      }
      return {
        [column]: { contains: value, mode: 'insensitive' },
      } as Prisma.ContactWhereInput;
    case 'not_contains':
      if (typeof value !== 'string') {
        throw new SegmentCompileError(`${cond.field} not_contains requires a string value.`);
      }
      return {
        NOT: { [column]: { contains: value, mode: 'insensitive' } },
      } as Prisma.ContactWhereInput;
    case 'is_set':
      return { [column]: { not: null } } as Prisma.ContactWhereInput;
    case 'is_empty':
      return { [column]: null } as Prisma.ContactWhereInput;
    default:
      throw new SegmentCompileError(
        `Operator ${cond.operator} not supported for text field ${cond.field}.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Enum fields (email_status, sms_status, whatsapp_status, source)
// ---------------------------------------------------------------------------

const ENUM_FIELD_COLUMN: Record<string, keyof Prisma.ContactWhereInput> = {
  email_status: 'emailStatus',
  sms_status: 'smsStatus',
  whatsapp_status: 'whatsappStatus',
  source: 'source',
};

function compileEnumCondition(
  cond: SegmentCondition,
): Prisma.ContactWhereInput {
  const column = ENUM_FIELD_COLUMN[cond.field];
  if (!column) {
    throw new SegmentCompileError(`Unknown enum field: ${cond.field}`);
  }

  switch (cond.operator) {
    case 'equals':
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError(`${cond.field} equals requires a string value.`);
      }
      return { [column]: cond.value } as Prisma.ContactWhereInput;
    case 'not_equals':
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError(
          `${cond.field} not_equals requires a string value.`,
        );
      }
      return { NOT: { [column]: cond.value } } as Prisma.ContactWhereInput;
    case 'in':
      if (!Array.isArray(cond.value) || cond.value.length === 0) {
        throw new SegmentCompileError(
          `${cond.field} in requires a non-empty array.`,
        );
      }
      return { [column]: { in: cond.value } } as Prisma.ContactWhereInput;
    case 'not_in':
      if (!Array.isArray(cond.value) || cond.value.length === 0) {
        throw new SegmentCompileError(
          `${cond.field} not_in requires a non-empty array.`,
        );
      }
      return {
        NOT: { [column]: { in: cond.value } },
      } as Prisma.ContactWhereInput;
    default:
      throw new SegmentCompileError(
        `Operator ${cond.operator} not supported for enum field ${cond.field}.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Date fields (created_at, updated_at)
// ---------------------------------------------------------------------------

const DATE_FIELD_COLUMN: Record<string, keyof Prisma.ContactWhereInput> = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

function compileDateCondition(
  cond: SegmentCondition,
  ctx: CompileContext,
): Prisma.ContactWhereInput {
  const column = DATE_FIELD_COLUMN[cond.field];
  if (!column) {
    throw new SegmentCompileError(`Unknown date field: ${cond.field}`);
  }

  const now = ctx.now ?? new Date();

  switch (cond.operator) {
    case 'within_last_days': {
      if (typeof cond.value !== 'number' || !Number.isFinite(cond.value)) {
        throw new SegmentCompileError(
          `${cond.field} within_last_days requires a number.`,
        );
      }
      const threshold = new Date(now.getTime() - cond.value * 86_400_000);
      return { [column]: { gte: threshold } } as Prisma.ContactWhereInput;
    }
    case 'before': {
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError(`${cond.field} before requires an ISO date string.`);
      }
      const d = new Date(cond.value);
      if (Number.isNaN(d.getTime())) {
        throw new SegmentCompileError(`${cond.field} before: invalid date.`);
      }
      return { [column]: { lt: d } } as Prisma.ContactWhereInput;
    }
    case 'after': {
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError(`${cond.field} after requires an ISO date string.`);
      }
      const d = new Date(cond.value);
      if (Number.isNaN(d.getTime())) {
        throw new SegmentCompileError(`${cond.field} after: invalid date.`);
      }
      return { [column]: { gt: d } } as Prisma.ContactWhereInput;
    }
    case 'is_set':
      return { [column]: { not: null } } as Prisma.ContactWhereInput;
    case 'is_empty':
      // Contact timestamps are `@default(now())` / `@updatedAt` — never null.
      // We honour the operator for symmetry but it'll always match no rows.
      return { [column]: null } as unknown as Prisma.ContactWhereInput;
    default:
      throw new SegmentCompileError(
        `Operator ${cond.operator} not supported for date field ${cond.field}.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Tag pseudo-field
// ---------------------------------------------------------------------------

function compileTagCondition(
  cond: SegmentCondition,
): Prisma.ContactWhereInput {
  if (typeof cond.value !== 'string') {
    throw new SegmentCompileError('tag conditions require a tag id value.');
  }
  switch (cond.operator) {
    case 'equals':
      return { tags: { some: { tagId: cond.value } } };
    case 'not_equals':
      return { tags: { none: { tagId: cond.value } } };
    default:
      throw new SegmentCompileError(
        `Operator ${cond.operator} not supported for tag.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Custom fields — translate id → key and build a JSON-path filter
// ---------------------------------------------------------------------------

function compileCustomFieldCondition(
  cond: SegmentCondition,
  ctx: CompileContext,
): Prisma.ContactWhereInput {
  const id = cond.field.slice('custom_field:'.length);
  const def = ctx.customFields.find((f) => f.id === id);
  if (!def) {
    throw new SegmentCompileError(
      `Custom field ${id} no longer exists. Edit the segment to remove it.`,
    );
  }
  const { key, type } = def;

  // Shape once — the JSON-path filter takes the column name, path, and a
  // filter object. Prisma's type for this column is `JsonFilter`.
  const pathFilter = (filter: Record<string, unknown>): Prisma.ContactWhereInput => {
    return {
      customFields: {
        path: [key],
        ...filter,
      } as unknown as Prisma.JsonFilter<'Contact'>,
    };
  };

  switch (cond.operator) {
    case 'equals': {
      assertCoercibleForType(type, cond.value);
      return pathFilter({ equals: cond.value });
    }
    case 'not_equals': {
      assertCoercibleForType(type, cond.value);
      return { NOT: pathFilter({ equals: cond.value }) };
    }
    case 'contains': {
      if (type !== 'TEXT' && type !== 'SELECT') {
        throw new SegmentCompileError(`contains is only valid on TEXT/SELECT fields.`);
      }
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError('contains requires a string value.');
      }
      return pathFilter({ string_contains: cond.value });
    }
    case 'not_contains': {
      if (type !== 'TEXT' && type !== 'SELECT') {
        throw new SegmentCompileError(`not_contains is only valid on TEXT/SELECT fields.`);
      }
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError('not_contains requires a string value.');
      }
      return { NOT: pathFilter({ string_contains: cond.value }) };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (type !== 'NUMBER') {
        throw new SegmentCompileError(
          `${cond.operator} is only valid on NUMBER fields.`,
        );
      }
      if (typeof cond.value !== 'number') {
        throw new SegmentCompileError(`${cond.operator} requires a numeric value.`);
      }
      return pathFilter({ [cond.operator]: cond.value });
    }
    case 'within_last_days': {
      if (type !== 'DATE') {
        throw new SegmentCompileError('within_last_days is only valid on DATE fields.');
      }
      if (typeof cond.value !== 'number') {
        throw new SegmentCompileError('within_last_days requires a number.');
      }
      const now = ctx.now ?? new Date();
      const thresholdIso = new Date(
        now.getTime() - cond.value * 86_400_000,
      ).toISOString();
      // ISO strings sort chronologically — gte against threshold is correct.
      return pathFilter({ gte: thresholdIso });
    }
    case 'before': {
      if (type !== 'DATE') {
        throw new SegmentCompileError('before is only valid on DATE fields.');
      }
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError('before requires an ISO date string.');
      }
      return pathFilter({ lt: cond.value });
    }
    case 'after': {
      if (type !== 'DATE') {
        throw new SegmentCompileError('after is only valid on DATE fields.');
      }
      if (typeof cond.value !== 'string') {
        throw new SegmentCompileError('after requires an ISO date string.');
      }
      return pathFilter({ gt: cond.value });
    }
    case 'is_set':
      // JSON path `not: null` — matches any defined value on that key.
      return pathFilter({ not: null as never });
    case 'is_empty':
      return pathFilter({ equals: null as never });
    default:
      throw new SegmentCompileError(
        `Operator ${cond.operator} not supported on custom field ${key}.`,
      );
  }
}

function assertCoercibleForType(
  type: SegmentCustomFieldEntry['type'],
  value: unknown,
): void {
  const bad = (expected: string): never => {
    throw new SegmentCompileError(`Value must be ${expected} for this field.`);
  };
  switch (type) {
    case 'TEXT':
    case 'SELECT':
      if (typeof value !== 'string') bad('a string');
      return;
    case 'NUMBER':
      if (typeof value !== 'number') bad('a number');
      return;
    case 'BOOLEAN':
      if (typeof value !== 'boolean') bad('true or false');
      return;
    case 'DATE':
      if (typeof value !== 'string') bad('an ISO date string');
      return;
  }
}
