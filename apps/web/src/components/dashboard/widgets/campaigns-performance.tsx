'use client';

import Link from 'next/link';
import { ArrowRight, LineChart } from 'lucide-react';

import { api } from '@/lib/trpc';
import { LineChart as SvgLineChart } from '@/components/analytics/mini-charts';

import { WidgetEmpty } from '../widget-card';

/**
 * Opens + clicks line chart over the current date range. Reuses the
 * analytics overview endpoint so it benefits from any cache the
 * analytics page already warmed.
 */
export function CampaignsPerformanceWidget({
  tenantSlug,
  days,
}: {
  tenantSlug: string;
  days: number;
}): JSX.Element {
  const { data, isLoading } = api.analytics.overview.useQuery({ days });
  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (data.trend.length === 0) {
    return (
      <WidgetEmpty
        icon={<LineChart className="size-8" />}
        title="No sends in this period yet."
        cta={
          <Link
            href={`/t/${tenantSlug}/campaigns/new`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            Create a campaign <ArrowRight className="size-3" />
          </Link>
        }
      />
    );
  }
  const labels = data.trend.map((t) =>
    new Date(t.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  );
  return (
    <SvgLineChart
      labels={labels}
      series={[
        { name: 'Opens', color: '#10b981', values: data.trend.map((t) => t.opened) },
        { name: 'Clicks', color: '#0ea5e9', values: data.trend.map((t) => t.clicked) },
      ]}
      height={180}
    />
  );
}
