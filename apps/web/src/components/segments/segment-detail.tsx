'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';

import { Role } from '@getyn/db';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

/**
 * Segment detail — shown after clicking a row in the list. This is a
 * read-only summary (name, description, current count) plus actions:
 *  - Edit  (jump to editor page)
 *  - Refresh count (recomputeCount mutation, owner/admin/editor)
 *  - Delete (owner/admin)
 *
 * Viewers see only the name/count/description.
 */

export function SegmentDetail({
  tenantSlug,
  segmentId,
  currentRole,
}: {
  tenantSlug: string;
  segmentId: string;
  currentRole: Role;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();

  const { data, isLoading } = api.segments.get.useQuery({ id: segmentId });

  const canEdit =
    currentRole === Role.OWNER ||
    currentRole === Role.ADMIN ||
    currentRole === Role.EDITOR;
  const canDelete =
    currentRole === Role.OWNER || currentRole === Role.ADMIN;

  const recompute = api.segments.recomputeCount.useMutation({
    onSuccess: (res) => {
      toast.success(`Count refreshed — ${res.count.toLocaleString()} contacts.`);
      utils.segments.get.invalidate({ id: segmentId });
      utils.segments.list.invalidate();
    },
    onError: (err) => toast.error(err.message ?? 'Could not refresh count.'),
  });

  const del = api.segments.delete.useMutation({
    onSuccess: () => {
      toast.success('Segment deleted.');
      utils.segments.list.invalidate();
      router.push(`/t/${tenantSlug}/segments`);
    },
    onError: (err) => toast.error(err.message ?? 'Could not delete segment.'),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/t/${tenantSlug}/segments`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 size-4" />
              Segments
            </Button>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {data.name}
            </h1>
            {data.description ? (
              <p className="text-sm text-muted-foreground">{data.description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit ? (
            <Link href={`/t/${tenantSlug}/segments/${segmentId}/edit`}>
              <Button variant="outline">
                <Pencil className="mr-1 size-4" />
                Edit
              </Button>
            </Link>
          ) : null}
          {canDelete ? (
            <Button
              variant="outline"
              className="text-rose-600 hover:text-rose-600"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="mr-1 size-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">
              {JSON.stringify(data.rules, null, 2)}
            </pre>
            <p className="mt-2 text-xs text-muted-foreground">
              Hit “Edit” to change these rules in the builder.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" />
              Matches
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="font-display text-3xl font-semibold">
                {data.cachedCount?.toLocaleString() ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.cachedCountAt
                  ? `Last refreshed ${new Date(data.cachedCountAt).toLocaleString()}`
                  : 'Not yet computed'}
              </p>
            </div>
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => recompute.mutate({ id: segmentId })}
                disabled={recompute.isPending}
              >
                {recompute.isPending ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 size-3.5" />
                )}
                Refresh count
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this segment?</DialogTitle>
            <DialogDescription>
              This removes the saved rules. Contacts matched by the segment are
              not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => del.mutate({ id: segmentId })}
              disabled={del.isPending}
            >
              {del.isPending ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : null}
              Delete segment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
