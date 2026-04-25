import type { CustomFieldTypeValue } from '@getyn/types';

/**
 * Catalog of everything the rule builder's "field" dropdown can render.
 *
 * Keeping this in one place (rather than inlining per-group) means the
 * builder can:
 *   - render category-grouped field pickers,
 *   - look up `kind` + value-shape purely from the selected field id,
 *   - resolve custom fields by id (so renaming a CustomField key doesn't
 *     break the UI) without the component needing to know about Prisma.
 *
 * The rule-tree wire format is snake_case (matches the Zod schema); we keep
 * that here. Labels are UI-only.
 */

export type BuilderFieldKind =
  | 'text'
  | 'enum-status'
  | 'enum-source'
  | 'date'
  | 'tag'
  | 'custom-text'
  | 'custom-number'
  | 'custom-date'
  | 'custom-boolean'
  | 'custom-select';

export type BuilderFieldOption = {
  /** Wire value — e.g. `email`, `email_status`, `custom_field:ck…` */
  id: string;
  label: string;
  kind: BuilderFieldKind;
  /** For SELECT custom fields — used by the value picker. */
  options?: string[];
};

export const CONTACT_TEXT_FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  first_name: 'First name',
  last_name: 'Last name',
  language: 'Language',
  timezone: 'Timezone',
};

export const CONTACT_ENUM_FIELD_LABELS: Record<string, string> = {
  email_status: 'Email status',
  sms_status: 'SMS status',
  whatsapp_status: 'WhatsApp status',
  source: 'Source',
};

export const CONTACT_DATE_FIELD_LABELS: Record<string, string> = {
  created_at: 'Added to workspace',
  updated_at: 'Last updated',
};

export function buildFieldCatalog(args: {
  customFields: Array<{
    id: string;
    key: string;
    label: string;
    type: CustomFieldTypeValue;
    options?: { choices?: string[] } | null;
  }>;
}): BuilderFieldOption[] {
  const catalog: BuilderFieldOption[] = [];

  for (const [id, label] of Object.entries(CONTACT_TEXT_FIELD_LABELS)) {
    catalog.push({ id, label, kind: 'text' });
  }
  for (const [id, label] of Object.entries(CONTACT_ENUM_FIELD_LABELS)) {
    catalog.push({
      id,
      label,
      kind: id === 'source' ? 'enum-source' : 'enum-status',
    });
  }
  for (const [id, label] of Object.entries(CONTACT_DATE_FIELD_LABELS)) {
    catalog.push({ id, label, kind: 'date' });
  }
  catalog.push({ id: 'tag', label: 'Tag', kind: 'tag' });

  for (const f of args.customFields) {
    const prefix = `custom_field:${f.id}`;
    switch (f.type) {
      case 'TEXT':
        catalog.push({ id: prefix, label: f.label, kind: 'custom-text' });
        break;
      case 'NUMBER':
        catalog.push({ id: prefix, label: f.label, kind: 'custom-number' });
        break;
      case 'DATE':
        catalog.push({ id: prefix, label: f.label, kind: 'custom-date' });
        break;
      case 'BOOLEAN':
        catalog.push({ id: prefix, label: f.label, kind: 'custom-boolean' });
        break;
      case 'SELECT':
        catalog.push({
          id: prefix,
          label: f.label,
          kind: 'custom-select',
          options: f.options?.choices ?? [],
        });
        break;
    }
  }

  return catalog;
}

/**
 * Per-kind operator menus. We list the subset the compiler actually handles
 * for that kind so the builder can't assemble an invalid combination that
 * the server would then reject.
 */
export const OPERATOR_LABELS: Record<string, string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: "doesn't contain",
  in: 'is any of',
  not_in: 'is none of',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  within_last_days: 'in the last (days)',
  before: 'is before',
  after: 'is after',
  is_set: 'is set',
  is_empty: 'is empty',
};

export const OPERATORS_BY_KIND: Record<BuilderFieldKind, string[]> = {
  text: ['equals', 'not_equals', 'contains', 'not_contains', 'is_set', 'is_empty'],
  'enum-status': ['equals', 'not_equals', 'in', 'not_in'],
  'enum-source': ['equals', 'not_equals', 'in', 'not_in'],
  date: ['within_last_days', 'before', 'after', 'is_set', 'is_empty'],
  tag: ['equals', 'not_equals'],
  'custom-text': ['equals', 'not_equals', 'contains', 'not_contains', 'is_set', 'is_empty'],
  'custom-number': ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_empty'],
  'custom-date': ['within_last_days', 'before', 'after', 'is_set', 'is_empty'],
  'custom-boolean': ['equals', 'is_set', 'is_empty'],
  'custom-select': ['equals', 'not_equals', 'is_set', 'is_empty'],
};

/** Operators that don't take a value input. */
export const VALUELESS_OPERATORS = new Set(['is_set', 'is_empty']);

export const STATUS_CHOICES = [
  'SUBSCRIBED',
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINED',
  'PENDING',
] as const;

export const SOURCE_CHOICES = ['MANUAL', 'IMPORT', 'API', 'FORM'] as const;
