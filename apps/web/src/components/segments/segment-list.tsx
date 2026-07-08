'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/trpc';

/**
 * Segments list. We show the cached count + "last refreshed" timestamp so
 * the user knows it might lag reality. The detail page has a "Refresh"
 * button that calls `recomputeCount` to force a fresh number.
 */
// Threshold beyond which the cached count is considered stale enough
// to auto-refresh on load. 24h — matches the frequency people usually
// expect segments to feel fresh.
const STALE_MS = 24 * 60 * 60 * 1000;

export function SegmentList({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const { data, isLoading } = api.segments.list.useQuery({ limit: 50 });
  const utils = api.useUtils();
  // Track which rows are currently being recomputed so we can render
  // an inline spinner without racing against the mutation's isPending
  // flag (which is per-hook, not per-row).
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const recompute = api.segments.recomputeCount.useMutation({
    onError: (err) => toast.error(err.message),
  });

  function refreshOne(id: string): void {
    setPendingIds((s) => new Set(s).add(id));
    recompute.mutate(
      { id },
      {
        onSettled: () => {
          setPendingIds((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
          void utils.segments.list.invalidate();
        },
      },
    );
  }

  // Auto-fire once per row that's never been computed OR is >24h
  // stale. The ref makes sure we don't loop when the list refetches
  // after our mutations settle.
  const autoRefreshed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    for (const s of data.items) {
      if (autoRefreshed.current.has(s.id)) continue;
      const stale =
        s.cachedCount === null ||
        !s.cachedCountAt ||
        Date.now() - new Date(s.cachedCountAt).getTime() > STALE_MS;
      if (stale) {
        autoRefreshed.current.add(s.id);
        refreshOne(s.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 px-6 py-12 text-center">
        <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h3 className="font-display text-lg font-medium">No segments yet</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Segments save a set of contact filters so you can reuse them across
          campaigns.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Contacts</TableHead>
            <TableHead>Last refreshed</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead className="w-10" aria-label="Refresh"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((s) => {
            const isPending = pendingIds.has(s.id);
            return (
              <TableRow key={s.id}>
                <TableCell>
                  <Link
                    href={`/t/${tenantSlug}/segments/${s.id}`}
                    className="block hover:underline"
                  >
                    <p className="text-sm font-medium">{s.name}</p>
                    {s.description ? (
                      <p className="text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    ) : null}
                  </Link>
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {isPending && s.cachedCount === null ? (
                    <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    s.cachedCount?.toLocaleString() ?? '—'
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.cachedCountAt
                    ? new Date(s.cachedCountAt).toLocaleString()
                    : isPending
                      ? 'Computing…'
                      : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.createdBy?.name ?? s.createdBy?.email ?? '—'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    disabled={isPending}
                    onClick={() => refreshOne(s.id)}
                    title="Recompute count"
                    aria-label="Recompute count"
                  >
                    <RefreshCw
                      className={`size-3.5 ${isPending ? 'animate-spin' : ''}`}
                    />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
