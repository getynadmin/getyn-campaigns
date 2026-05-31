'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { PlanUpgradeRequestStatus } from '@getyn/db';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

const FILTERS: { value: PlanUpgradeRequestStatus | 'ALL'; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'ALL', label: 'All' },
];

type DecisionDialog =
  | { kind: 'approve'; id: string; tenantName: string; planName: string }
  | { kind: 'reject'; id: string; tenantName: string; planName: string }
  | null;

export function AdminUpgradeRequestsClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const [filter, setFilter] = useState<PlanUpgradeRequestStatus | 'ALL'>(
    'PENDING',
  );
  const { data, isLoading } = adminApi.upgradeRequest.list.useQuery({
    status: filter === 'ALL' ? undefined : filter,
    limit: 100,
  });
  const [dialog, setDialog] = useState<DecisionDialog>(null);
  const [note, setNote] = useState('');
  const [assignNow, setAssignNow] = useState(true);

  const approve = adminApi.upgradeRequest.approve.useMutation({
    onSuccess: () => {
      toast.success(assignNow ? 'Approved + assigned.' : 'Approved.');
      setDialog(null);
      setNote('');
      void utils.upgradeRequest.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const reject = adminApi.upgradeRequest.reject.useMutation({
    onSuccess: () => {
      toast.success('Rejected.');
      setDialog(null);
      setNote('');
      void utils.upgradeRequest.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Status:</Label>
        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No requests in this view.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data.items.map((r) => {
            const isPending = r.status === PlanUpgradeRequestStatus.PENDING;
            return (
              <li key={r.id} className="space-y-2 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link
                        href={`/admin/tenants/${r.tenant.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {r.tenant.name}
                      </Link>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        /{r.tenant.slug}
                      </code>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium">
                        {r.requestedPlan.name}
                      </span>
                      <StatusPill status={r.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.currentPlan ? `from ${r.currentPlan.name}` : 'no current plan'}
                      {' · '}
                      requested by{' '}
                      {r.requestedBy.name ?? r.requestedBy.email}
                      {' · '}
                      {new Date(r.createdAt).toLocaleString()}
                    </p>
                    {r.reason && (
                      <p className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                        {r.reason}
                      </p>
                    )}
                    {r.reviewerNote && (
                      <p className="text-xs text-muted-foreground">
                        Reviewer note: {r.reviewerNote}
                      </p>
                    )}
                  </div>
                  {isPending && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          setDialog({
                            kind: 'approve',
                            id: r.id,
                            tenantName: r.tenant.name,
                            planName: r.requestedPlan.name,
                          })
                        }
                      >
                        <Check className="mr-1 size-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDialog({
                            kind: 'reject',
                            id: r.id,
                            tenantName: r.tenant.name,
                            planName: r.requestedPlan.name,
                          })
                        }
                      >
                        <X className="mr-1 size-3.5" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === 'approve' ? 'Approve' : 'Reject'} request?
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === 'approve' ? (
                <>
                  Approves the move to <strong>{dialog.planName}</strong> for{' '}
                  <strong>{dialog.tenantName}</strong>. With auto-assign on,
                  the tenant's Subscription is updated in the same transaction.
                </>
              ) : (
                <>
                  Rejects the request. The tenant sees this in their
                  subscription page and can submit a new one.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {dialog?.kind === 'approve' && (
              <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={assignNow}
                  onChange={(e) => setAssignNow(e.target.checked)}
                  className="mt-0.5 size-4 accent-foreground"
                />
                <span>
                  <span className="font-medium">Assign now</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Update Subscription.planId in the same transaction.
                    Recommended.
                  </span>
                </span>
              </label>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Reviewer note (optional)</Label>
              <textarea
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Visible to the tenant — keep it customer-facing"
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={dialog?.kind === 'reject' ? 'destructive' : 'default'}
              disabled={approve.isPending || reject.isPending || !dialog}
              onClick={() => {
                if (!dialog) return;
                const reviewerNote = note.trim() || undefined;
                if (dialog.kind === 'approve') {
                  approve.mutate({ id: dialog.id, reviewerNote, assignNow });
                } else {
                  reject.mutate({ id: dialog.id, reviewerNote });
                }
              }}
            >
              {(approve.isPending || reject.isPending) && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: PlanUpgradeRequestStatus;
}): JSX.Element {
  const cls: Record<PlanUpgradeRequestStatus, string> = {
    PENDING:
      'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    APPROVED:
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
    WITHDRAWN: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls[status]}`}
    >
      {status}
    </span>
  );
}
