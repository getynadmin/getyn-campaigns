'use client';

import Link from 'next/link';
import { ArrowRight, Bot } from 'lucide-react';

import { api } from '@/lib/trpc';

import { WidgetEmpty } from '../widget-card';

/**
 * Autonomous agent activity snapshot — conversations handled in the
 * window, split by status, with a prominent pending-approvals CTA
 * when the operator has work waiting.
 */
export function AgentActivityWidget({
  tenantSlug,
  days,
}: {
  tenantSlug: string;
  days: number;
}): JSX.Element {
  const { data, isLoading } = api.analytics.agents.useQuery({ days });
  if (isLoading || !data) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  }
  if (data.totalConversations === 0 && data.pendingApprovals === 0) {
    return (
      <WidgetEmpty
        icon={<Bot className="size-8" />}
        title="No agent conversations yet."
        cta={
          <Link
            href={`/t/${tenantSlug}/automation/autonomous`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline"
          >
            Set up an agent <ArrowRight className="size-3" />
          </Link>
        }
      />
    );
  }
  const stats = [
    { label: 'Conversations', value: data.totalConversations },
    { label: 'Active', value: data.byStatus.ACTIVE ?? 0 },
    { label: 'Completed', value: data.byStatus.COMPLETED_DRAFT_CREATED ?? 0 },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-2.5 text-center">
            <p className="font-display text-xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      {data.pendingApprovals > 0 ? (
        <Link
          href={`/t/${tenantSlug}/automation/agents/inbox`}
          className="group flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50/50 px-3 py-2 text-sm transition-colors hover:bg-amber-100/60 dark:border-amber-800 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
        >
          <span className="font-medium text-amber-900 dark:text-amber-200">
            {data.pendingApprovals} reply{data.pendingApprovals === 1 ? '' : 'ies'} waiting for approval
          </span>
          <ArrowRight className="size-4 text-amber-900 transition-transform group-hover:translate-x-0.5 dark:text-amber-200" />
        </Link>
      ) : null}
    </div>
  );
}
