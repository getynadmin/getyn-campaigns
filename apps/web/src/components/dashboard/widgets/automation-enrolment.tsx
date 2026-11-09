'use client';

import Link from 'next/link';
import { ArrowRight, Workflow } from 'lucide-react';

import { api } from '@/lib/trpc';

import { WidgetEmpty } from '../widget-card';

/**
 * Active drip/flow enrolments + completion rate. Lists the top 5
 * flows by active count with a tiny progress bar for completion.
 */
export function AutomationEnrolmentWidget({
  tenantSlug,
  days,
}: {
  tenantSlug: string;
  days: number;
}): JSX.Element {
  const { data, isLoading } = api.analytics.automations.useQuery({ days });
  if (isLoading || !data) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (data.length === 0) {
    return (
      <WidgetEmpty
        icon={<Workflow className="size-8" />}
        title="No active automations."
        cta={
          <Link
            href={`/t/${tenantSlug}/automation/drip`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            Create a flow <ArrowRight className="size-3" />
          </Link>
        }
      />
    );
  }
  const rows = [...data].sort((a, b) => b.active - a.active).slice(0, 5);
  return (
    <ul className="space-y-2.5 text-sm">
      {rows.map((r) => {
        const pct = r.total === 0 ? 0 : Math.round((r.completed / r.total) * 100);
        return (
          <li key={r.id}>
            <Link
              href={`/t/${tenantSlug}/automation/drip`}
              className="block rounded-lg border p-2.5 transition-colors hover:bg-muted/60"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{r.name}</p>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {r.active} active · {pct}% completed
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
