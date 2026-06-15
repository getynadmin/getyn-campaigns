'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpCircle,
  BarChart3,
  Building2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Database,
  ExternalLink,
  Layers,
  LogOut,
  Mail,
  MessageSquare,
  PanelsTopLeft,
  Phone,
  Plug,
  ScrollText,
  Send,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Phase 5.6 M1 — grouped admin sidebar.
 *
 * The flat NAV from Phase 5 M7 split into thematic groups with
 * collapsible submenus. Each group's open/closed state is derived
 * from the current pathname (if any child is active, the group
 * opens). Plain `<details>` would lose state on client nav; we
 * inline the open logic so React keeps it consistent.
 *
 * Structure mirrors the screenshots provided in the Phase 5.6 spec:
 * Plan Management group at top, Settings + Global Integrations as
 * sibling groups below.
 */

type Leaf = { href: string; label: string; icon: LucideIcon; badge?: string };

type Group = {
  key: string;
  label: string;
  icon: LucideIcon;
  items: Leaf[];
};

type Section = Leaf | Group;

const SECTIONS: Section[] = [
  { href: '/admin/tenants', label: 'Tenants', icon: Database },
  {
    key: 'plan-management',
    label: 'Plan Management',
    icon: CreditCard,
    items: [
      { href: '/admin/plans', label: 'Plans', icon: Layers },
      {
        href: '/admin/upgrade-requests',
        label: 'Upgrade Requests',
        icon: ArrowUpCircle,
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    items: [],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    items: [
      {
        href: '/admin/settings/plans',
        label: 'Plan Settings',
        icon: SlidersHorizontal,
      },
      {
        href: '/admin/settings/site',
        label: 'Site Settings',
        icon: PanelsTopLeft,
      },
      { href: '/admin/settings/staff', label: 'Staff Users', icon: Users },
    ],
  },
  {
    key: 'integrations',
    label: 'Global Integrations',
    icon: Plug,
    items: [
      {
        href: '/admin/integrations/whatsapp',
        label: 'WhatsApp',
        icon: MessageSquare,
      },
      {
        href: '/admin/integrations/smtp',
        label: 'Email SMTP',
        icon: Mail,
      },
      {
        href: '/admin/integrations/email-templates',
        label: 'Email Templates',
        icon: Mail,
      },
      {
        href: '/admin/integrations/sending-servers',
        label: 'Sending Servers',
        icon: Send,
      },
      {
        href: '/admin/integrations/sms-servers',
        label: 'SMS Servers',
        icon: Smartphone,
        badge: 'Soon',
      },
      {
        href: '/admin/integrations/ai-llms',
        label: 'AI LLMs',
        icon: Sparkles,
      },
    ],
  },
  { href: '/admin/audit-log', label: 'Audit log', icon: ScrollText },
  { href: '/admin/webhook-log', label: 'Webhooks', icon: ClipboardList },
  { href: '/admin/queues', label: 'Queues', icon: Server },
];

export interface AdminSidebarProps {
  staffEmail: string;
  staffRole: string;
  appName: string;
  logoUrl: string | null;
}

export function AdminSidebar({
  staffEmail,
  staffRole,
  appName,
  logoUrl,
}: AdminSidebarProps): JSX.Element {
  const pathname = usePathname() ?? '';
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r bg-card px-3 py-5 md:flex">
      <Link href="/admin" className="mb-6 flex items-center gap-2 px-3 py-2">
        {logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt={appName}
            className="h-7 max-w-[10rem] object-contain"
          />
        ) : (
          <>
            <span className="grid size-7 place-items-center rounded-md bg-rose-600 text-sm font-bold text-white">
              A
            </span>
            <span className="font-display text-base font-semibold">
              {appName}
            </span>
          </>
        )}
      </Link>
      <nav className="flex-1 space-y-0.5 text-sm">
        {SECTIONS.map((s) =>
          'items' in s ? (
            <SidebarGroup key={s.key} group={s} pathname={pathname} />
          ) : (
            <SidebarLeaf key={s.href} leaf={s} pathname={pathname} />
          ),
        )}
        <div className="my-2 border-t" />
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <ExternalLink className="size-4" />
          Back to App
        </Link>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sign Out
          </button>
        </form>
      </nav>
      <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
        <p className="flex items-center gap-1">
          <ShieldCheck className="size-3" />
          {staffEmail}
        </p>
        <p className="mt-0.5 capitalize">
          {staffRole.toLowerCase().replace('_', ' ')}
        </p>
      </div>
    </aside>
  );
}

function SidebarGroup({
  group,
  pathname,
}: {
  group: Group;
  pathname: string;
}): JSX.Element {
  const anyActive = group.items.some((l) => pathname.startsWith(l.href));
  const Icon = group.icon;
  return (
    <details open={anyActive} className="group/details">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent/60 hover:text-foreground">
        <span className="flex items-center gap-2">
          <Icon className="size-4" />
          {group.label}
        </span>
        <ChevronDown className="size-3.5 transition-transform group-open/details:rotate-180" />
      </summary>
      <div className="ml-3 mt-0.5 space-y-0.5 border-l pl-3">
        {group.items.length === 0 ? (
          <span className="block px-3 py-1 text-[11px] text-muted-foreground/60">
            Nothing here yet
          </span>
        ) : (
          group.items.map((leaf) => (
            <SidebarLeaf key={leaf.href} leaf={leaf} pathname={pathname} />
          ))
        )}
      </div>
    </details>
  );
}

function SidebarLeaf({
  leaf,
  pathname,
}: {
  leaf: Leaf;
  pathname: string;
}): JSX.Element {
  const Icon = leaf.icon;
  const active = pathname === leaf.href || pathname.startsWith(`${leaf.href}/`);
  return (
    <Link
      href={leaf.href}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors',
        active
          ? 'bg-accent/80 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4" />
        {leaf.label}
      </span>
      {leaf.badge && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
          {leaf.badge}
        </span>
      )}
    </Link>
  );
}

void Building2;
void Phone;
