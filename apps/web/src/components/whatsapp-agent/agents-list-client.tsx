'use client';

import Link from 'next/link';
import { MessageSquare, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export function WhatsappAgentsListClient({ slug }: { slug: string }): JSX.Element {
  const { data, isLoading } = api.whatsappAgent.list.useQuery();
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">WhatsApp agents</h1>
          <p className="text-sm text-muted-foreground">
            Autonomous AI that sends WhatsApp outreach with an approved template,
            then follows up + drafts replies inside the 24h session window.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={`/t/${slug}/automation/whatsapp-agents/new`}>
            <Plus className="mr-1 size-4" /> Create agent
          </Link>
        </Button>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-16 w-full" />))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState slug={slug} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data?.items.map((row) => (
            <li key={row.id} className="flex items-stretch">
              <Link href={`/t/${slug}/automation/whatsapp-agents/${row.id}`}
                className="flex flex-1 items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.goal}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {row._count.enrollments.toLocaleString()} enrolled · from{' '}
                    <span className="font-mono">{row.phoneNumber?.phoneNumber ?? '(no phone)'}</span>
                  </p>
                </div>
              </Link>
              <Link href={`/t/${slug}/automation/whatsapp-agents/${row.id}/board`}
                className="flex shrink-0 items-center gap-1 border-l px-3 text-xs text-muted-foreground transition hover:bg-muted/40 hover:text-foreground">
                Board →
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
      <MessageSquare className="mx-auto size-8 opacity-30" />
      <p className="mt-3 font-medium">No agents yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick an approved template, a persona, and a segment to enroll from — the agent handles the rest.
      </p>
      <Button asChild className="mt-4">
        <Link href={`/t/${slug}/automation/whatsapp-agents/new`}>
          <Plus className="mr-1 size-4" /> Create your first agent
        </Link>
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    ACTIVE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    PAUSED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ARCHIVED: 'bg-muted text-muted-foreground opacity-70',
  };
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide', map[status])}>{status}</span>;
}
