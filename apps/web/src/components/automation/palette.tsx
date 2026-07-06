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
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Left-side node palette. Drag an item onto the canvas to add a
 * node of that type. Uses HTML5 drag: dragstart writes the type to
 * dataTransfer, drop on the canvas creates the node.
 */

interface PaletteItem {
  type: string;
  label: string;
  icon: LucideIcon;
  tone: string;
}

const GROUPS: { label: string; items: PaletteItem[] }[] = [
  {
    label: 'Messages',
    items: [
      { type: 'email', label: 'Email', icon: Mail, tone: 'text-sky-700' },
      { type: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'text-sky-700' },
    ],
  },
  {
    label: 'Data',
    items: [
      { type: 'property_update', label: 'Update property', icon: UserCog, tone: 'text-violet-700' },
      { type: 'list_update', label: 'Update list', icon: Tag, tone: 'text-violet-700' },
      { type: 'internal_alert', label: 'Internal alert', icon: Bell, tone: 'text-violet-700' },
    ],
  },
  {
    label: 'Logic',
    items: [
      { type: 'trigger', label: 'Trigger', icon: Play, tone: 'text-emerald-700' },
      { type: 'delay', label: 'Time delay', icon: Clock, tone: 'text-amber-700' },
      { type: 'split', label: 'If / else split', icon: GitBranch, tone: 'text-amber-700' },
      { type: 'exit', label: 'Exit', icon: Square, tone: 'text-slate-600' },
    ],
  },
];

export function AutomationPalette(): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={item.type}>
                <button
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-automation-node-type', item.type);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  className={cn(
                    'flex w-full cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-sm transition-shadow hover:shadow-sm active:cursor-grabbing',
                  )}
                >
                  <item.icon className={cn('size-4', item.tone)} />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
