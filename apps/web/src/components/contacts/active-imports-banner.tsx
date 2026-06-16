'use client';

import Link from 'next/link';
import { Loader2, X, FileSpreadsheet, CheckCircle2 } from 'lucide-react';

import { api } from '@/lib/trpc';

/**
 * Per-tenant in-flight import surface. Sits at the top of /contacts
 * so a refresh doesn't lose the user — they can see PENDING /
 * PROCESSING jobs immediately and click through to detail.
 *
 * Polls `imports.list` while any job is active; falls dormant once
 * the recent set is all in a terminal state.
 */
export function ActiveImportsBanner({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element | null {
  const { data } = api.imports.list.useQuery(
    { limit: 5 },
    {
      // Cheap query — 5 rows + creator name. While anything's running
      // (PENDING / PROCESSING), poll every 3s; otherwise fall back to
      // a 60s sanity refresh in case the user leaves the tab open
      // while another teammate kicks off an import.
      refetchInterval: (q) => {
        const data = q.state.data as
          | { items: Array<{ status: string }> }
          | undefined;
        const items = data?.items ?? [];
        const anyActive = items.some(
          (i) => i.status === 'PENDING' || i.status === 'PROCESSING',
        );
        return anyActive ? 3_000 : 60_000;
      },
    },
  );

  const items = ((data as { items?: ImportItem[] } | undefined)?.items ??
    []) as ImportItem[];
  const active = items.filter(
    (i) => i.status === 'PENDING' || i.status === 'PROCESSING',
  );
  // Recently-finished jobs from the last 5 minutes — surfaces the
  // "X new, Y updated, Z errors" summary right after completion so a
  // re-import isn't a black box.
  const recent = items.filter((i) => {
    if (i.status !== 'COMPLETED' && i.status !== 'FAILED') return false;
    const completedAt = i.completedAt ? new Date(i.completedAt) : null;
    if (!completedAt) return false;
    return Date.now() - completedAt.getTime() < 5 * 60 * 1000;
  });

  if (active.length === 0 && recent.length === 0) return null;

  return (
    <div className="space-y-2">
      {active.map((job) => (
        <ActiveCard key={job.id} job={job} tenantSlug={tenantSlug} />
      ))}
      {recent.map((job) => (
        <RecentCard key={job.id} job={job} tenantSlug={tenantSlug} />
      ))}
    </div>
  );
}

type ImportItem = {
  id: string;
  fileName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  totalRows: number | null;
  processedRows: number;
  successRows: number;
  updatedRows: number;
  errorRows: number;
  completedAt: Date | string | null;
};

function ActiveCard({
  job,
  tenantSlug,
}: {
  job: ImportItem;
  tenantSlug: string;
}): JSX.Element {
  const total = job.totalRows ?? 0;
  const processed = job.processedRows ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isPending = job.status === 'PENDING';
  return (
    <Link
      href={`/t/${tenantSlug}/contacts/import/${job.id}`}
      className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-3 hover:bg-amber-100/60 dark:border-amber-900 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
    >
      <Loader2 className="size-4 shrink-0 animate-spin text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <FileSpreadsheet className="size-3.5 shrink-0 text-amber-800 dark:text-amber-200" />
          <span className="truncate font-medium text-amber-900 dark:text-amber-100">
            {job.fileName}
          </span>
          <span className="ml-auto shrink-0 text-xs text-amber-800 dark:text-amber-200">
            {isPending ? 'Queued' : `${pct}% — ${processed.toLocaleString()} / ${total.toLocaleString()}`}
          </span>
        </div>
        {!isPending && total > 0 && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-900/40">
            <div
              className="h-full bg-amber-600 transition-all dark:bg-amber-400"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </Link>
  );
}

function RecentCard({
  job,
  tenantSlug,
}: {
  job: ImportItem;
  tenantSlug: string;
}): JSX.Element {
  const isFailed = job.status === 'FAILED';
  const created = (job.successRows ?? 0) - (job.updatedRows ?? 0);
  const updated = job.updatedRows ?? 0;
  const errors = job.errorRows ?? 0;
  return (
    <Link
      href={`/t/${tenantSlug}/contacts/import/${job.id}`}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
        isFailed
          ? 'border-rose-300 bg-rose-50/60 text-rose-900 hover:bg-rose-100/60 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:bg-rose-950/50'
          : 'border-emerald-300 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-100/60 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 dark:hover:bg-emerald-950/50'
      }`}
    >
      {isFailed ? (
        <X className="size-4 shrink-0" />
      ) : (
        <CheckCircle2 className="size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <FileSpreadsheet className="size-3.5 shrink-0" />
          <span className="truncate font-medium">{job.fileName}</span>
          <span className="ml-auto shrink-0 text-xs opacity-80">
            {isFailed
              ? 'Failed'
              : `${created.toLocaleString()} new · ${updated.toLocaleString()} updated · ${errors.toLocaleString()} errors`}
          </span>
        </div>
      </div>
    </Link>
  );
}
