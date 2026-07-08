'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  Filter,
  MailCheck,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Mail,
  MessageSquare,
  Phone,
  Search,
  Settings,
  ShieldOff,
  Sparkles,
  Star,
  Users,
  Workflow,
  Bot,
} from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const COLLAPSED_KEY = 'getyn:sidebar-collapsed';

/**
 * Phase 5.8 — sectioned, collapsible tenant sidebar.
 *
 * Replaces the flat list with the layout pattern from the helpdesk
 * design reference: section headers, badge counts, search, a user
 * card at the bottom, and an expand/collapse arrow that flips the
 * whole sidebar between full and icon-only modes.
 *
 * Theming is independent of the app: the `data-sidebar-theme`
 * attribute on `<html>` (set by THEME_BOOT_SCRIPT + Themes settings
 * tab) drives the `[data-sidebar-theme=dark]` ancestor selectors
 * below. So the sidebar can be dark while the rest of the app is
 * light, and vice versa.
 */
type SidebarItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional small action (+ button); for now wired to the same href. */
  trailing?: 'plus' | 'chevron';
  /** Item appears disabled (future phase). */
  soon?: boolean;
  /** Live badge type. */
  badge?: 'inboxUnread' | 'agentPending';
};

type SidebarSection = {
  key: string;
  label: string;
  items: SidebarItem[];
};

function buildSections(slug: string): SidebarSection[] {
  const t = (path: string) => `/t/${slug}${path}`;
  return [
    {
      key: 'overview',
      label: 'Overview',
      items: [
        { href: t('/dashboard'), label: 'Dashboard', icon: LayoutDashboard },
      ],
    },
    {
      key: 'communicate',
      label: 'Communicate',
      items: [
        {
          href: t('/campaigns'),
          label: 'Campaigns',
          icon: Mail,
          trailing: 'plus',
        },
        {
          href: t('/agent'),
          label: 'Agent',
          icon: Sparkles,
        },
        { href: t('/templates'), label: 'Templates', icon: FileText },
        {
          href: t('/inbox'),
          label: 'WhatsApp Inbox',
          icon: MessageSquare,
          badge: 'inboxUnread',
        },
        {
          href: t('/email-inbox'),
          label: 'Email Inbox',
          icon: Mail,
        },
        { href: t('/sms'), label: 'SMS', icon: Phone, soon: true },
      ],
    },
    // Phase 8 — Automation (Drip Campaigns + Email Agent). Sits
    // between Communicate and Audience per team decision — automation
    // is upstream of one-off campaigns in most tenants' mental model.
    {
      key: 'automation',
      label: 'Automation',
      items: [
        {
          href: t('/automation/drip'),
          label: 'Drip Campaigns',
          icon: Workflow,
          trailing: 'plus',
        },
        {
          href: t('/automation/agents'),
          label: 'Email Agent',
          icon: Bot,
        },
        {
          href: t('/automation/agents/inbox'),
          label: 'Approval Inbox',
          icon: Bot,
          badge: 'agentPending',
        },
      ],
    },
    {
      key: 'audience',
      label: 'Audience',
      items: [
        { href: t('/contacts'), label: 'Contacts', icon: Users },
        { href: t('/segments'), label: 'Segments', icon: Filter },
        { href: t('/suppression'), label: 'Suppression', icon: ShieldOff },
        {
          href: t('/audience/email-verifier'),
          label: 'Email Verifier',
          icon: MailCheck,
        },
      ],
    },
    {
      key: 'insights',
      label: 'Insights',
      items: [
        {
          href: t('/analytics'),
          label: 'Analytics',
          icon: BarChart3,
          trailing: 'chevron',
          soon: true,
        },
      ],
    },
    {
      key: 'workspace',
      label: 'Workspace',
      items: [{ href: t('/settings'), label: 'Settings', icon: Settings }],
    },
  ];
}

export function Sidebar({
  tenantSlug,
  appName,
  logoUrl,
  user,
}: {
  tenantSlug: string;
  appName: string;
  logoUrl: string | null;
  user: { name: string | null; email: string; avatarUrl: string | null };
}): JSX.Element {
  const pathname = usePathname() ?? '';
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate collapsed state from localStorage on mount.
  useEffect(() => {
    const v = window.localStorage.getItem(COLLAPSED_KEY);
    if (v === '1') setCollapsed(true);
    setHydrated(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  };

  const sections = buildSections(tenantSlug);
  const inboxUnread = api.whatsAppInbox.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const inboxCount = inboxUnread.data?.total ?? 0;

  // Phase 8 M5 — Email Agent approval-inbox badge.
  const agentPending = api.emailAgentInbox.pendingCount.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const agentPendingCount = agentPending.data?.total ?? 0;

  const firstLetter = (appName.trim()[0] ?? 'G').toUpperCase();

  return (
    <aside
      className={cn(
        'group/sidebar hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-200 md:flex',
        // Theme-aware surface. The `[data-sidebar-theme=dark]` selector
        // means the whole sidebar tree inherits dark colours when the
        // sidebar pref resolves to 'dark' — independent of the app
        // theme.
        'bg-card text-foreground',
        '[html[data-sidebar-theme=dark]_&]:bg-[#0E0F14] [html[data-sidebar-theme=dark]_&]:border-white/5 [html[data-sidebar-theme=dark]_&]:text-zinc-200',
        collapsed ? 'w-[68px]' : 'w-64',
      )}
      // Without this `visible` opacity gate, the labels render
      // overflowing during the width transition until JS swaps state.
      style={{ visibility: hydrated ? 'visible' : 'visible' }}
    >
      {/* Header — logo + collapse toggle */}
      <div
        className={cn(
          'flex h-14 items-center border-b px-3',
          '[html[data-sidebar-theme=dark]_&]:border-white/5',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        <Link
          href={`/t/${tenantSlug}/dashboard`}
          className="flex items-center gap-2"
          title={appName}
        >
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoUrl}
              alt={appName}
              className={cn('h-7 w-auto object-contain', collapsed && 'max-w-8')}
            />
          ) : (
            <>
              <span className="grid size-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-bold text-white">
                {firstLetter}
              </span>
              {!collapsed && (
                <span className="font-display text-sm font-semibold tracking-tight">
                  {appName}
                </span>
              )}
            </>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              '[html[data-sidebar-theme=dark]_&]:text-zinc-400 [html[data-sidebar-theme=dark]_&]:hover:bg-white/5 [html[data-sidebar-theme=dark]_&]:hover:text-white',
            )}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>

      {/* Expand button (only visible when collapsed) */}
      {collapsed && (
        <div className="flex h-10 items-center justify-center border-b border-transparent">
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              'grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
              '[html[data-sidebar-theme=dark]_&]:text-zinc-400 [html[data-sidebar-theme=dark]_&]:hover:bg-white/5 [html[data-sidebar-theme=dark]_&]:hover:text-white',
            )}
            aria-label="Expand sidebar"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pt-3">
          <div
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 text-xs text-muted-foreground transition-colors focus-within:border-violet-500/40 focus-within:bg-card',
              '[html[data-sidebar-theme=dark]_&]:border-white/5 [html[data-sidebar-theme=dark]_&]:bg-white/[0.04] [html[data-sidebar-theme=dark]_&]:text-zinc-400 [html[data-sidebar-theme=dark]_&]:focus-within:bg-white/[0.06]',
            )}
          >
            <Search className="size-3.5" />
            <input
              type="text"
              placeholder="Search"
              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70 [html[data-sidebar-theme=dark]_&]:text-zinc-100"
            />
            <button
              type="button"
              aria-label="Pinned shortcuts"
              className="text-amber-400 hover:text-amber-300"
              title="Coming soon"
            >
              <Star className="size-3.5 fill-current" />
            </button>
          </div>
        </div>
      )}

      {/* Scrollable nav. Custom-styled scrollbar (thin, translucent
          thumb) so the default browser chrome doesn't render a white
          gutter on the dark-themed sidebar. */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto px-3 py-4',
          '[&::-webkit-scrollbar]:w-1.5',
          '[&::-webkit-scrollbar-track]:bg-transparent',
          '[&::-webkit-scrollbar-thumb]:rounded-full',
          '[&::-webkit-scrollbar-thumb]:bg-foreground/10',
          'hover:[&::-webkit-scrollbar-thumb]:bg-foreground/20',
          '[html[data-sidebar-theme=dark]_&]:[&::-webkit-scrollbar-thumb]:bg-white/10',
          '[html[data-sidebar-theme=dark]_&]:hover:[&::-webkit-scrollbar-thumb]:bg-white/20',
          '[scrollbar-width:thin]',
          '[scrollbar-color:rgba(255,255,255,0.10)_transparent]',
        )}
      >
        {sections.map((section) => (
          <div key={section.key} className={cn(collapsed ? 'mb-3' : 'mb-5')}>
            {!collapsed && (
              <p
                className={cn(
                  'px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70',
                  '[html[data-sidebar-theme=dark]_&]:text-zinc-500',
                )}
              >
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const badgeNumber =
                  item.badge === 'inboxUnread'
                    ? inboxCount
                    : item.badge === 'agentPending'
                      ? agentPendingCount
                      : null;
                return (
                  <li key={item.href}>
                    <NavRow
                      item={item}
                      active={active}
                      collapsed={collapsed}
                      badgeNumber={badgeNumber}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer — user card */}
      <UserCard collapsed={collapsed} user={user} tenantSlug={tenantSlug} />
    </aside>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  badgeNumber,
}: {
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  badgeNumber: number | null;
}): JSX.Element {
  const Icon = item.icon;
  const showBadge = !item.soon && badgeNumber !== null && badgeNumber > 0;
  if (item.soon) {
    return (
      <span
        aria-disabled
        className={cn(
          'flex cursor-not-allowed items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground/70',
          '[html[data-sidebar-theme=dark]_&]:text-zinc-500',
          collapsed && 'justify-center',
        )}
        title={collapsed ? item.label : undefined}
      >
        <span className="flex items-center gap-2.5">
          <Icon className="size-4 shrink-0" />
          {!collapsed && <span>{item.label}</span>}
        </span>
        {!collapsed && (
          <span
            className={cn(
              'rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground',
              '[html[data-sidebar-theme=dark]_&]:bg-white/5',
            )}
          >
            Soon
          </span>
        )}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
        active
          ? 'bg-accent font-medium text-accent-foreground [html[data-sidebar-theme=dark]_&]:bg-white/10 [html[data-sidebar-theme=dark]_&]:text-white'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground [html[data-sidebar-theme=dark]_&]:text-zinc-400 [html[data-sidebar-theme=dark]_&]:hover:bg-white/5 [html[data-sidebar-theme=dark]_&]:hover:text-white',
        collapsed && 'justify-center',
      )}
    >
      <span className="flex items-center gap-2.5">
        <Icon className="size-4 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </span>
      {!collapsed && (
        <span className="flex items-center gap-1.5">
          {showBadge && (
            <span className="grid min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {badgeNumber > 99 ? '99+' : badgeNumber}
            </span>
          )}
          {item.trailing === 'plus' && (
            <Sparkles className="size-3 text-muted-foreground/70 [html[data-sidebar-theme=dark]_&]:text-zinc-500" />
          )}
          {item.trailing === 'chevron' && (
            <ChevronRight className="size-3 text-muted-foreground/70" />
          )}
        </span>
      )}
    </Link>
  );
}

function UserCard({
  collapsed,
  user,
  tenantSlug,
}: {
  collapsed: boolean;
  user: { name: string | null; email: string; avatarUrl: string | null };
  tenantSlug: string;
}): JSX.Element {
  const initial = (user.name ?? user.email).trim()[0]?.toUpperCase() ?? '?';
  return (
    <div
      className={cn(
        'border-t p-3',
        '[html[data-sidebar-theme=dark]_&]:border-white/5',
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2">
          <Link
            href={`/t/${tenantSlug}/settings/profile`}
            className="grid size-9 place-items-center overflow-hidden rounded-full bg-emerald-500 text-sm font-semibold text-white"
            title={user.name ?? user.email}
          >
            {user.avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={user.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              initial
            )}
          </Link>
          <SignOutButton compact />
        </div>
      ) : (
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-lg p-1.5',
            '[html[data-sidebar-theme=dark]_&]:bg-white/[0.03]',
          )}
        >
          <Link
            href={`/t/${tenantSlug}/settings/profile`}
            className="relative grid size-9 place-items-center overflow-hidden rounded-full bg-emerald-500 text-sm font-semibold text-white"
          >
            {user.avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={user.avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              initial
            )}
            <span className="absolute -bottom-0 -right-0 size-2.5 rounded-full border-2 border-card bg-emerald-400 [html[data-sidebar-theme=dark]_&]:border-[#0E0F14]" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground [html[data-sidebar-theme=dark]_&]:text-white">
              {user.name ?? user.email}
            </p>
            <p className="truncate text-[10px] text-muted-foreground [html[data-sidebar-theme=dark]_&]:text-zinc-500">
              {user.name ? user.email : 'Member'}
            </p>
          </div>
          <SignOutButton />
        </div>
      )}
    </div>
  );
}

function SignOutButton({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        className={cn(
          'grid place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          '[html[data-sidebar-theme=dark]_&]:text-zinc-400 [html[data-sidebar-theme=dark]_&]:hover:bg-white/5 [html[data-sidebar-theme=dark]_&]:hover:text-white',
          compact ? 'size-7' : 'size-7',
        )}
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="size-3.5" />
      </button>
    </form>
  );
}

void ChevronsUpDown;
