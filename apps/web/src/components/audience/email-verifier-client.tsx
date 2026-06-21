'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  ShieldOff,
  Trash2,
  Type,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Category =
  | 'INVALID_SYNTAX'
  | 'ALREADY_BOUNCED'
  | 'TYPO_SUSPICIOUS'
  | 'DISPOSABLE'
  | 'ROLE_BASED'
  | 'DEAD_DOMAIN';

const CATEGORY_META: Record<
  Category,
  {
    label: string;
    description: string;
    icon: typeof AlertCircle;
    tone: string;
  }
> = {
  INVALID_SYNTAX: {
    label: 'Invalid syntax',
    description: 'Addresses that fail strict email format validation.',
    icon: AlertCircle,
    tone: 'border-rose-300 bg-rose-50/40 dark:border-rose-900 dark:bg-rose-950/20',
  },
  ALREADY_BOUNCED: {
    label: 'Already bounced',
    description: 'Hard-bounced on a previous campaign — almost never recover.',
    icon: ShieldOff,
    tone: 'border-orange-300 bg-orange-50/40 dark:border-orange-900 dark:bg-orange-950/20',
  },
  TYPO_SUSPICIOUS: {
    label: 'Likely typo',
    description: 'Domain matches a known typo of a popular provider.',
    icon: Type,
    tone: 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
  },
  DISPOSABLE: {
    label: 'Disposable',
    description: 'Throwaway / temp-mail domains.',
    icon: Clock,
    tone: 'border-sky-300 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20',
  },
  ROLE_BASED: {
    label: 'Role inbox',
    description: 'admin@, info@, no-reply@ — typically forwarded, rarely read.',
    icon: Zap,
    tone: 'border-violet-300 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20',
  },
  DEAD_DOMAIN: {
    label: 'Dead domain',
    description:
      'Domain has no MX record — mail can never be delivered. Detected via deep scan.',
    icon: Globe,
    tone: 'border-fuchsia-300 bg-fuchsia-50/40 dark:border-fuchsia-900 dark:bg-fuchsia-950/20',
  },
};

const CATEGORY_ORDER: Category[] = [
  'INVALID_SYNTAX',
  'ALREADY_BOUNCED',
  'TYPO_SUSPICIOUS',
  'DISPOSABLE',
  'DEAD_DOMAIN',
  'ROLE_BASED',
];

export function EmailVerifierClient({
  canCleanup,
}: {
  canCleanup: boolean;
}): JSX.Element {
  const utils = api.useUtils();
  const { data: basicData, isLoading, isFetching, refetch } =
    api.emailVerifier.scan.useQuery(undefined, {
      // Manual-only — scan touches every contact, refetching on focus
      // would be expensive.
      refetchOnWindowFocus: false,
    });

  // Deep scan result is held client-side — running it is a mutation
  // (long-running, opt-in) so we don't want React Query to consider
  // it stale and refetch.
  const [deepData, setDeepData] = useState<typeof basicData | null>(null);

  // Active data is the deep scan when present, otherwise basic.
  const data = deepData ?? basicData;

  const [selected, setSelected] = useState<Set<Category>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deepScan = api.emailVerifier.deepScan.useMutation({
    onSuccess: (res) => {
      setDeepData(res);
      const deadDomains = res.byCategory.DEAD_DOMAIN;
      toast.success(
        deadDomains > 0
          ? `Deep scan done — found ${deadDomains.toLocaleString()} contact${deadDomains === 1 ? '' : 's'} on dead domains.`
          : 'Deep scan done — no dead domains detected.',
      );
    },
    onError: (err) =>
      toast.error(err.message ?? 'Deep scan failed — try again.'),
  });

  const cleanup = api.emailVerifier.cleanup.useMutation({
    onSuccess: (res) => {
      toast.success(
        `${res.updated} contact${res.updated === 1 ? '' : 's'} marked unsubscribed.`,
      );
      setSelected(new Set());
      setConfirmOpen(false);
      setDeepData(null); // force a fresh re-scan / re-deep-scan if user wants
      void utils.emailVerifier.scan.invalidate();
    },
    onError: (err) => toast.error(err.message ?? 'Cleanup failed.'),
  });

  const selectedCount = useMemo(() => {
    if (!data) return 0;
    let total = 0;
    for (const c of selected) total += data.byCategory[c];
    return total;
  }, [data, selected]);

  function toggle(c: Category): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load the scan.
        </p>
        <Button onClick={() => void refetch()} className="mt-3" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Summary banner */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-foreground/50">
            Active contacts scanned
          </div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
            {data.totalContacts.toLocaleString()}
          </div>
        </div>
        <div
          className={cn(
            'rounded-lg border p-4',
            data.totalFlagged > 0
              ? 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20'
              : 'bg-card',
          )}
        >
          <div className="text-xs uppercase tracking-wider text-foreground/50">
            Flagged
          </div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
            {data.totalFlagged.toLocaleString()}
            <span className="ml-2 text-sm font-normal text-foreground/60">
              (
              {data.totalContacts > 0
                ? ((data.totalFlagged / data.totalContacts) * 100).toFixed(1)
                : '0.0'}
              %)
            </span>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-foreground/50">
            Healthy
          </div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
            {(data.totalContacts - data.totalFlagged).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching || deepScan.isPending}
            onClick={() => {
              setDeepData(null);
              void refetch();
            }}
          >
            {isFetching ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : null}
            Re-scan
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={deepScan.isPending || isFetching}
            onClick={() => deepScan.mutate()}
            title="Probe MX records for every domain — slower (~20s for ~2k unique domains) but catches dead domains."
          >
            {deepScan.isPending ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <Globe className="mr-2 size-3.5" />
            )}
            {deepScan.isPending ? 'Deep scanning…' : 'Deep scan (MX check)'}
          </Button>
        </div>
        {data.mxChecked ? (
          <span className="text-xs text-foreground/60">
            ✓ Dead-domain check included
          </span>
        ) : (
          <span className="text-xs text-foreground/40">
            Dead-domain check skipped — run Deep scan to include it
          </span>
        )}
      </div>

      {/* Per-category cards */}
      <div className="space-y-3">
        {CATEGORY_ORDER.filter(
          (c) => c !== 'DEAD_DOMAIN' || data.mxChecked,
        ).map((c) => {
          const meta = CATEGORY_META[c];
          const Icon = meta.icon;
          const count = data.byCategory[c];
          const samples = data.samples[c];
          const isSelected = selected.has(c);
          const disabled = count === 0;
          return (
            <div
              key={c}
              className={cn(
                'rounded-lg border transition-colors',
                meta.tone,
                disabled && 'opacity-60',
                isSelected && 'ring-2 ring-foreground/30',
              )}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-foreground disabled:opacity-50"
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => toggle(c)}
                  aria-label={`Select ${meta.label}`}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4" />
                    <h3 className="font-display text-sm font-semibold tracking-tight">
                      {meta.label}
                    </h3>
                    <span className="ml-auto rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium tabular-nums">
                      {count.toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-foreground/70">
                    {meta.description}
                  </p>
                  {samples.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {samples.slice(0, 5).map((s) => (
                        <li
                          key={s.contactId}
                          className="flex items-center gap-2 text-foreground/80"
                        >
                          <span className="truncate font-mono">{s.email}</span>
                          {s.detail && (
                            <span className="rounded bg-background/60 px-1.5 py-0.5 text-[10px] text-foreground/60">
                              {s.detail}
                            </span>
                          )}
                        </li>
                      ))}
                      {count > samples.length && (
                        <li className="text-[11px] text-foreground/50">
                          + {count - samples.length} more
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action footer */}
      <div className="sticky bottom-4 mt-6 flex items-center justify-between rounded-lg border bg-card/95 px-4 py-3 shadow-md backdrop-blur">
        <div className="text-sm">
          {selected.size === 0 ? (
            <span className="text-foreground/60">
              Select one or more categories to clean.
            </span>
          ) : (
            <span>
              <strong className="tabular-nums">{selectedCount.toLocaleString()}</strong>{' '}
              contact{selectedCount === 1 ? '' : 's'} will be marked{' '}
              <strong>unsubscribed</strong>.
            </span>
          )}
        </div>
        <Button
          disabled={
            !canCleanup ||
            selected.size === 0 ||
            selectedCount === 0 ||
            cleanup.isPending
          }
          onClick={() => setConfirmOpen(true)}
          title={
            canCleanup
              ? undefined
              : 'Only owners and admins can run cleanup.'
          }
        >
          {cleanup.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 size-4" />
          )}
          Mark as unsubscribed
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark contacts unsubscribed?</DialogTitle>
            <DialogDescription>
              {selectedCount.toLocaleString()} contact
              {selectedCount === 1 ? '' : 's'} across{' '}
              {selected.size === 1 ? 'this category' : 'these categories'} will
              be set to <strong>UNSUBSCRIBED</strong>. They stay in your
              contact list (for audit) but campaigns will skip them. This is
              reversible per-contact but not as a single bulk action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            {[...selected].map((c) => (
              <div key={c} className="flex items-center justify-between">
                <span>{CATEGORY_META[c].label}</span>
                <span className="tabular-nums text-foreground/70">
                  {data.byCategory[c].toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={cleanup.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                cleanup.mutate({ categories: Array.from(selected) })
              }
              disabled={cleanup.isPending}
            >
              {cleanup.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 size-4" />
              )}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CleanupHistory />
    </>
  );
}

/**
 * Cleanup history — list of past Email Verifier bulk-unsubscribe
 * runs with drill-down to the affected emails. Runs at the bottom
 * of the page; auto-refreshes after a cleanup succeeds (we depend
 * on tRPC's invalidation in the cleanup mutation).
 */
function CleanupHistory(): JSX.Element {
  const utils = api.useUtils();
  const history = api.emailVerifier.history.useQuery();
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  // Refresh history after any cleanup succeeds — easiest path is to
  // invalidate when the cleanup query cache changes. The parent
  // component already calls utils.emailVerifier.scan.invalidate;
  // mirror that here for history.
  useEffect(() => {
    void utils.emailVerifier.history.invalidate();
    // We deliberately depend on the basic-scan cache key so a fresh
    // scan or cleanup triggers a history refresh too.
  }, [utils]);

  return (
    <section className="mt-10">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Cleanup history
        </h2>
        <span className="text-xs text-foreground/50">
          Last 20 runs
        </span>
      </header>

      {history.isLoading ? (
        <Skeleton className="h-24" />
      ) : !history.data || history.data.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-foreground/60">
          No cleanups run yet. Pick categories above and click{' '}
          <strong>Mark as unsubscribed</strong> to record one.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {history.data.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => setOpenRunId(run.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">
                      {run.totalCount.toLocaleString()}
                    </span>
                    <span className="text-sm text-foreground/70">
                      contact{run.totalCount === 1 ? '' : 's'} marked unsubscribed
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/60">
                    <span>
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                    {run.runBy && (
                      <>
                        <span>·</span>
                        <span>by {run.runBy.name ?? run.runBy.email}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {run.categories.map((c) => {
                      const cat = c as Category;
                      const meta = CATEGORY_META[cat];
                      const count = run.countByCategory[c] ?? 0;
                      return (
                        <span
                          key={c}
                          className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px]"
                        >
                          {meta ? meta.label : c}
                          <span className="font-medium tabular-nums">
                            {count.toLocaleString()}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
                <span className="text-xs text-foreground/40">View →</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openRunId && (
        <RunDetailDialog
          runId={openRunId}
          onClose={() => setOpenRunId(null)}
        />
      )}
    </section>
  );
}

/**
 * Detail modal for one cleanup run. Shows per-category counts at
 * the top and the affected contact emails as a scrollable list.
 * Each row shows current status (lets the user spot contacts
 * re-subscribed after the cleanup).
 */
function RunDetailDialog({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}): JSX.Element {
  const detail = api.emailVerifier.runDetail.useQuery({ runId });
  const [filter, setFilter] = useState('');

  const contacts = detail.data?.contacts ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const hay = `${c.email ?? ''} ${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [contacts, filter]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cleanup run detail</DialogTitle>
          <DialogDescription>
            {detail.isLoading
              ? 'Loading…'
              : detail.data
                ? `${detail.data.totalCount.toLocaleString()} contacts marked unsubscribed on ${new Date(
                    detail.data.createdAt,
                  ).toLocaleString()}.`
                : 'Run not found.'}
          </DialogDescription>
        </DialogHeader>

        {detail.data && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {detail.data.categories.map((c) => {
                const cat = c as Category;
                const meta = CATEGORY_META[cat];
                const count = detail.data?.countByCategory[c] ?? 0;
                return (
                  <span
                    key={c}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
                      meta?.tone,
                    )}
                  >
                    {meta?.label ?? c}
                    <span className="font-medium tabular-nums">
                      {count.toLocaleString()}
                    </span>
                  </span>
                );
              })}
            </div>

            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by email or name…"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30"
            />

            <div className="max-h-[50vh] overflow-y-auto rounded-md border">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-foreground/60">
                  No contacts match the filter.
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono">
                          {c.email ?? '(no email)'}
                        </div>
                        {(c.firstName || c.lastName) && (
                          <div className="truncate text-[10px] text-foreground/60">
                            {[c.firstName, c.lastName].filter(Boolean).join(' ')}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                          c.currentEmailStatus === 'UNSUBSCRIBED'
                            ? 'border-muted-foreground/40 text-muted-foreground'
                            : 'border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300',
                        )}
                        title={
                          c.currentEmailStatus === 'UNSUBSCRIBED'
                            ? 'Still unsubscribed'
                            : 'Re-subscribed after this cleanup'
                        }
                      >
                        {c.currentEmailStatus}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="text-[11px] text-foreground/50">
              Showing {filtered.length} of {detail.data.contacts.length}
              {detail.data.totalCount > detail.data.contacts.length &&
                ` · ${(detail.data.totalCount - detail.data.contacts.length).toLocaleString()} more available in the DB (capped at 200 per view)`}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
