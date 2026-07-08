'use client';

import {
  CONTACT_DATE_FIELD_LABELS,
  CONTACT_ENUM_FIELD_LABELS,
  CONTACT_TEXT_FIELD_LABELS,
} from './field-catalog';

/**
 * Human-readable renderer for a segment's rule tree.
 *
 * Given the JSON tree that `segmentRulesSchema` produces, this walks
 * the structure and returns nested lists like:
 *
 *   Match ALL of the following:
 *     • Email status is Subscribed
 *     • Tag includes VIP
 *     Match ANY of the following:
 *       • Language is en
 *       • Language is en-US
 *
 * Field labels come from the field-catalog (system fields) with a
 * fallback map for custom fields passed in via `customFields` (id ⇒
 * key ⇒ label).
 *
 * This does NOT re-validate the rules; callers should have already
 * parsed with segmentRulesSchema. If we get something malformed, the
 * fallback branch renders the raw JSON so operators can still debug.
 */

type CustomFieldEntry = { id: string; key: string; label: string };

interface Group {
  kind: 'group';
  operator: 'AND' | 'OR';
  children: Node[];
}
interface Condition {
  kind: 'condition';
  field: string;
  operator: string;
  value: unknown;
}
type Node = Group | Condition;

export function FormattedSegmentRules({
  rules,
  customFields = [],
}: {
  rules: unknown;
  customFields?: CustomFieldEntry[];
}): JSX.Element {
  if (!isNode(rules)) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        Rules are in an unexpected format. Hit Edit to rebuild them.
      </div>
    );
  }
  return <RenderNode node={rules} customFields={customFields} depth={0} />;
}

function RenderNode({
  node,
  customFields,
  depth,
}: {
  node: Node;
  customFields: CustomFieldEntry[];
  depth: number;
}): JSX.Element {
  if (node.kind === 'group') {
    const label =
      node.operator === 'AND'
        ? 'Match ALL of the following:'
        : 'Match ANY of the following:';
    return (
      <div className={depth === 0 ? '' : 'mt-2'}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <ul className="mt-1 space-y-1 border-l-2 border-muted pl-3">
          {node.children.length === 0 ? (
            <li className="text-xs italic text-muted-foreground">
              (no conditions in this group)
            </li>
          ) : (
            node.children.map((child, i) => (
              <li key={i}>
                <RenderNode
                  node={child}
                  customFields={customFields}
                  depth={depth + 1}
                />
              </li>
            ))
          )}
        </ul>
      </div>
    );
  }
  // condition
  const fieldLabel = describeField(node.field, customFields);
  const { verb, showValue } = describeOperator(node.operator);
  return (
    <p className="text-sm">
      <span className="font-medium">{fieldLabel}</span>{' '}
      <span className="text-muted-foreground">{verb}</span>
      {showValue && (
        <>
          {' '}
          <span className="font-mono text-[13px]">{formatValue(node.value)}</span>
        </>
      )}
    </p>
  );
}

// -----------------------------------------------------------------
// Label lookups
// -----------------------------------------------------------------

function describeField(
  field: string,
  customFields: CustomFieldEntry[],
): string {
  if (CONTACT_TEXT_FIELD_LABELS[field]) return CONTACT_TEXT_FIELD_LABELS[field]!;
  if (CONTACT_ENUM_FIELD_LABELS[field]) return CONTACT_ENUM_FIELD_LABELS[field]!;
  if (CONTACT_DATE_FIELD_LABELS[field]) return CONTACT_DATE_FIELD_LABELS[field]!;
  if (field === 'tag') return 'Tag';
  if (field === 'has_event') return 'Event';
  if (field.startsWith('custom_field:')) {
    const id = field.slice('custom_field:'.length);
    const cf =
      customFields.find((f) => f.id === id) ??
      customFields.find((f) => f.key === id);
    return cf?.label ?? cf?.key ?? `Custom field (${id.slice(0, 8)}…)`;
  }
  // Fallback: humanize snake_case.
  return field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const OPERATOR_LABELS: Record<string, { verb: string; showValue: boolean }> = {
  equals: { verb: 'is', showValue: true },
  not_equals: { verb: "isn't", showValue: true },
  contains: { verb: 'contains', showValue: true },
  not_contains: { verb: "doesn't contain", showValue: true },
  starts_with: { verb: 'starts with', showValue: true },
  ends_with: { verb: 'ends with', showValue: true },
  greater_than: { verb: 'is greater than', showValue: true },
  less_than: { verb: 'is less than', showValue: true },
  is_empty: { verb: 'is empty', showValue: false },
  is_not_empty: { verb: "isn't empty", showValue: false },
  is_set: { verb: 'is set', showValue: false },
  is_not_set: { verb: "isn't set", showValue: false },
  includes: { verb: 'includes', showValue: true },
  excludes: { verb: "doesn't include", showValue: true },
  on: { verb: 'is on', showValue: true },
  before: { verb: 'is before', showValue: true },
  after: { verb: 'is after', showValue: true },
  between: { verb: 'is between', showValue: true },
  in_last_days: { verb: 'is within the last', showValue: true },
  not_in_last_days: { verb: 'is NOT within the last', showValue: true },
};

function describeOperator(op: string): { verb: string; showValue: boolean } {
  return OPERATOR_LABELS[op] ?? { verb: op.replace(/_/g, ' '), showValue: true };
}

function formatValue(value: unknown): string {
  if (value == null) return '""';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  // Humanize enum values like SUBSCRIBED.
  if (/^[A-Z][A-Z0-9_]+$/.test(s)) {
    return s
      .toLowerCase()
      .split('_')
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ');
  }
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

// -----------------------------------------------------------------
// Type guards
// -----------------------------------------------------------------

function isNode(v: unknown): v is Node {
  if (!v || typeof v !== 'object') return false;
  const kind = (v as { kind?: unknown }).kind;
  if (kind !== 'group' && kind !== 'condition') return false;
  return true;
}
