'use client';

import Link from 'next/link';
import { ArrowRight, Bot, Mail, MessageSquare, Workflow } from 'lucide-react';

import { api } from '@/lib/trpc';

import { WidgetEmpty } from '../widget-card';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const KIND_META = {
  campaign_sent: { icon: Mail, color: 'text-sky-600 dark:text-sky-400' },
  approval: { icon: Bot, color: 'text-violet-600 dark:text-violet-400' },
  enrolment: { icon: Workflow, color: 'text-emerald-600 dark:text-emerald-400' },
} as const;

export function RecentActivityWidget({ tenantSlug }: { tenantSlug: string; days: number }): JSX.Element {
  const { data, isLoading } = api.dashboardPrefs.recentActivity.useQuery();
  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (data.length === 0) {
    return (
      <WidgetEmpty
        icon={<Mail className="size-8" />}
        title="No activity yet — things show up here as you send."
        cta={
          <Link
            href={`/t/${tenantSlug}/campaigns/new`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            Start a campaign <ArrowRight className="size-3" />
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y text-sm">
      {data.map((row) => {
        const meta = KIND_META[row.kind] ?? { icon: MessageSquare, color: 'text-muted-foreground' };
        const Icon = meta.icon;
        return (
          <li key={row.id} className="flex items-start gap-3 py-2">
            <Icon className={`mt-0.5 size-4 shrink-0 ${meta.color}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.title}</p>
              <p className="truncate text-xs text-muted-foreground">{row.sub}</p>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(row.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}

