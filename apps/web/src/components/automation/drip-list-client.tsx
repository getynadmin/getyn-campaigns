'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

import { FirstVisitHint } from './first-visit-hint';

/**
 * Drip list — a table of automations with status pill + trigger
 * summary + enrolled count. "Create" opens a small name dialog that
 * routes to the builder on success.
 */
export function DripAutomationsListClient({
  slug,
}: {
  slug: string;
}): JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = api.automation.list.useQuery();
  // Live per-automation status breakdown. Polls every 30s while the
  // page is open; single query returns counts for every row.
  const bulkStats = api.automation.aggregateStatsBulk.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Drip campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Multi-step programs that run over days or weeks, branching on what
            your contacts do.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" /> Create automation
        </Button>
      </header>

      <FirstVisitHint
        storageKey="getyn:hint:automation-drip"
        title="Drip campaigns are marketing programs"
      >
        <p>
          Build a visual workflow — trigger, waits, splits, and messages — that
          runs over days or weeks per enrolled contact. Draft a flow, mark
          message nodes Live one by one, then activate to start enrolling.
        </p>
      </FirstVisitHint>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data?.items.map((row) => (
            <li key={row.id}>
              <Link
                href={`/t/${slug}/automation/drip/${row.id}/edit`}
                className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {triggerSummary(row.trigger)} ·{' '}
                    {row._count.enrollments.toLocaleString()} enrolled
                    {(() => {
                      const s = bulkStats.data?.[row.id];
                      if (!s || s.active + s.completed === 0) return null;
                      return (
                        <>
                          {' · '}
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {s.active.toLocaleString()} active
                          </span>
                          {s.completed > 0 && (
                            <>
                              {' · '}
                              <span className="text-muted-foreground">
                                {s.completed.toLocaleString()} completed
                              </span>
                            </>
                          )}
                        </>
                      );
                    })()}
                    {row.lastActivatedAt && (
                      <>
                        {' · Activated '}
                        {new Date(row.lastActivatedAt).toLocaleDateString()}
                      </>
                    )}
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  Edited {relTime(row.lastEditedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateAutomationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        slug={slug}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Workflow className="mx-auto size-8 opacity-30" />
      <p className="mt-3 font-medium">No automations yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Create your first drip campaign — welcome series, abandoned cart,
        re-engagement — with a visual workflow builder.
      </p>
      <Button className="mt-4" onClick={onCreate}>
        <Plus className="mr-1 size-4" /> Create your first automation
      </Button>
    </div>
  );
}

function CreateAutomationDialog({
  open,
  onOpenChange,
  slug,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
}): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const utils = api.useUtils();
  const create = api.automation.create.useMutation({
    onSuccess: (data) => {
      void utils.automation.list.invalidate();
      onOpenChange(false);
      router.push(`/t/${slug}/automation/drip/${data.id}/edit`);
    },
    onError: (err) => toast.error(err.message),
  });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    create.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New automation</DialogTitle>
          <DialogDescription>
            Give it a name — you can rename anytime.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome series"
              autoFocus
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="3 emails over 2 weeks for new signups"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
              {create.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
              Create & open builder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    ACTIVE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    PAUSED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ARCHIVED: 'bg-muted text-muted-foreground opacity-70',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide', map[status])}>
      {status}
    </span>
  );
}

function triggerSummary(trigger: unknown): string {
  if (!trigger || typeof trigger !== 'object') return 'Manual enrollment';
  const t = trigger as { kind?: string };
  switch (t.kind) {
    case 'manual_enrollment':
      return 'Manual enrollment';
    case 'contact_added_to_segment':
      return 'When contact enters segment';
    case 'tag_applied':
      return 'When tag applied';
    case 'date_field_matches':
      return 'When date field matches';
    case 'webhook':
      return 'Webhook trigger';
    default:
      return String(t.kind ?? 'Trigger');
  }
}

function relTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return date.toLocaleDateString();
}
