'use client';

import { Plus, Trash2 } from 'lucide-react';

import type { SegmentCondition, SegmentRule, SegmentRules } from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import {
  OPERATOR_LABELS,
  OPERATORS_BY_KIND,
  SOURCE_CHOICES,
  STATUS_CHOICES,
  VALUELESS_OPERATORS,
  type BuilderFieldKind,
  type BuilderFieldOption,
} from './field-catalog';

/**
 * Nested rule builder.
 *
 * The component is a controlled input over the full `SegmentRules` value so
 * the parent page can pass it to `segmentRulesSchema` + the `preview` query
 * without an intermediate "is dirty" step. We deliberately don't normalise
 * the value on every change — the builder can temporarily hold partially
 * filled conditions (e.g. an operator selected but no value yet) and the
 * parent decides when to validate.
 *
 * Nesting cap: we allow up to 3 levels (enforced by the Zod schema). The
 * "Add group" button disappears at depth 3 so the user doesn't build an
 * invalid tree in the first place.
 */

const MAX_DEPTH = 3;

type TagOption = { id: string; name: string };

export type RuleBuilderProps = {
  value: SegmentRules;
  onChange: (v: SegmentRules) => void;
  catalog: BuilderFieldOption[];
  tags: TagOption[];
};

export function RuleBuilder({
  value,
  onChange,
  catalog,
  tags,
}: RuleBuilderProps): JSX.Element {
  return (
    <GroupNode
      group={value}
      depth={1}
      onChange={(g) => onChange(g)}
      onRemove={null}
      catalog={catalog}
      tags={tags}
    />
  );
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

function GroupNode({
  group,
  depth,
  onChange,
  onRemove,
  catalog,
  tags,
}: {
  group: Extract<SegmentRule, { kind: 'group' }>;
  depth: number;
  onChange: (g: Extract<SegmentRule, { kind: 'group' }>) => void;
  onRemove: (() => void) | null;
  catalog: BuilderFieldOption[];
  tags: TagOption[];
}): JSX.Element {
  const addCondition = (): void => {
    const first = catalog[0];
    if (!first) return;
    const cond = defaultConditionFor(first);
    onChange({ ...group, children: [...group.children, cond] });
  };

  const addGroup = (): void => {
    const first = catalog[0];
    if (!first) return;
    onChange({
      ...group,
      children: [
        ...group.children,
        {
          kind: 'group',
          operator: 'AND',
          children: [defaultConditionFor(first)],
        },
      ],
    });
  };

  const updateChild = (idx: number, child: SegmentRule): void => {
    const next = group.children.slice();
    next[idx] = child;
    onChange({ ...group, children: next });
  };

  const removeChild = (idx: number): void => {
    const next = group.children.filter((_, i) => i !== idx);
    // Disallow empty groups — schema rejects them. Remove the whole group
    // instead when the user drops the last child.
    if (next.length === 0 && onRemove) {
      onRemove();
      return;
    }
    if (next.length === 0) {
      // Root group: re-seed with a default condition so the UI stays usable.
      const first = catalog[0];
      if (first) {
        onChange({ ...group, children: [defaultConditionFor(first)] });
      }
      return;
    }
    onChange({ ...group, children: next });
  };

  return (
    <div
      className={cn(
        'rounded-lg border bg-card/50 p-3',
        depth > 1 && 'bg-muted/30',
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Match
        </span>
        <Select
          value={group.operator}
          onValueChange={(v) =>
            onChange({ ...group, operator: v as 'AND' | 'OR' })
          }
        >
          <SelectTrigger className="h-8 w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">ALL</SelectItem>
            <SelectItem value="OR">ANY</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          of the following
        </span>
        <div className="ml-auto">
          {onRemove ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground"
              onClick={onRemove}
            >
              <Trash2 className="mr-1 size-3.5" />
              Remove group
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {group.children.map((child, i) => {
          if (child.kind === 'group') {
            return (
              <GroupNode
                key={i}
                group={child}
                depth={depth + 1}
                onChange={(g) => updateChild(i, g)}
                onRemove={() => removeChild(i)}
                catalog={catalog}
                tags={tags}
              />
            );
          }
          return (
            <ConditionRow
              key={i}
              condition={child}
              onChange={(c) => updateChild(i, c)}
              onRemove={() => removeChild(i)}
              catalog={catalog}
              tags={tags}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addCondition}>
          <Plus className="mr-1 size-3.5" />
          Add condition
        </Button>
        {depth < MAX_DEPTH ? (
          <Button variant="outline" size="sm" onClick={addGroup}>
            <Plus className="mr-1 size-3.5" />
            Add group
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Condition row
// ---------------------------------------------------------------------------

function ConditionRow({
  condition,
  onChange,
  onRemove,
  catalog,
  tags,
}: {
  condition: SegmentCondition;
  onChange: (c: SegmentCondition) => void;
  onRemove: () => void;
  catalog: BuilderFieldOption[];
  tags: TagOption[];
}): JSX.Element {
  const option = catalog.find((o) => o.id === condition.field);
  const operators = option ? OPERATORS_BY_KIND[option.kind] : [];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
      {/* Field */}
      <Select
        value={condition.field}
        onValueChange={(newField) => {
          const next = catalog.find((o) => o.id === newField);
          if (!next) return;
          onChange(defaultConditionFor(next));
        }}
      >
        <SelectTrigger className="h-8 w-[200px]">
          <SelectValue
            placeholder={option ? undefined : 'Missing field'}
          />
        </SelectTrigger>
        <SelectContent>
          {catalog.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Operator */}
      <Select
        value={condition.operator}
        onValueChange={(newOp) => {
          if (!option) return;
          onChange(
            coerceConditionForOperator(condition, option, newOp as string),
          );
        }}
        disabled={!option}
      >
        <SelectTrigger className="h-8 w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op} value={op}>
              {OPERATOR_LABELS[op] ?? op}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value */}
      <div className="min-w-[180px] flex-1">
        {option ? (
          <ValueEditor
            option={option}
            operator={condition.operator}
            value={condition.value}
            onChange={(v) => onChange({ ...condition, value: v } as SegmentCondition)}
            tags={tags}
          />
        ) : null}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-muted-foreground"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value editor
// ---------------------------------------------------------------------------

function ValueEditor({
  option,
  operator,
  value,
  onChange,
  tags,
}: {
  option: BuilderFieldOption;
  operator: string;
  value: SegmentCondition['value'];
  onChange: (v: SegmentCondition['value']) => void;
  tags: TagOption[];
}): JSX.Element | null {
  if (VALUELESS_OPERATORS.has(operator)) return null;

  // `in` / `not_in` for enum fields — multi-select.
  if (operator === 'in' || operator === 'not_in') {
    const choices =
      option.kind === 'enum-status'
        ? (STATUS_CHOICES as readonly string[])
        : option.kind === 'enum-source'
          ? (SOURCE_CHOICES as readonly string[])
          : [];
    return (
      <MultiCheckboxRow
        choices={choices}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
      />
    );
  }

  switch (option.kind) {
    case 'text':
    case 'custom-text':
      return (
        <Input
          className="h-8"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Value"
        />
      );

    case 'enum-status':
      return (
        <SingleSelect
          choices={STATUS_CHOICES as readonly string[]}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
    case 'enum-source':
      return (
        <SingleSelect
          choices={SOURCE_CHOICES as readonly string[]}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );

    case 'date':
    case 'custom-date':
      if (operator === 'within_last_days') {
        return (
          <Input
            className="h-8"
            type="number"
            min={1}
            max={3650}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(Number(e.target.value))}
            placeholder="Days"
          />
        );
      }
      return (
        <Input
          className="h-8"
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => {
            // Store as ISO start-of-day UTC so the compiler's `new Date(value)`
            // gets a deterministic instant regardless of the viewer's tz.
            const v = e.target.value
              ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString()
              : '';
            onChange(v);
          }}
        />
      );

    case 'tag':
      return (
        <SingleSelect
          choices={tags.map((t) => t.id)}
          labels={Object.fromEntries(tags.map((t) => [t.id, t.name]))}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          placeholder={tags.length === 0 ? 'No tags yet' : 'Select tag'}
        />
      );

    case 'custom-number':
      return (
        <Input
          className="h-8"
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) =>
            onChange(e.target.value === '' ? null : Number(e.target.value))
          }
          placeholder="Number"
        />
      );

    case 'custom-boolean':
      return (
        <SingleSelect
          choices={['true', 'false']}
          labels={{ true: 'True', false: 'False' }}
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(v) => onChange(v === 'true')}
        />
      );

    case 'custom-select':
      return (
        <SingleSelect
          choices={option.options ?? []}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          placeholder={
            (option.options ?? []).length === 0
              ? 'No choices configured'
              : 'Select'
          }
        />
      );
  }
}

function SingleSelect({
  choices,
  value,
  onChange,
  labels,
  placeholder,
}: {
  choices: readonly string[];
  value: string;
  onChange: (v: string) => void;
  labels?: Record<string, string>;
  placeholder?: string;
}): JSX.Element {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="h-8">
        <SelectValue placeholder={placeholder ?? 'Select'} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c} value={c}>
            {labels?.[c] ?? c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiCheckboxRow({
  choices,
  value,
  onChange,
}: {
  choices: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}): JSX.Element {
  const toggle = (c: string): void => {
    onChange(value.includes(c) ? value.filter((v) => v !== c) : [...value, c]);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {choices.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            className={cn(
              'rounded-md border px-2 py-1 text-xs transition-colors',
              on
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defaults — what we seed a new condition with when a field is picked
// ---------------------------------------------------------------------------

function defaultConditionFor(option: BuilderFieldOption): SegmentCondition {
  // Every kind in OPERATORS_BY_KIND has at least one operator, but TS's
  // `noUncheckedIndexedAccess` forces us to narrow here.
  const firstOp = OPERATORS_BY_KIND[option.kind][0] ?? 'equals';
  return buildConditionShell(option, firstOp);
}

function coerceConditionForOperator(
  existing: SegmentCondition,
  option: BuilderFieldOption,
  newOp: string,
): SegmentCondition {
  // Clear the value if switching between operators with incompatible value
  // shapes (scalar → array, string → number, valueless → anything).
  const valueShape = valueShapeFor(option.kind, newOp);
  const existingShape = valueShapeFor(option.kind, existing.operator);
  if (valueShape !== existingShape) {
    return buildConditionShell(option, newOp);
  }
  return { ...existing, operator: newOp } as SegmentCondition;
}

function valueShapeFor(kind: BuilderFieldKind, op: string): string {
  if (VALUELESS_OPERATORS.has(op)) return 'none';
  if (op === 'in' || op === 'not_in') return 'array';
  if (op === 'within_last_days') return 'number';
  if (kind === 'custom-number' && ['gt', 'gte', 'lt', 'lte'].includes(op)) {
    return 'number';
  }
  if (kind === 'custom-boolean') return 'boolean';
  return 'string';
}

function buildConditionShell(
  option: BuilderFieldOption,
  operator: string,
): SegmentCondition {
  const base = { kind: 'condition' as const, field: option.id, operator };
  const shape = valueShapeFor(option.kind, operator);
  switch (shape) {
    case 'none':
      // Still set a value field to undefined so TS keeps the shape consistent.
      return base as unknown as SegmentCondition;
    case 'array':
      return { ...base, value: [] } as unknown as SegmentCondition;
    case 'number':
      return { ...base, value: 1 } as unknown as SegmentCondition;
    case 'boolean':
      return { ...base, value: true } as unknown as SegmentCondition;
    default:
      return { ...base, value: '' } as unknown as SegmentCondition;
  }
}
