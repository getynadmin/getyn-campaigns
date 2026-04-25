'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
} from 'lucide-react';

import type { ImportJobStatusValue } from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Props = {
  tenantSlug: string;
  importJobId: string;
};

/**
 * Polling progress page for a single ImportJob. Uses tRPC's
 * `refetchInterval` so we don't have to hand-roll setInterval. The poll
 * stops automatically once the job reaches a terminal state.
 */
export function ImportProgress({ tenantSlug, importJobId }: Props): JSX.Element {
  const utils = api.useUtils();
  const job = api.imports.get.useQuery(
    { id: importJobId },
    {
      refetchInterval: (q) => {
        const status = q.state.data?.status as ImportJobStatusValue | undefined;
        if (!status) return 2000;
        if (status === 'PENDING' || status === 'PROCESSING') return 2000;
        return false;
      },
    },
  );

  const cancel = api.imports.cancel.useMutation({
    onSuccess: () => {
      toast.success('Import canceled.');
      void utils.imports.get.invalidate({ id: importJobId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (job.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 text-sm text-muted-foreground">
        Loading import…
      </div>
    );
  }
  if (!job.data) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 text-sm text-muted-foreground">
        Import not found.
      </div>
    );
  }

  const data = job.data;
  const status = data.status as ImportJobStatusValue;
  const pct = computePercent(data.processedRows, data.totalRows);
  const errors = Array.isArray(data.errors) ? (data.errors as unknown[]) : [];

  const terminal =
    status === 'COMPLETED' || status === 'CANCELED' || status === 'FAILED';

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <Link
          href={`/t/${tenantSlug}/contacts`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All contacts
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          {data.fileName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Queued {new Date(data.createdAt).toLocaleString()}
          {data.createdBy ? ` by ${data.createdBy.name ?? data.createdBy.email}` : ''}
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <StatusIcon status={status} />
            <span>{humanStatus(status)}</span>
          </CardTitle>
          {!terminal ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => cancel.mutate({ id: importJobId })}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Canceling…' : 'Cancel'}
            </Button>
          ) : (
            <Link href={`/t/${tenantSlug}/contacts`}>
              <Button variant="outline" size="sm">
                Back to contacts
              </Button>
            </Link>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {data.processedRows} of {data.totalRows ?? '?'} rows
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full transition-all',
                  status === 'FAILED' || status === 'CANCELED'
                    ? 'bg-destructive'
                    : 'bg-primary',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Imported" value={data.successRows} />
            <Stat label="Errors" value={data.errorRows} tone="warn" />
            <Stat
              label="Remaining"
              value={Math.max(0, (data.totalRows ?? data.processedRows) - data.processedRows)}
            />
          </div>
        </CardContent>
      </Card>

      {errors.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {errors.slice(0, 25).map((err, i) => {
                if (
                  typeof err === 'object' &&
                  err !== null &&
                  'truncated' in err &&
                  (err as { truncated?: boolean }).truncated
                ) {
                  return (
                    <li
                      key={`trunc-${i}`}
                      className="text-xs italic text-muted-foreground"
                    >
                      More errors were recorded but not shown (capped at 100).
                    </li>
                  );
                }
                const e = err as { row?: number; message?: string };
                return (
                  <li key={i} className="flex gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">
                      row {e.row ?? '?'}
                    </span>
                    <span>{e.message ?? 'Unknown error'}</span>
                  </li>
                );
              })}
              {errors.length > 25 ? (
                <li className="pt-1 text-xs text-muted-foreground">
                  …and {errors.length - 25} more
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function computePercent(processed: number, total: number | null): number {
  if (!total || total === 0) return 0;
  return Math.min(100, Math.round((processed / total) * 100));
}

function humanStatus(status: ImportJobStatusValue): string {
  switch (status) {
    case 'PENDING':
      return 'Queued';
    case 'PROCESSING':
      return 'Importing…';
    case 'COMPLETED':
      return 'Completed';
    case 'FAILED':
      return 'Failed';
    case 'CANCELED':
      return 'Canceled';
  }
}

function StatusIcon({ status }: { status: ImportJobStatusValue }): JSX.Element {
  switch (status) {
    case 'PENDING':
      return <Circle className="size-4 text-muted-foreground" />;
    case 'PROCESSING':
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case 'COMPLETED':
      return <CheckCircle2 className="size-4 text-emerald-600" />;
    case 'FAILED':
      return <XCircle className="size-4 text-destructive" />;
    case 'CANCELED':
      return <AlertTriangle className="size-4 text-amber-600" />;
  }
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn';
}): JSX.Element {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p
        className={cn(
          'text-lg font-semibold',
          tone === 'warn' && value > 0 ? 'text-amber-600' : '',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
