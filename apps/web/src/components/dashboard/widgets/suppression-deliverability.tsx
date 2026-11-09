'use client';

import Link from 'next/link';
import { ArrowRight, ShieldAlert } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

import { WidgetEmpty } from '../widget-card';

/**
 * Compact deliverability snapshot: sends, bounce rate, complaint
 * rate, and a derived score (100 - 50*bounceRate - 100*complaintRate
 * clamped 0-100) coloured green/amber/red.
 */
export function SuppressionDeliverabilityWidget({
  tenantSlug,
  days,
}: {
  tenantSlug: string;
  days: number;
}): JSX.Element {
  const { data, isLoading } = api.analytics.deliverability.useQuery({ days });
  if (isLoading || !data) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  }
  if (data.sent === 0) {
    return (
      <WidgetEmpty
        icon={<ShieldAlert className="size-8" />}
        title="No sends in this period."
        cta={
          <Link
            href={`/t/${tenantSlug}/suppression`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            View suppression list <ArrowRight className="size-3" />
          </Link>
        }
      />
    );
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - 50 * data.bounceRate - 100 * data.complaintRate)));
  const tone = score >= 90 ? 'green' : score >= 70 ? 'amber' : 'red';
  return (
    <div className="space-y-3">
      <div
        className={cn(
          'rounded-lg border p-3 text-center',
          tone === 'green' && 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/20',
          tone === 'amber' && 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20',
          tone === 'red' && 'border-rose-300 bg-rose-50/70 dark:border-rose-800 dark:bg-rose-950/20',
        )}
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Deliverability score
        </p>
        <p
          className={cn(
            'font-display text-3xl font-semibold tabular-nums',
            tone === 'green' && 'text-emerald-700 dark:text-emerald-300',
            tone === 'amber' && 'text-amber-700 dark:text-amber-300',
            tone === 'red' && 'text-rose-700 dark:text-rose-300',
          )}
        >
          {score}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Sent</dt>
          <dd className="font-display text-sm font-semibold tabular-nums">{data.sent.toLocaleString()}</dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Bounce</dt>
          <dd className="font-display text-sm font-semibold tabular-nums">
            {(data.bounceRate * 100).toFixed(2)}%
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">Complaint</dt>
          <dd className="font-display text-sm font-semibold tabular-nums">
            {(data.complaintRate * 100).toFixed(2)}%
          </dd>
        </div>
      </dl>
    </div>
  );
}
