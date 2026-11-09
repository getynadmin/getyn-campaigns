'use client';

import {
  Bell,
  Clock,
  GitBranch,
  Mail,
  MessageCircle,
  Play,
  Square,
  Tag,
  UserCog,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Left-side node palette. Drag an item onto the canvas to add a
 * node of that type. Uses HTML5 drag: dragstart writes the type to
 * dataTransfer, drop on the canvas creates the node.
 *
 * The visible/enabled items depend on the automation's `kind`. Any
 * item not in the current kind's palette is still rendered when it
 * appears on an existing node (migrations) — but it's disabled in the
 * palette so new ones can't be added. See STEP_PALETTE below — adding
 * a new kind is a one-line diff.
 */

export type AutomationKind =
  | 'EMAIL_OUTBOUND'
  | 'WHATSAPP_OUTBOUND'
  | 'WHATSAPP_INBOUND';

interface PaletteItem {
  type: string;
  label: string;
  icon: LucideIcon;
  tone: string;
}

const ITEMS: Record<string, PaletteItem> = {
  email: { type: 'email', label: 'Email', icon: Mail, tone: 'text-sky-700' },
  whatsapp: { type: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'text-emerald-700' },
  property_update: { type: 'property_update', label: 'Update property', icon: UserCog, tone: 'text-violet-700' },
  list_update: { type: 'list_update', label: 'Update list', icon: Tag, tone: 'text-violet-700' },
  internal_alert: { type: 'internal_alert', label: 'Internal alert', icon: Bell, tone: 'text-violet-700' },
  trigger: { type: 'trigger', label: 'Trigger', icon: Play, tone: 'text-emerald-700' },
  delay: { type: 'delay', label: 'Time delay', icon: Clock, tone: 'text-amber-700' },
  split: { type: 'split', label: 'If / else split', icon: GitBranch, tone: 'text-amber-700' },
  exit: { type: 'exit', label: 'Exit', icon: Square, tone: 'text-slate-600' },
  agent_handoff: { type: 'agent_handoff', label: 'Hand off to agent', icon: UserCheck, tone: 'text-violet-700' },
};

/**
 * Which node types are allowed per kind. Anything not in the set
 * renders disabled in the palette for that kind. Add a new kind here
 * and the UI follows automatically.
 */
export const STEP_PALETTE: Record<AutomationKind, Set<string>> = {
  EMAIL_OUTBOUND: new Set([
    'email',
    'property_update',
    'list_update',
    'internal_alert',
    'trigger',
    'delay',
    'split',
    'exit',
  ]),
  WHATSAPP_OUTBOUND: new Set([
    'whatsapp',
    'property_update',
    'list_update',
    'internal_alert',
    'trigger',
    'delay',
    'split',
    'exit',
  ]),
  WHATSAPP_INBOUND: new Set([
    'whatsapp',
    'property_update',
    'list_update',
    'internal_alert',
    'trigger',
    'delay',
    'split',
    'agent_handoff',
    'exit',
  ]),
};

const GROUPS: { label: string; itemKeys: string[] }[] = [
  { label: 'Messages', itemKeys: ['email', 'whatsapp'] },
  {
    label: 'Data',
    itemKeys: ['property_update', 'list_update', 'internal_alert', 'agent_handoff'],
  },
  { label: 'Logic', itemKeys: ['trigger', 'delay', 'split', 'exit'] },
];

export function AutomationPalette({
  kind = 'EMAIL_OUTBOUND',
}: {
  kind?: AutomationKind;
}): JSX.Element {
  const allowed = STEP_PALETTE[kind];
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {GROUPS.map((group) => {
        const items = group.itemKeys
          .map((k) => ITEMS[k])
          .filter((i): i is PaletteItem => Boolean(i));
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-1">
              {items.map((item) => {
                const enabled = allowed.has(item.type);
                return (
                  <li key={item.type}>
                    <button
                      draggable={enabled}
                      disabled={!enabled}
                      title={
                        enabled
                          ? undefined
                          : 'Not available in this flow kind'
                      }
                      onDragStart={(e) => {
                        if (!enabled) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.setData(
                          'application/x-automation-node-type',
                          item.type,
                        );
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-sm transition-shadow',
                        enabled
                          ? 'cursor-grab hover:shadow-sm active:cursor-grabbing'
                          : 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <item.icon className={cn('size-4', item.tone)} />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
