'use client';

import Link from 'next/link';
import { ArrowRight, Trophy } from 'lucide-react';

import { api } from '@/lib/trpc';

import { WidgetEmpty } from '../widget-card';

/**
 * Top 10 email campaigns by open rate in the current window.
 * Mirrors the Analytics → Email tab shape.
 */
export function TopCampaignsWidget({
  tenantSlug,
  days,
}: {
  tenantSlug: string;
  days: number;
}): JSX.Element {
  const { data, isLoading } = api.analytics.emailCampaigns.useQuery({ days });
  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  const scored = [...data]
    .filter((c) => c.sent > 0)
    .map((c) => ({ ...c, openRate: c.opened / c.sent }))
    .sort((a, b) => b.openRate - a.openRate)
    .slice(0, 10);
  if (scored.length === 0) {
    return (
      <WidgetEmpty
        icon={<Trophy className="size-8" />}
        title="No sent campaigns yet."
        cta={
          <Link
            href={`/t/${tenantSlug}/campaigns/new`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            Send your first <ArrowRight className="size-3" />
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y text-sm">
      {scored.map((c, i) => (
        <li key={c.id}>
          <Link
            href={`/t/${tenantSlug}/campaigns/${c.id}`}
            className="flex items-center gap-3 py-2 transition-colors hover:bg-muted/60"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <p className="min-w-0 flex-1 truncate font-medium">{c.name}</p>
            <span className="shrink-0 text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
              {(c.openRate * 100).toFixed(1)}%
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
