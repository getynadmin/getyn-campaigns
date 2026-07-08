'use client';

import Link from 'next/link';
import { Bot, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

import { FirstVisitHint } from '@/components/automation/first-visit-hint';

/**
 * List page for Email Agents. Click into one for detail / edit; the
 * Create button routes to the new-agent wizard.
 *
 * Pending-approval count is aggregated on the server so this stays a
 * single round-trip.
 */
export function EmailAgentsListClient({ slug }: { slug: string }): JSX.Element {
  const { data, isLoading } = api.emailAgent.list.useQuery();
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Email agents</h1>
          <p className="text-sm text-muted-foreground">
            Autonomous AI that sends outreach and drafts replies. Every reply
            draft waits for your approval before sending — no exceptions.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={`/t/${slug}/automation/agents/new`}>
            <Plus className="mr-1 size-4" /> Create agent
          </Link>
        </Button>
      </header>

      <FirstVisitHint
        storageKey="getyn:hint:automation-agents"
        title="Email agents run 1:1 conversations"
      >
        <p>
          Point an agent at a segment with a goal, a tone, and a knowledge base
          — it drafts initial outreach and follow-ups automatically. Every
          reply the agent writes to your customers waits for your approval in
          the inbox.
        </p>
      </FirstVisitHint>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState slug={slug} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data?.items.map((row) => (
            <li key={row.id}>
              <Link
                href={`/t/${slug}/automation/agents/${row.id}`}
                className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    <StatusBadge status={row.status} />
                    {row.pendingApprovals > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {row.pendingApprovals} awaiting approval
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {row.goal}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {row._count.enrollments.toLocaleString()} enrolled ·{' '}
                    {row._count.knowledgeSources} knowledge sources · from{' '}
                    <span className="font-mono">{row.fromEmail}</span>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ slug }: { slug: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Bot className="mx-auto size-8 opacity-30" />
      <p className="mt-3 font-medium">No agents yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Give the agent a goal, some knowledge sources, and a segment to enroll
        from — it will handle outreach + first-pass reply drafting for you.
      </p>
      <Button asChild className="mt-4">
        <Link href={`/t/${slug}/automation/agents/new`}>
          <Plus className="mr-1 size-4" /> Create your first agent
        </Link>
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    ACTIVE:
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    PAUSED:
      'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ARCHIVED: 'bg-muted text-muted-foreground opacity-70',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
        map[status],
      )}
    >
      {status}
    </span>
  );
}
