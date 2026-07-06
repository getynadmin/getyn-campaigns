'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Bell,
  Clock,
  GitBranch,
  Mail,
  MessageCircle,
  Play,
  Settings,
  Square,
  Tag,
  UserCog,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Custom node renderers for the drip builder.
 *
 * Every card follows the same chrome: rounded rectangle, icon,
 * label, optional subtitle (config summary), optional Draft/Live
 * pill on message nodes, and a "Day X" counter footer (set by the
 * builder in node.data.__dayLabel — see day-counter.ts).
 *
 * Handles: every node has an input handle on top (except Trigger)
 * and an output handle on bottom (except Exit). Split nodes have
 * two output handles (yes/no).
 */

type Common = {
  label?: string;
  __dayLabel?: string;
  __hasError?: string; // set by client-side validator
};

// -----------------------------------------------------------------
// Shared card chrome
// -----------------------------------------------------------------

function Card({
  icon,
  title,
  subtitle,
  status,
  selected,
  dayLabel,
  errorHint,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  status?: 'DRAFT' | 'LIVE';
  selected?: boolean;
  dayLabel?: string;
  errorHint?: string;
  tone?: 'neutral' | 'trigger' | 'exit' | 'message' | 'data' | 'logic';
}): JSX.Element {
  const toneStyles: Record<string, string> = {
    neutral: 'border-border bg-card',
    trigger: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40',
    exit: 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40',
    message: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40',
    data: 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40',
    logic: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40',
  };
  return (
    <div
      className={cn(
        'min-w-[220px] rounded-lg border shadow-sm transition-shadow',
        toneStyles[tone],
        selected && 'ring-2 ring-primary ring-offset-1',
        errorHint && 'border-rose-500 dark:border-rose-500',
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="mt-0.5 shrink-0 opacity-80">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{title}</p>
            {status && <StatusPill status={status} />}
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {(dayLabel || errorHint) && (
        <div className="border-t px-3 py-1 text-[10px] text-muted-foreground">
          {errorHint ? (
            <span className="inline-flex items-center gap-1 text-rose-700">
              <AlertTriangle className="size-3" />
              {errorHint}
            </span>
          ) : (
            <span>{dayLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: 'DRAFT' | 'LIVE' }): JSX.Element {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
        status === 'LIVE'
          ? 'bg-emerald-600 text-white'
          : 'bg-amber-500 text-white',
      )}
    >
      {status}
    </span>
  );
}

// -----------------------------------------------------------------
// Individual nodes
// -----------------------------------------------------------------

export function TriggerNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & { trigger?: { kind: string } };
  return (
    <>
      <Card
        icon={<Play className="size-4 text-emerald-700" />}
        title={data.label ?? 'When...'}
        subtitle={triggerSummary(data.trigger?.kind)}
        selected={props.selected}
        tone="trigger"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export function EmailNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & {
    subject?: string;
    status?: 'DRAFT' | 'LIVE';
  };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<Mail className="size-4 text-sky-700" />}
        title={data.label ?? 'Email'}
        subtitle={data.subject || '(no subject set)'}
        status={data.status ?? 'DRAFT'}
        selected={props.selected}
        tone="message"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export function WhatsAppNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & {
    templateId?: string | null;
    status?: 'DRAFT' | 'LIVE';
  };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<MessageCircle className="size-4 text-sky-700" />}
        title={data.label ?? 'WhatsApp'}
        subtitle={
          data.templateId ? 'Template configured' : '(no template selected)'
        }
        status={data.status ?? 'DRAFT'}
        selected={props.selected}
        tone="message"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export function PropertyUpdateNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & {
    action?: string;
    customFieldKey?: string;
  };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<UserCog className="size-4 text-violet-700" />}
        title={data.label ?? 'Update property'}
        subtitle={
          data.customFieldKey
            ? `${data.action ?? 'set'} · ${data.customFieldKey}`
            : '(not configured)'
        }
        selected={props.selected}
        tone="data"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export function ListUpdateNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & { action?: string };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<Tag className="size-4 text-violet-700" />}
        title={data.label ?? 'Update list'}
        subtitle={data.action?.replace(/_/g, ' ') ?? '(not configured)'}
        selected={props.selected}
        tone="data"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export function InternalAlertNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & { channel?: string; target?: string };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<Bell className="size-4 text-violet-700" />}
        title={data.label ?? 'Internal alert'}
        subtitle={
          data.target ? `${data.channel} → ${data.target}` : '(no target set)'
        }
        selected={props.selected}
        tone="data"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export function DelayNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & {
    mode?: string;
    amount?: number;
    unit?: string;
    absoluteAt?: string | null;
  };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<Clock className="size-4 text-amber-700" />}
        title={data.label ?? 'Wait'}
        subtitle={delaySummary(data)}
        selected={props.selected}
        tone="logic"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export function SplitNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & { condition?: { kind: string } };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<GitBranch className="size-4 text-amber-700" />}
        title={data.label ?? 'If / else'}
        subtitle={data.condition?.kind.replace(/_/g, ' ') ?? '(no condition)'}
        selected={props.selected}
        tone="logic"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
      {/* Two output handles: yes (left) / no (right) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{ left: '70%' }}
      />
    </>
  );
}

export function ExitNode(props: NodeProps): JSX.Element {
  const data = props.data as Common & { reason?: string };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<Square className="size-4 text-slate-600" />}
        title={data.label ?? 'End'}
        subtitle={data.reason || null}
        selected={props.selected}
        tone="exit"
        dayLabel={data.__dayLabel}
        errorHint={data.__hasError}
      />
    </>
  );
}

// Fallback for any future node type — renders as a generic card so
// unknown nodes don't crash the canvas.
export function UnknownNode(props: NodeProps): JSX.Element {
  const data = props.data as Common;
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Card
        icon={<Settings className="size-4" />}
        title={data.label ?? 'Unknown node'}
        selected={props.selected}
      />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  email: EmailNode,
  whatsapp: WhatsAppNode,
  property_update: PropertyUpdateNode,
  list_update: ListUpdateNode,
  internal_alert: InternalAlertNode,
  delay: DelayNode,
  split: SplitNode,
  exit: ExitNode,
};

// -----------------------------------------------------------------
// Subtitle helpers
// -----------------------------------------------------------------

function triggerSummary(kind: string | undefined): string {
  switch (kind) {
    case 'manual_enrollment':
      return 'Enrolled manually';
    case 'contact_added_to_segment':
      return 'Contact enters segment';
    case 'tag_applied':
      return 'Tag applied';
    case 'date_field_matches':
      return 'Date field matches';
    case 'webhook':
      return 'Webhook';
    default:
      return '(no trigger set)';
  }
}

function delaySummary(data: {
  mode?: string;
  amount?: number;
  unit?: string;
  absoluteAt?: string | null;
}): string {
  if (data.mode === 'absolute' && data.absoluteAt) {
    return `Until ${new Date(data.absoluteAt).toLocaleString()}`;
  }
  if (data.mode === 'weekday_time') {
    return 'Until specific weekday/time';
  }
  if (data.amount && data.unit) {
    return `Wait ${data.amount} ${data.unit}`;
  }
  return '(not configured)';
}
