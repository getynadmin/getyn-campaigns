'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  FileText,
  Filter,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Phone,
  Settings,
  ShieldOff,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';

type Item = {
  href: (slug: string) => string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true the item renders disabled — reserved for later phases. */
  soon?: boolean;
};

const items: Item[] = [
  {
    href: (s) => `/t/${s}/dashboard`,
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  { href: (s) => `/t/${s}/campaigns`, label: 'Campaigns', icon: Mail },
  {
    href: (s) => `/t/${s}/templates`,
    label: 'Templates',
    icon: FileText,
  },
  {
    href: (s) => `/t/${s}/contacts`,
    label: 'Contacts',
    icon: Users,
  },
  {
    href: (s) => `/t/${s}/segments`,
    label: 'Segments',
    icon: Filter,
  },
  {
    href: (s) => `/t/${s}/suppression`,
    label: 'Suppression',
    icon: ShieldOff,
  },
  {
    href: (s) => `/t/${s}/inbox`,
    label: 'WhatsApp Inbox',
    icon: MessageSquare,
  },
  { href: (s) => `/t/${s}/sms`, label: 'SMS', icon: Phone, soon: true },
  {
    href: (s) => `/t/${s}/analytics`,
    label: 'Analytics',
    icon: BarChart3,
    soon: true,
  },
  { href: (s) => `/t/${s}/settings`, label: 'Settings', icon: Settings },
];

/**
 * Tenant-scoped sidebar. Phase 1 only wires Dashboard and Settings; the
 * rest are visible-but-disabled so the product shape is obvious without
 * us over-promising on the empty routes.
 */
export function Sidebar({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const pathname = usePathname();
  return (
    <aside className="hidden h-dvh w-60 shrink-0 flex-col border-r bg-card px-3 py-4 md:flex">
      <Link
        href={`/t/${tenantSlug}/dashboard`}
        className="mb-6 flex items-center gap-2 px-3 py-2"
      >
        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
          G
        </span>
        <span className="font-display text-base font-semibold tracking-tight">
          Getyn
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const href = item.href(tenantSlug);
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          const Icon = item.icon;
          if (item.soon) {
            return (
              <span
                key={item.label}
                aria-disabled="true"
                className={cn(
                  'flex cursor-not-allowed items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground/70',
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4" />
                  {item.label}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Soon
                </span>
              </span>
            );
          }
          return (
            <Link
              key={item.label}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
