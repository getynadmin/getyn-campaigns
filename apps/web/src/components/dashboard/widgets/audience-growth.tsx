'use client';

import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';

import { api } from '@/lib/trpc';
import { LineChart as SvgLineChart } from '@/components/analytics/mini-charts';

import { WidgetEmpty } from '../widget-card';

/**
 * Contact growth over the analytics window — cumulative line drawn
 * from the audience.trend buckets so the shape reads as "we're
 * growing" rather than per-day noise.
 */
export function AudienceGrowthWidget({
  tenantSlug,
  days,
}: {
  tenantSlug: string;
  days: number;
}): JSX.Element {
  const { data, isLoading } = api.analytics.audience.useQuery({ days });
  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (data.totalContacts === 0) {
    return (
      <WidgetEmpty
        icon={<Users className="size-8" />}
        title="No contacts yet."
        cta={
          <Link
            href={`/t/${tenantSlug}/contacts?import=1`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            Import contacts <ArrowRight className="size-3" />
          </Link>
        }
      />
    );
  }
  // Running sum so the line trends up — more intuitive than a noisy
  // daily-add bar for a small widget.
  const base = Math.max(0, data.totalContacts - data.newContacts);
  let running = base;
  const values = data.trend.map((t) => {
    running += t.count;
    return running;
  });
  const labels = data.trend.map((t) =>
    new Date(t.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  );
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <p className="font-display text-2xl font-semibold tabular-nums">
          {data.totalContacts.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground">
          +{data.newContacts.toLocaleString()} in {days}d
        </p>
      </div>
      {values.length > 1 ? (
        <SvgLineChart
          labels={labels}
          series={[{ name: 'Contacts', color: '#10b981', values }]}
          height={120}
        />
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Not enough days yet — showing a line once we have &gt;1 bucket.
        </p>
      )}
    </div>
  );
}
