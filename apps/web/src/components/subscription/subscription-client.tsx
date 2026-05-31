'use client';

import { useState } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  Loader2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { PlanMetric } from '@getyn/db';

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
import { api } from '@/lib/trpc';

const METRIC_LABEL: Record<PlanMetric, string> = {
  CONTACTS: 'Contacts',
  EMAILS_PER_MONTH: 'Emails / month',
  WA_MESSAGES_PER_MONTH: 'WhatsApp messages / month',
  SMS_SEGMENTS_PER_MONTH: 'SMS segments / month',
  AI_CREDITS_PER_MONTH: 'AI credits / month',
  CUSTOM_SENDING_DOMAINS: 'Sending domains',
  USER_SEATS: 'User seats',
};

const ORDERED_METRICS: PlanMetric[] = [
  PlanMetric.EMAILS_PER_MONTH,
  PlanMetric.WA_MESSAGES_PER_MONTH,
  PlanMetric.AI_CREDITS_PER_MONTH,
  PlanMetric.CONTACTS,
  PlanMetric.USER_SEATS,
  PlanMetric.CUSTOM_SENDING_DOMAINS,
  PlanMetric.SMS_SEGMENTS_PER_MONTH,
];

function formatPrice(cents: number | null, currency: string): string {
  if (cents === null) return 'Contact us';
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency,
  });
}

function formatLimit(n: number): string {
  if (n === -1) return 'Unlimited';
  return n.toLocaleString();
}

export function SubscriptionClient(): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.subscription.get.useQuery();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [targetPlanId, setTargetPlanId] = useState<string>('');
  const [upgradeReason, setUpgradeReason] = useState('');

  const requestUpgrade = api.subscription.requestUpgrade.useMutation({
    onSuccess: () => {
      toast.success('Upgrade request submitted. The team will follow up.');
      setUpgradeOpen(false);
      setTargetPlanId('');
      setUpgradeReason('');
      void utils.subscription.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const withdraw = api.subscription.withdrawUpgrade.useMutation({
    onSuccess: () => {
      toast.success('Request withdrawn.');
      void utils.subscription.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const upgradeTargets = data.allPlans.filter((p) =>
    data.upgradeTargetIds.includes(p.id),
  );

  return (
    <div className="space-y-6">
      {/* Current plan card */}
      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Current plan
            </p>
            <h3 className="mt-1 text-xl font-semibold">
              {data.subscription?.planName ?? 'No plan assigned'}
            </h3>
            {data.subscription && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {data.subscription.description ?? 'No description.'}
              </p>
            )}
            {data.subscription && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>
                  Status:{' '}
                  <span className="font-medium text-foreground">
                    {data.subscription.status}
                  </span>
                </span>
                <span>
                  {formatPrice(
                    data.subscription.priceMonthlyCents,
                    data.subscription.currency,
                  )}{' '}
                  / mo
                </span>
                {data.subscription.currentPeriodEnd && (
                  <span>
                    Renews{' '}
                    {new Date(
                      data.subscription.currentPeriodEnd,
                    ).toLocaleDateString()}
                  </span>
                )}
                {data.subscription.cancelAt && (
                  <span className="text-rose-700 dark:text-rose-400">
                    Cancels{' '}
                    {new Date(data.subscription.cancelAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
          </div>
          {data.allowUpgradeRequests &&
            upgradeTargets.length > 0 &&
            !data.pendingRequest && (
              <Button onClick={() => setUpgradeOpen(true)}>
                <ArrowUpCircle className="mr-2 size-4" />
                Request upgrade
              </Button>
            )}
        </div>

        {data.pendingRequest && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Pending upgrade request: {data.pendingRequest.requestedPlan.name}
            </p>
            <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/70">
              Submitted by{' '}
              {data.pendingRequest.requestedBy.name ??
                data.pendingRequest.requestedBy.email}{' '}
              on{' '}
              {new Date(data.pendingRequest.createdAt).toLocaleDateString()}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 h-7 text-xs"
              onClick={() =>
                withdraw.mutate({ id: data.pendingRequest!.id })
              }
              disabled={withdraw.isPending}
            >
              Withdraw request
            </Button>
          </div>
        )}
      </section>

      {/* Usage card */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">This period</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Limits reset on the 1st of each month (UTC).
        </p>
        <div className="mt-4 space-y-3">
          {ORDERED_METRICS.map((m) => {
            const limit = data.limits[m];
            const current = data.usage[m];
            const isUnlimited = limit === -1;
            const pct =
              isUnlimited || limit === 0
                ? 0
                : Math.min(100, Math.round((current / limit) * 100));
            const over = !isUnlimited && limit !== 0 && current >= limit;
            return (
              <div key={m} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>{METRIC_LABEL[m]}</span>
                  <span className="font-mono text-xs">
                    {current.toLocaleString()} /{' '}
                    {limit === 0
                      ? 'not included'
                      : isUnlimited
                        ? 'unlimited'
                        : limit.toLocaleString()}
                  </span>
                </div>
                {limit > 0 && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={
                        over
                          ? 'h-full bg-rose-500'
                          : pct >= 80
                            ? 'h-full bg-amber-500'
                            : 'h-full bg-emerald-500'
                      }
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Plan comparison */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">All plans</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {data.allPlans.map((p) => (
            <div
              key={p.id}
              className={
                p.isCurrent
                  ? 'rounded-lg border-2 border-primary bg-card p-4'
                  : 'rounded-lg border bg-card p-4'
              }
            >
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">{p.name}</h4>
                {p.isCurrent && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Current
                  </span>
                )}
              </div>
              <p className="mt-1 text-lg font-semibold">
                {formatPrice(p.priceMonthlyCents, p.currency)}
                <span className="text-xs font-normal text-muted-foreground">
                  {' '}
                  / mo
                </span>
              </p>
              {p.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.description}
                </p>
              )}
              <ul className="mt-3 space-y-1 text-xs">
                {p.features.map((f) => (
                  <li
                    key={f.metric}
                    className="flex items-center gap-2 text-muted-foreground"
                  >
                    {f.included === 0 ? (
                      <XCircle className="size-3 text-muted-foreground/50" />
                    ) : (
                      <CheckCircle2 className="size-3 text-emerald-600" />
                    )}
                    <span>
                      {METRIC_LABEL[f.metric as PlanMetric]}:{' '}
                      <span className="font-medium text-foreground">
                        {formatLimit(f.included)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Upgrade dialog */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request an upgrade</DialogTitle>
            <DialogDescription>
              The team gets notified and will follow up. Withdrawing is
              one-click if you change your mind.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Target plan</Label>
              <Select value={targetPlanId} onValueChange={setTargetPlanId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a plan" />
                </SelectTrigger>
                <SelectContent>
                  {upgradeTargets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} —{' '}
                      {formatPrice(p.priceMonthlyCents, p.currency)} / mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note (optional)</Label>
              <textarea
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={upgradeReason}
                onChange={(e) => setUpgradeReason(e.target.value)}
                placeholder="Anything that helps us follow up faster"
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                requestUpgrade.mutate({
                  targetPlanId,
                  reason: upgradeReason.trim() || undefined,
                })
              }
              disabled={requestUpgrade.isPending || !targetPlanId}
            >
              {requestUpgrade.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
