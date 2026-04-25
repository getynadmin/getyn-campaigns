'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';

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
export function SegmentList({ tenantSlug }: { tenantSlug: string }): JSX.Element {
  const { data, isLoading } = api.segments.list.useQuery({ limit: 50 });

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
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((s) => (
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
                {s.cachedCount?.toLocaleString() ?? '—'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {s.cachedCountAt
                  ? new Date(s.cachedCountAt).toLocaleString()
                  : '—'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {s.createdBy?.name ?? s.createdBy?.email ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
