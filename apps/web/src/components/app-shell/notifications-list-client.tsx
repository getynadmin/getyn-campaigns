'use client';

import Link from 'next/link';
import { Bell, CheckCheck, Mail } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

function timeAgo(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
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

/**
 * Full-page notifications list (/t/<slug>/notifications). Mirrors the
 * dropdown but with more room per row and larger hit targets.
 */
export function NotificationsListClient(): JSX.Element {
  const utils = api.useUtils();
  const list = api.notifications.list.useQuery({ limit: 100 });
  const markRead = api.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });
  const markAll = api.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });

  if (list.isLoading) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const items = list.data ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-6 py-14 text-center">
        <Mail className="mx-auto mb-3 size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">You're all caught up.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          We'll let you know when something needs your attention.
        </p>
      </div>
    );
  }

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="text-xs text-muted-foreground">
          {items.length} total · {unreadCount} unread
        </div>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || unreadCount === 0}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCheck className="size-3.5" />
          Mark all read
        </button>
      </div>

      <ul>
        {items.map((n) => {
          const unreadRow = !n.readAt;
          const body = (
            <div
              className={cn(
                'relative flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/50',
                unreadRow && 'bg-orange-50/40 dark:bg-orange-950/15',
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
                  'mt-0.5 grid size-8 shrink-0 place-items-center rounded-md',
                  unreadRow
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <Bell className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'truncate text-sm',
                    unreadRow
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {n.title}
                </div>
                {n.body ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {n.body}
                  </div>
                ) : null}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
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
                <Link href={n.href} onClick={onActivate}>
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onActivate}
                  className="block w-full text-left"
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
