'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  BarChart3,
  Bot,
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
  Plug,
  ScrollText,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Admin sidebar — two-panel layout.
 *
 *   [ Icon rail (16w) ][ Detail panel (80w, collapsible to 16w) ]
 *
 * Left rail holds the top-level surfaces (Tenants, Plans, Reports,
 * Settings, Integrations, Audit, Webhooks, Queues). Right panel
 * expands the selected section's children — search + grouped items
 * with per-item expand for hasChildren rows.
 *
 * Active section is derived from the current pathname so the correct
 * panel opens on any deep link; the operator can also click the rail
 * to preview a different section without navigating.
 *
 * Design notes:
 *   - Dark aesthetic (bg-neutral-950) chosen for visual separation
 *     from the light main content. Matches common admin dashboard
 *     patterns (Vercel, Stripe).
 *   - Real Next.js <Link> for every navigable leaf so client-side
 *     transitions still work.
 *   - Search is client-side over the current section's items only
 *     (label substring match). Global search would need a proper
 *     index which we don't have yet.
 */

const EASE = 'cubic-bezier(0.25, 1.1, 0.4, 1)';

type Leaf = {
  href: string;
  label: string;
  icon?: LucideIcon;
  badge?: string;
  soon?: boolean;
};

type MenuItem = Leaf & {
  children?: Leaf[];
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

type RailEntry = {
  id: string;
  icon: LucideIcon;
  label: string;
  /** When set, clicking the rail icon also navigates here (leaf-style). */
  defaultHref?: string;
  detail: {
    title: string;
    sections: MenuSection[];
  };
};

// -----------------------------------------------------------------
// Rail + detail content — the source of truth for admin nav.
// -----------------------------------------------------------------

const RAIL: RailEntry[] = [
  {
    id: 'tenants',
    icon: Database,
    label: 'Tenants',
    defaultHref: '/admin/tenants',
    detail: {
      title: 'Tenants',
      sections: [
        {
          title: 'Directory',
          items: [
            { href: '/admin/tenants', label: 'All tenants', icon: Database },
          ],
        },
      ],
    },
  },
  {
    id: 'plans',
    icon: CreditCard,
    label: 'Plans',
    defaultHref: '/admin/plans',
    detail: {
      title: 'Plans',
      sections: [
        {
          title: 'Plan Management',
          items: [
            { href: '/admin/plans', label: 'Plans', icon: Layers },
            {
              href: '/admin/upgrade-requests',
              label: 'Upgrade Requests',
              icon: ArrowUpCircle,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'reports',
    icon: BarChart3,
    label: 'Reports',
    detail: {
      title: 'Reports',
      sections: [
        {
          title: 'Analytics',
          items: [
            {
              href: '/admin',
              label: 'Overview',
              icon: BarChart3,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'settings',
    icon: Settings,
    label: 'Settings',
    detail: {
      title: 'Settings',
      sections: [
        {
          title: 'Workspace',
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
            {
              href: '/admin/settings/staff',
              label: 'Staff Users',
              icon: Users,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'integrations',
    icon: Plug,
    label: 'Integrations',
    detail: {
      title: 'Global Integrations',
      sections: [
        {
          title: 'Messaging',
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
              soon: true,
            },
          ],
        },
        {
          title: 'AI',
          items: [
            {
              href: '/admin/integrations/ai-llms',
              label: 'AI LLMs',
              icon: Sparkles,
            },
            {
              href: '/admin/integrations/ai-llms',
              label: 'AI Agents',
              icon: Bot,
              soon: true,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'audit',
    icon: ScrollText,
    label: 'Audit log',
    defaultHref: '/admin/audit-log',
    detail: {
      title: 'Audit',
      sections: [
        {
          title: 'Logs',
          items: [
            { href: '/admin/audit-log', label: 'Audit log', icon: ScrollText },
          ],
        },
      ],
    },
  },
  {
    id: 'webhooks',
    icon: ClipboardList,
    label: 'Webhooks',
    defaultHref: '/admin/webhook-log',
    detail: {
      title: 'Webhooks',
      sections: [
        {
          title: 'Logs',
          items: [
            {
              href: '/admin/webhook-log',
              label: 'Webhook log',
              icon: ClipboardList,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'queues',
    icon: Server,
    label: 'Queues',
    defaultHref: '/admin/queues',
    detail: {
      title: 'Queues',
      sections: [
        {
          title: 'Workers',
          items: [
            { href: '/admin/queues', label: 'Queue health', icon: Server },
          ],
        },
      ],
    },
  },
];

export interface AdminSidebarProps {
  staffEmail: string;
  staffRole: string;
  appName: string;
  logoUrl: string | null;
}

// -----------------------------------------------------------------
// Shell
// -----------------------------------------------------------------

export function AdminSidebar({
  staffEmail,
  staffRole,
  appName,
  logoUrl,
}: AdminSidebarProps): JSX.Element {
  const pathname = usePathname() ?? '';

  // Derive the active section from the current URL. If nothing
  // matches, default to Tenants (the admin landing).
  const activeSection = useMemo(() => {
    const match = RAIL.find((entry) =>
      entry.detail.sections.some((s) =>
        s.items.some(
          (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
        ),
      ),
    );
    return match?.id ?? 'tenants';
  }, [pathname]);

  const [previewSection, setPreviewSection] = useState<string | null>(null);
  const shownSection = previewSection ?? activeSection;
  const shown = RAIL.find((entry) => entry.id === shownSection) ?? RAIL[0]!;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className="hidden shrink-0 md:flex">
      <IconRail
        active={shownSection}
        onSelect={(id) => setPreviewSection(id)}
        appName={appName}
        logoUrl={logoUrl}
      />
      <DetailPanel
        entry={shown}
        pathname={pathname}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        staffEmail={staffEmail}
        staffRole={staffRole}
      />
    </aside>
  );
}

// -----------------------------------------------------------------
// Left icon rail
// -----------------------------------------------------------------

function IconRail({
  active,
  onSelect,
  appName,
  logoUrl,
}: {
  active: string;
  onSelect: (id: string) => void;
  appName: string;
  logoUrl: string | null;
}): JSX.Element {
  return (
    <div className="flex w-16 flex-col items-center gap-2 border-r border-neutral-800 bg-neutral-950 p-3">
      <Link
        href="/admin"
        className="mb-2 flex size-10 items-center justify-center"
        title={appName}
      >
        {logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt={appName}
            className="size-7 rounded-md object-contain"
          />
        ) : (
          <span className="grid size-7 place-items-center rounded-md bg-rose-600 text-xs font-bold text-white">
            A
          </span>
        )}
      </Link>

      <div className="flex w-full flex-col items-center gap-1">
        {RAIL.map((entry) => {
          const Icon = entry.icon;
          const isActive = active === entry.id;
          const label = entry.label;
          const inner = (
            <button
              type="button"
              className={cn(
                'flex size-10 items-center justify-center rounded-lg transition-colors',
                isActive
                  ? 'bg-neutral-800 text-neutral-50'
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
              )}
              style={{ transitionTimingFunction: EASE, transitionDuration: '300ms' }}
              onMouseEnter={() => onSelect(entry.id)}
              onClick={() => onSelect(entry.id)}
              title={label}
              aria-label={label}
            >
              <Icon className="size-4" />
            </button>
          );
          return entry.defaultHref ? (
            <Link key={entry.id} href={entry.defaultHref} aria-label={label}>
              {inner}
            </Link>
          ) : (
            <div key={entry.id}>{inner}</div>
          );
        })}
      </div>

      <div className="flex-1" />

      <form action="/api/auth/logout" method="post" className="w-full">
        <button
          type="submit"
          className="flex size-10 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

// -----------------------------------------------------------------
// Right detail panel
// -----------------------------------------------------------------

function DetailPanel({
  entry,
  pathname,
  collapsed,
  onToggleCollapse,
  staffEmail,
  staffRole,
}: {
  entry: RailEntry;
  pathname: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  staffEmail: string;
  staffRole: string;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entry.detail.sections;
    return entry.detail.sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) =>
            i.label.toLowerCase().includes(q) ||
            (i.children ?? []).some((c) => c.label.toLowerCase().includes(q)),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [entry, query]);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-r border-neutral-800 bg-neutral-950 p-4 text-neutral-100 transition-all',
        collapsed ? 'w-16' : 'w-72',
      )}
      style={{ transitionTimingFunction: EASE, transitionDuration: '300ms' }}
    >
      <div className="flex items-center justify-between">
        {!collapsed && (
          <h2 className="font-display text-lg font-semibold">
            {entry.detail.title}
          </h2>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="ml-auto flex size-9 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronDown
            className={cn(
              'size-4 transition-transform',
              collapsed ? 'rotate-[-90deg]' : 'rotate-90',
            )}
            style={{ transitionTimingFunction: EASE, transitionDuration: '300ms' }}
          />
        </button>
      </div>

      {!collapsed && (
        <div className="flex h-10 items-center gap-2 rounded-lg border border-neutral-800 bg-black px-2">
          <Search className="size-4 text-neutral-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
          />
        </div>
      )}

      <nav className={cn('flex-1 overflow-y-auto', collapsed ? 'flex flex-col items-center gap-1' : 'space-y-4')}>
        {filtered.length === 0 ? (
          !collapsed && (
            <p className="px-2 py-1 text-xs text-neutral-500">No matches.</p>
          )
        ) : (
          filtered.map((section) => (
            <SectionBlock
              key={`${entry.id}-${section.title}`}
              section={section}
              pathname={pathname}
              collapsed={collapsed}
            />
          ))
        )}
      </nav>

      {!collapsed && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-[10px] text-neutral-400">
          <p className="flex items-center gap-1">
            <ShieldCheck className="size-3" />
            {staffEmail}
          </p>
          <p className="mt-0.5 capitalize">
            {staffRole.toLowerCase().replace('_', ' ')}
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-100"
          >
            <ExternalLink className="size-3" />
            Back to App
          </Link>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// Section + item
// -----------------------------------------------------------------

function SectionBlock({
  section,
  pathname,
  collapsed,
}: {
  section: MenuSection;
  pathname: string;
  collapsed: boolean;
}): JSX.Element {
  return (
    <div className={cn('flex flex-col', collapsed ? 'w-full gap-1' : 'gap-0.5')}>
      {!collapsed && (
        <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          {section.title}
        </p>
      )}
      {section.items.map((item) => (
        <MenuItemRow
          key={`${section.title}-${item.href}-${item.label}`}
          item={item}
          pathname={pathname}
          collapsed={collapsed}
        />
      ))}
    </div>
  );
}

function MenuItemRow({
  item,
  pathname,
  collapsed,
}: {
  item: MenuItem;
  pathname: string;
  collapsed: boolean;
}): JSX.Element {
  const active =
    pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  const hasChildren = (item.children?.length ?? 0) > 0;
  const [open, setOpen] = useState<boolean>(
    active ||
      (item.children?.some(
        (c) => pathname === c.href || pathname.startsWith(`${c.href}/`),
      ) ??
        false),
  );

  const row = (
    <div
      className={cn(
        'group flex h-10 items-center rounded-lg text-sm transition-colors',
        collapsed ? 'w-10 justify-center' : 'w-full px-3',
        active
          ? 'bg-neutral-800 text-neutral-50'
          : 'text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50',
        item.soon && 'opacity-60',
      )}
      style={{ transitionTimingFunction: EASE, transitionDuration: '300ms' }}
      title={collapsed ? item.label : undefined}
    >
      {Icon && (
        <Icon
          className={cn(
            'size-4 shrink-0',
            collapsed ? '' : 'mr-3',
          )}
        />
      )}
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <span className="ml-2 rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
              {item.badge}
            </span>
          )}
          {hasChildren && (
            <ChevronDown
              className={cn(
                'ml-1 size-4 shrink-0 transition-transform',
                open ? 'rotate-180' : 'rotate-0',
              )}
              style={{
                transitionTimingFunction: EASE,
                transitionDuration: '300ms',
              }}
            />
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={cn(collapsed ? 'w-full flex justify-center' : 'w-full')}>
      {hasChildren ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full text-left"
        >
          {row}
        </button>
      ) : item.soon ? (
        <div className="w-full">{row}</div>
      ) : (
        <Link href={item.href} className="block w-full">
          {row}
        </Link>
      )}
      {hasChildren && open && !collapsed && (
        <div className="mt-1 space-y-0.5 pl-9">
          {item.children!.map((child) => {
            const childActive =
              pathname === child.href || pathname.startsWith(`${child.href}/`);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-xs transition-colors',
                  childActive
                    ? 'bg-neutral-800 text-neutral-50'
                    : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-100',
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
