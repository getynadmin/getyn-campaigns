'use client';

import { ArrowDownRight, ArrowUpRight, MousePointerClick, Send, Target, Users } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

import { WidgetEmpty } from '../widget-card';

/**
 * Top-of-dashboard KPI row — 4 tiles (contacts, campaigns sent, open
 * rate, click rate) with ↑/↓ delta vs the prior equal-length window.
 */
export function KpiTilesWidget({ days }: { days: number; tenantSlug: string }): JSX.Element {
  const { data, isLoading } = api.dashboardPrefs.kpis.useQuery({ days });
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }
  if (data.contacts === 0 && data.campaignsSent === 0) {
    return (
      <WidgetEmpty
        icon={<Users className="size-8" />}
        title="No data yet — add contacts to start seeing KPIs."
      />
    );
  }
  const tiles = [
    { label: 'Contacts', value: data.contacts.toLocaleString(), icon: Users, delta: null },
    {
      label: 'Campaigns sent',
      value: data.campaignsSent.toLocaleString(),
      icon: Send,
      delta: data.campaignsSentDelta,
    },
    {
      label: 'Open rate',
      value: `${(data.openRate * 100).toFixed(1)}%`,
      icon: Target,
      delta: data.openRateDelta,
    },
    {
      label: 'Click rate',
      value: `${(data.clickRate * 100).toFixed(1)}%`,
      icon: MousePointerClick,
      delta: data.clickRateDelta,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        const pos = t.delta !== null && t.delta >= 0;
        return (
          <div
            key={t.label}
            className="rounded-lg border bg-gradient-to-br from-white to-emerald-50/30 p-3 dark:from-card dark:to-emerald-950/20"
          >
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <Icon className="size-3.5" />
              </span>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t.label}
              </p>
            </div>
            <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums leading-none">
              {t.value}
            </p>
            {t.delta !== null ? (
              <p
                className={cn(
                  'mt-1 flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
                  pos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {pos ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                {(Math.abs(t.delta) * 100).toFixed(1)}% vs prior {days}d
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No prior-period data
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
