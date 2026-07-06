'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AutomationNode } from '@getyn/types';

/**
 * Right-side properties panel — edits the selected node's `data`.
 *
 * Each node type has its own form. Changes are dispatched back to
 * the builder via `onChange` — the builder merges into the node
 * list, which triggers the autosave debounce.
 *
 * Draft/Live flip on message nodes calls `onFlipStatus` which uses
 * a dedicated tRPC mutation so the M3 engine can hook the LIVE
 * transition (wake paused enrollments).
 */
export function PropertiesPanel({
  node,
  onChange,
  onFlipStatus,
  onDeleteNode,
}: {
  node: AutomationNode | null;
  onChange: (nodeId: string, patch: Partial<AutomationNode['data']>) => void;
  onFlipStatus: (nodeId: string, status: 'DRAFT' | 'LIVE') => void;
  onDeleteNode: (nodeId: string) => void;
}): JSX.Element {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a node to edit its properties.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b p-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {node.type.replace(/_/g, ' ')}
        </p>
        <p className="text-sm font-medium">{node.data.label}</p>
      </div>
      <div className="flex-1 space-y-4 p-3">
        <Field label="Label">
          <Input
            value={node.data.label}
            onChange={(e) => onChange(node.id, { label: e.target.value })}
            maxLength={80}
          />
        </Field>
        {renderPerType(node, onChange, onFlipStatus)}
      </div>
      {node.type !== 'trigger' && node.type !== 'exit' && (
        <div className="border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-rose-700"
            onClick={() => {
              if (confirm('Delete this node?')) onDeleteNode(node.id);
            }}
          >
            Delete node
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function renderPerType(
  node: AutomationNode,
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void,
  onFlipStatus: (id: string, status: 'DRAFT' | 'LIVE') => void,
): JSX.Element | null {
  switch (node.type) {
    case 'trigger':
      return <TriggerForm node={node} onChange={onChange} />;
    case 'email':
      return <EmailForm node={node} onChange={onChange} onFlipStatus={onFlipStatus} />;
    case 'whatsapp':
      return <WhatsAppForm node={node} onChange={onChange} onFlipStatus={onFlipStatus} />;
    case 'property_update':
      return <PropertyUpdateForm node={node} onChange={onChange} />;
    case 'list_update':
      return <ListUpdateForm node={node} onChange={onChange} />;
    case 'internal_alert':
      return <InternalAlertForm node={node} onChange={onChange} />;
    case 'delay':
      return <DelayForm node={node} onChange={onChange} />;
    case 'split':
      return <SplitForm node={node} onChange={onChange} />;
    case 'exit':
      return <ExitForm node={node} onChange={onChange} />;
  }
}

// -----------------------------------------------------------------
// Per-type forms
// -----------------------------------------------------------------

type NodeWithType<T extends AutomationNode['type']> = Extract<AutomationNode, { type: T }>;

function TriggerForm({
  node,
  onChange,
}: {
  node: NodeWithType<'trigger'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
}): JSX.Element {
  const trigger = node.data.trigger;
  return (
    <>
      <Field label="Trigger kind">
        <Select
          value={trigger.kind}
          onValueChange={(v) =>
            onChange(node.id, {
              trigger: buildDefaultTrigger(v),
            } as Partial<AutomationNode['data']>)
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual_enrollment">Manual enrollment</SelectItem>
            <SelectItem value="contact_added_to_segment">Contact added to segment</SelectItem>
            <SelectItem value="tag_applied">Tag applied</SelectItem>
            <SelectItem value="date_field_matches">Date field matches</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {trigger.kind === 'contact_added_to_segment' && (
        <Field label="Segment id" hint="Copy the id from the Segments page.">
          <Input
            value={trigger.segmentId}
            onChange={(e) =>
              onChange(node.id, {
                trigger: { ...trigger, segmentId: e.target.value },
              } as Partial<AutomationNode['data']>)
            }
          />
        </Field>
      )}
      {trigger.kind === 'tag_applied' && (
        <Field label="Tag id">
          <Input
            value={trigger.tagId}
            onChange={(e) =>
              onChange(node.id, {
                trigger: { ...trigger, tagId: e.target.value },
              } as Partial<AutomationNode['data']>)
            }
          />
        </Field>
      )}
      {trigger.kind === 'date_field_matches' && (
        <>
          <Field label="Custom field key">
            <Input
              value={trigger.customFieldKey}
              onChange={(e) =>
                onChange(node.id, {
                  trigger: { ...trigger, customFieldKey: e.target.value },
                } as Partial<AutomationNode['data']>)
              }
            />
          </Field>
          <Field label="Hour of day (UTC)">
            <Input
              type="number"
              min={0}
              max={23}
              value={trigger.hourUtc}
              onChange={(e) =>
                onChange(node.id, {
                  trigger: { ...trigger, hourUtc: Number(e.target.value) },
                } as Partial<AutomationNode['data']>)
              }
            />
          </Field>
        </>
      )}
    </>
  );
}

function buildDefaultTrigger(kind: string): AutomationNode['data'] extends { trigger: infer T } ? T : never {
  switch (kind) {
    case 'contact_added_to_segment':
      return { kind, segmentId: '' } as never;
    case 'tag_applied':
      return { kind, tagId: '' } as never;
    case 'date_field_matches':
      return { kind, customFieldKey: '', match: 'anniversary', hourUtc: 9 } as never;
    case 'webhook':
      return { kind } as never;
    default:
      return { kind: 'manual_enrollment' } as never;
  }
}

function EmailForm({
  node,
  onChange,
  onFlipStatus,
}: {
  node: NodeWithType<'email'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
  onFlipStatus: (id: string, status: 'DRAFT' | 'LIVE') => void;
}): JSX.Element {
  return (
    <>
      <StatusToggle
        status={node.data.status}
        onFlip={(status) => onFlipStatus(node.id, status)}
      />
      <Field label="Subject">
        <Input
          value={node.data.subject}
          onChange={(e) => onChange(node.id, { subject: e.target.value })}
          maxLength={200}
        />
      </Field>
      <Field label="Preview text" hint="Preheader shown next to the subject in inbox.">
        <Input
          value={node.data.previewText}
          onChange={(e) => onChange(node.id, { previewText: e.target.value })}
          maxLength={200}
        />
      </Field>
      <Field label="Plain-text fallback" hint="Auto-generated when you save a design.">
        <textarea
          className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
          value={node.data.textBody}
          onChange={(e) => onChange(node.id, { textBody: e.target.value })}
          rows={4}
        />
      </Field>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() =>
          toast.info('Design composer opens here — wired in M3.')
        }
      >
        Open design composer
      </Button>
    </>
  );
}

function WhatsAppForm({
  node,
  onChange,
  onFlipStatus,
}: {
  node: NodeWithType<'whatsapp'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
  onFlipStatus: (id: string, status: 'DRAFT' | 'LIVE') => void;
}): JSX.Element {
  return (
    <>
      <StatusToggle
        status={node.data.status}
        onFlip={(status) => onFlipStatus(node.id, status)}
      />
      <Field label="Template id" hint="Must be an APPROVED template.">
        <Input
          value={node.data.templateId ?? ''}
          onChange={(e) => onChange(node.id, { templateId: e.target.value || null })}
        />
      </Field>
      <Field label="Phone number id">
        <Input
          value={node.data.phoneNumberId ?? ''}
          onChange={(e) => onChange(node.id, { phoneNumberId: e.target.value || null })}
        />
      </Field>
    </>
  );
}

function PropertyUpdateForm({
  node,
  onChange,
}: {
  node: NodeWithType<'property_update'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Action">
        <Select
          value={node.data.action}
          onValueChange={(v) =>
            onChange(node.id, { action: v as typeof node.data.action })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="set_custom_field">Set custom field</SelectItem>
            <SelectItem value="unset_custom_field">Unset custom field</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Custom field key">
        <Input
          value={node.data.customFieldKey}
          onChange={(e) => onChange(node.id, { customFieldKey: e.target.value })}
        />
      </Field>
      {node.data.action === 'set_custom_field' && (
        <Field label="Value">
          <Input
            value={node.data.value}
            onChange={(e) => onChange(node.id, { value: e.target.value })}
          />
        </Field>
      )}
    </>
  );
}

function ListUpdateForm({
  node,
  onChange,
}: {
  node: NodeWithType<'list_update'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
}): JSX.Element {
  const requiresTarget = ['add_tag', 'remove_tag', 'move_to_segment'].includes(node.data.action);
  return (
    <>
      <Field label="Action">
        <Select
          value={node.data.action}
          onValueChange={(v) =>
            onChange(node.id, { action: v as typeof node.data.action })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="add_tag">Add tag</SelectItem>
            <SelectItem value="remove_tag">Remove tag</SelectItem>
            <SelectItem value="move_to_segment">Move to segment</SelectItem>
            <SelectItem value="unsubscribe_email">Unsubscribe from email</SelectItem>
            <SelectItem value="unsubscribe_whatsapp">Unsubscribe from WhatsApp</SelectItem>
            <SelectItem value="unsubscribe_sms">Unsubscribe from SMS</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {requiresTarget && (
        <Field label="Target id" hint="Tag id or Segment id.">
          <Input
            value={node.data.targetId ?? ''}
            onChange={(e) => onChange(node.id, { targetId: e.target.value || null })}
          />
        </Field>
      )}
    </>
  );
}

function InternalAlertForm({
  node,
  onChange,
}: {
  node: NodeWithType<'internal_alert'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Channel">
        <Select
          value={node.data.channel}
          onValueChange={(v) =>
            onChange(node.id, { channel: v as typeof node.data.channel })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">Email address</SelectItem>
            <SelectItem value="user">Team member</SelectItem>
            <SelectItem value="webhook">Webhook URL</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Target"
        hint={
          node.data.channel === 'email'
            ? 'email address'
            : node.data.channel === 'user'
              ? 'user id'
              : 'https URL'
        }
      >
        <Input
          value={node.data.target}
          onChange={(e) => onChange(node.id, { target: e.target.value })}
        />
      </Field>
      <Field label="Message">
        <textarea
          className="min-h-16 w-full rounded-md border bg-background p-2 text-sm"
          value={node.data.message}
          onChange={(e) => onChange(node.id, { message: e.target.value })}
          maxLength={500}
        />
      </Field>
    </>
  );
}

function DelayForm({
  node,
  onChange,
}: {
  node: NodeWithType<'delay'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Mode">
        <Select
          value={node.data.mode}
          onValueChange={(v) =>
            onChange(node.id, { mode: v as typeof node.data.mode })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relative">Wait N time</SelectItem>
            <SelectItem value="absolute">Wait until specific date</SelectItem>
            <SelectItem value="weekday_time">Wait until weekday/time</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {node.data.mode === 'relative' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount">
            <Input
              type="number"
              min={1}
              value={node.data.amount}
              onChange={(e) =>
                onChange(node.id, { amount: Math.max(1, Number(e.target.value)) })
              }
            />
          </Field>
          <Field label="Unit">
            <Select
              value={node.data.unit}
              onValueChange={(v) =>
                onChange(node.id, { unit: v as typeof node.data.unit })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
                <SelectItem value="days">Days</SelectItem>
                <SelectItem value="weeks">Weeks</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
      {node.data.mode === 'absolute' && (
        <Field label="Wait until">
          <Input
            type="datetime-local"
            value={node.data.absoluteAt ? node.data.absoluteAt.slice(0, 16) : ''}
            onChange={(e) => {
              const iso = e.target.value ? new Date(e.target.value).toISOString() : null;
              onChange(node.id, { absoluteAt: iso });
            }}
          />
        </Field>
      )}
      {node.data.mode === 'weekday_time' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Weekday">
            <Select
              value={String(node.data.weekday ?? 1)}
              onValueChange={(v) => onChange(node.id, { weekday: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Hour (UTC)">
            <Input
              type="number"
              min={0}
              max={23}
              value={node.data.hourUtc ?? 9}
              onChange={(e) => onChange(node.id, { hourUtc: Number(e.target.value) })}
            />
          </Field>
        </div>
      )}
    </>
  );
}

function SplitForm({
  node,
  onChange,
}: {
  node: NodeWithType<'split'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
}): JSX.Element {
  const cond = node.data.condition;
  return (
    <>
      <Field label="Condition">
        <Select
          value={cond.kind}
          onValueChange={(v) =>
            onChange(node.id, {
              condition: buildDefaultCondition(v),
            } as Partial<AutomationNode['data']>)
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="opened_previous_email">Opened previous email</SelectItem>
            <SelectItem value="clicked_previous_email">Clicked previous email</SelectItem>
            <SelectItem value="clicked_specific_link">Clicked specific link</SelectItem>
            <SelectItem value="has_tag">Has tag</SelectItem>
            <SelectItem value="custom_field_equals">Custom field equals</SelectItem>
            <SelectItem value="time_since_enrollment">Time since enrollment</SelectItem>
            <SelectItem value="whatsapp_message_delivered">WA delivered</SelectItem>
            <SelectItem value="whatsapp_message_read">WA read</SelectItem>
            <SelectItem value="whatsapp_message_replied">WA replied</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {cond.kind === 'has_tag' && (
        <Field label="Tag id">
          <Input
            value={cond.tagId}
            onChange={(e) =>
              onChange(node.id, {
                condition: { ...cond, tagId: e.target.value },
              } as Partial<AutomationNode['data']>)
            }
          />
        </Field>
      )}
      {cond.kind === 'custom_field_equals' && (
        <>
          <Field label="Custom field key">
            <Input
              value={cond.customFieldKey}
              onChange={(e) =>
                onChange(node.id, {
                  condition: { ...cond, customFieldKey: e.target.value },
                } as Partial<AutomationNode['data']>)
              }
            />
          </Field>
          <Field label="Equals">
            <Input
              value={cond.value}
              onChange={(e) =>
                onChange(node.id, {
                  condition: { ...cond, value: e.target.value },
                } as Partial<AutomationNode['data']>)
              }
            />
          </Field>
        </>
      )}
      {cond.kind === 'time_since_enrollment' && (
        <>
          <Field label="Comparison">
            <Select
              value={cond.op}
              onValueChange={(v) =>
                onChange(node.id, {
                  condition: { ...cond, op: v as 'gt' | 'lt' },
                } as Partial<AutomationNode['data']>)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gt">Greater than</SelectItem>
                <SelectItem value="lt">Less than</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Minutes">
            <Input
              type="number"
              min={1}
              value={cond.minutes}
              onChange={(e) =>
                onChange(node.id, {
                  condition: { ...cond, minutes: Math.max(1, Number(e.target.value)) },
                } as Partial<AutomationNode['data']>)
              }
            />
          </Field>
        </>
      )}
      {cond.kind === 'clicked_specific_link' && (
        <Field label="URL">
          <Input
            value={cond.url}
            onChange={(e) =>
              onChange(node.id, {
                condition: { ...cond, url: e.target.value },
              } as Partial<AutomationNode['data']>)
            }
          />
        </Field>
      )}
      <p className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
        Connect the <strong>Yes</strong> and <strong>No</strong> handles at the
        bottom of the node to route the two branches.
      </p>
    </>
  );
}

function buildDefaultCondition(kind: string): NodeWithType<'split'>['data']['condition'] {
  switch (kind) {
    case 'opened_previous_email':
    case 'clicked_previous_email':
    case 'whatsapp_message_delivered':
    case 'whatsapp_message_read':
    case 'whatsapp_message_replied':
      return { kind, nodeId: null } as never;
    case 'clicked_specific_link':
      return { kind, nodeId: null, url: '' } as never;
    case 'has_tag':
      return { kind, tagId: '' } as never;
    case 'custom_field_equals':
      return { kind, customFieldKey: '', value: '' } as never;
    case 'time_since_enrollment':
      return { kind, op: 'gt', minutes: 60 } as never;
    default:
      return { kind: 'opened_previous_email', nodeId: null } as never;
  }
}

function ExitForm({
  node,
  onChange,
}: {
  node: NodeWithType<'exit'>;
  onChange: (id: string, patch: Partial<AutomationNode['data']>) => void;
}): JSX.Element {
  return (
    <Field label="Reason (optional)" hint="Shown in enrollment history.">
      <Input
        value={node.data.reason}
        onChange={(e) => onChange(node.id, { reason: e.target.value })}
        maxLength={120}
      />
    </Field>
  );
}

// -----------------------------------------------------------------
// Draft/Live toggle for message nodes
// -----------------------------------------------------------------

function StatusToggle({
  status,
  onFlip,
}: {
  status: 'DRAFT' | 'LIVE';
  onFlip: (status: 'DRAFT' | 'LIVE') => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState<'DRAFT' | 'LIVE' | null>(null);
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">Node status</p>
          <p className="text-[11px] text-muted-foreground">
            Contacts pause at Draft nodes.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-md border">
          <StatusButton
            active={status === 'DRAFT'}
            onClick={() => (status === 'DRAFT' ? null : setConfirming('DRAFT'))}
          >
            Draft
          </StatusButton>
          <StatusButton
            active={status === 'LIVE'}
            onClick={() => (status === 'LIVE' ? null : onFlip('LIVE'))}
          >
            Live
          </StatusButton>
        </div>
      </div>
      {confirming === 'DRAFT' && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs">
            Contacts currently at this node will pause until it's Live again.
            Proceed?
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                onFlip('DRAFT');
                setConfirming(null);
              }}
            >
              Flip to Draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs font-medium ${
        active ? 'bg-primary text-primary-foreground' : 'bg-background'
      }`}
    >
      {children}
    </button>
  );
}
