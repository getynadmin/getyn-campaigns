'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  BellRing,
  Bot,
  CheckCheck,
  CircleDollarSign,
  Clock,
  Mail,
  MailCheck,
  MessageSquare,
  Phone,
  ShieldAlert,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  CAMPAIGN_SENT: Mail,
  CAMPAIGN_SCHEDULED: Clock,
  CAMPAIGN_FAILED: ShieldAlert,
  AGENT_HANDOFF_PENDING: Bot,
  SEGMENT_READY: Sparkles,
  DOMAIN_VERIFIED: MailCheck,
  TRIAL_ENDING_SOON: Clock,
  PLAN_UPGRADED: CircleDollarSign,
  SMS_DELIVERY_ISSUE: Phone,
  WABA_DISCONNECTED: MessageSquare,
  FLOW_ENROLLED_HIGH: Workflow,
};

/**
 * Relative "2d ago" / "just now" string. Falls back to a locale date
 * once past 14 days.
 */
function timeAgo(d: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function NotificationsBell({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const utils = api.useUtils();

  const unread = api.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const list = api.notifications.list.useQuery(
    { limit: 25 },
    { enabled: open },
  );
  const markRead = api.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });
  const markAll = api.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(t)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const count = unread.data?.count ?? 0;
  const badge = useMemo(() => {
    if (!count) return null;
    if (count > 9) return '9+';
    return String(count);
  }, [count]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {count > 0 ? (
          <BellRing className="size-4" />
        ) : (
          <Bell className="size-4" />
        )}
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full bg-orange-500 px-1 text-[9px] font-semibold text-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="text-sm font-semibold">Notifications</div>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || count === 0}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCheck className="size-3" />
              Mark all read
            </button>
          </div>

          <div className="scrollbar-thin max-h-[420px] overflow-y-auto">
            {list.isLoading ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Loading…
              </div>
            ) : !list.data || list.data.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                <Mail className="mx-auto mb-2 size-5 opacity-50" />
                You're all caught up.
              </div>
            ) : (
              <ul>
                {list.data.map((n) => {
                  const Icon = ICONS[n.kind] ?? Bell;
                  const unreadRow = !n.readAt;
                  const Row = (
                    <div
                      className={cn(
                        'relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60',
                        unreadRow && 'bg-orange-50/50 dark:bg-orange-950/20',
                      )}
                    >
                      {unreadRow ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 w-0.5 bg-orange-500"
                        />
                      ) : null}
                      <span
                        className={cn(
                          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md',
                          unreadRow
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-xs',
                            unreadRow
                              ? 'font-semibold text-foreground'
                              : 'text-muted-foreground',
                          )}
                        >
                          {n.title}
                        </div>
                        {n.body ? (
                          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {n.body}
                          </div>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(new Date(n.createdAt))}
                      </span>
                    </div>
                  );
                  const onActivate = (): void => {
                    if (unreadRow) markRead.mutate({ id: n.id });
                  };
                  return (
                    <li key={n.id} className="border-b last:border-b-0">
                      {n.href ? (
                        <Link
                          href={n.href}
                          onClick={() => {
                            onActivate();
                            setOpen(false);
                          }}
                        >
                          {Row}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={onActivate}
                          className="block w-full text-left"
                        >
                          {Row}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t px-4 py-2.5 text-center">
            <Link
              href={`/t/${tenantSlug}/notifications`}
              onClick={() => setOpen(false)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
