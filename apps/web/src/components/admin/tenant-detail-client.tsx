'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ban,
  Loader2,
  Pencil,
  Plus,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';

import { PlanMetric, SubscriptionStatus } from '@getyn/db';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

const METRIC_LABEL: Record<PlanMetric, string> = {
  CONTACTS: 'Contacts',
  EMAILS_PER_MONTH: 'Emails / month',
  WA_MESSAGES_PER_MONTH: 'WhatsApp msgs / month',
  SMS_SEGMENTS_PER_MONTH: 'SMS segments / month',
  AI_CREDITS_PER_MONTH: 'AI credits / month',
  CUSTOM_SENDING_DOMAINS: 'Custom sending domains',
  USER_SEATS: 'User seats',
  AI_AGENT_CONVERSATIONS_PER_MONTH: 'AI agent conversations / month',
  AUTOMATION_ENROLLMENTS_PER_MONTH: 'Automation enrollments / month',
  AGENT_REPLIES_PER_MONTH: 'Email agent replies / month',
};

/**
 * Phase 5 M7 — admin tenant detail.
 *
 * Read-only by default. Four mutation surfaces, each with confirm +
 * reason dialog so the audit log captures the why:
 *   - Re-sync subscription from G-Suite
 *   - Force-disconnect WhatsApp
 *   - Lift auto-suspension
 *   - Start impersonation
 */

export function AdminTenantDetailClient({
  tenantId,
}: {
  tenantId: string;
}): JSX.Element {
  const { data, isLoading, refetch } = adminApi.tenant.get.useQuery({
    id: tenantId,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const t = data;
  const isSuspended = Boolean(t.sendingPolicy?.suspendedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/tenants">
            <ArrowLeft className="mr-2 size-4" /> Back
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{t.name}</h1>
          <p className="text-xs text-muted-foreground">
            <code>{t.id}</code> · /{t.slug}
            {t.gSuiteTenantId && (
              <>
                {' · G-Suite '}
                <code>{t.gSuiteTenantId}</code>
              </>
            )}
          </p>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Members" value={t._count.memberships.toString()} />
        <Stat label="Contacts" value={t._count.contacts.toLocaleString()} />
        <Stat label="Campaigns" value={t._count.campaigns.toString()} />
        <Stat label="Sends (total)" value={t._count.campaignSends.toLocaleString()} />
        <Stat label="Segments" value={t._count.segments.toString()} />
        <Stat label="Imports" value={t._count.importJobs.toString()} />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Subscription</h2>
          <div className="flex gap-1">
            <AssignPlanAction
              tenantId={tenantId}
              currentPlanId={t.subscription?.planId ?? null}
              currentStatus={t.subscription?.status ?? null}
              currentPeriodEnd={t.subscription?.currentPeriodEnd ?? null}
              onSuccess={() => refetch()}
            />
            {t.subscription &&
              t.subscription.status !== SubscriptionStatus.CANCELED && (
                <CancelSubscriptionAction
                  tenantId={tenantId}
                  onSuccess={() => refetch()}
                />
              )}
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Row label="Plan (legacy enum)">{t.legacyPlanTier}</Row>
          <Row label="Billing status">{t.billingStatus}</Row>
          <Row label="Provisioning">{t.provisioningSource}</Row>
          {t.subscription ? (
            <>
              <Row label="Plan">
                {t.subscription.plan.name}{' '}
                <span className="text-muted-foreground">
                  ({t.subscription.plan.slug})
                </span>
              </Row>
              <Row label="Subscription status">{t.subscription.status}</Row>
              {t.subscription.currentPeriodEnd && (
                <Row label="Renews">
                  {new Date(t.subscription.currentPeriodEnd).toLocaleDateString()}
                </Row>
              )}
              {t.subscription.cancelAt && (
                <Row label="Cancels at">
                  {new Date(t.subscription.cancelAt).toLocaleString()}
                </Row>
              )}
            </>
          ) : (
            <Row label="Plan">
              <span className="text-muted-foreground">
                Not assigned — use &quot;Assign plan&quot;.
              </span>
            </Row>
          )}
          {t.gSuiteSyncedAt && (
            <Row label="G-Suite synced">
              {new Date(t.gSuiteSyncedAt).toLocaleString()}
            </Row>
          )}
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Limit overrides</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Per-tenant bumps on top of plan limits. Multiple overrides on
              the same metric resolve to the most recent non-expired row.
            </p>
          </div>
          <AddLimitOverrideAction
            tenantId={tenantId}
            onSuccess={() => refetch()}
          />
        </div>
        {t.limitOverrides.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            No overrides.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {t.limitOverrides.map((o) => {
              const expired = o.expiresAt && new Date(o.expiresAt) < new Date();
              return (
                <li
                  key={o.id}
                  className="flex items-start justify-between gap-3 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {METRIC_LABEL[o.metric]}:{' '}
                      <span className="font-mono">
                        {o.included === -1 ? 'Unlimited' : o.included.toLocaleString()}
                      </span>
                      {expired && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          expired
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      {o.reason}
                      {o.expiresAt && (
                        <>
                          {' · expires '}
                          {new Date(o.expiresAt).toLocaleDateString()}
                        </>
                      )}
                      {' · added '}
                      {new Date(o.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <RemoveOverrideButton
                    tenantId={tenantId}
                    overrideId={o.id}
                    onSuccess={() => refetch()}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Channels</h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Row label="WhatsApp">
            {t.whatsAppAccount
              ? `${t.whatsAppAccount.status} · ${t.whatsAppAccount.displayName}`
              : 'Not connected'}
          </Row>
          <Row label="Sending domains">
            {t.sendingDomains.length === 0
              ? 'None'
              : t.sendingDomains
                  .map((d) => `${d.domain} (${d.status})`)
                  .join(', ')}
          </Row>
          {t.sendingPolicy?.suspendedAt && (
            <Row label="Suspended">
              <span className="text-rose-700 dark:text-rose-400">
                {new Date(t.sendingPolicy.suspendedAt).toLocaleString()} —{' '}
                {t.sendingPolicy.suspensionReason ?? '—'}
              </span>
            </Row>
          )}
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <ResyncSubscriptionAction
            tenantId={tenantId}
            disabled={!t.gSuiteTenantId}
            onSuccess={() => refetch()}
          />
          {t.whatsAppAccount && t.whatsAppAccount.status === 'CONNECTED' && (
            <ForceDisconnectWhatsAppAction
              tenantId={tenantId}
              onSuccess={() => refetch()}
            />
          )}
          {isSuspended && (
            <LiftSuspensionAction
              tenantId={tenantId}
              onSuccess={() => refetch()}
            />
          )}
          <ImpersonateAction tenantId={tenantId} tenantSlug={t.slug} />
        </div>
      </section>

      <section className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
        <h2 className="mb-1 text-sm font-semibold text-amber-900 dark:text-amber-200">
          G-Suite mock events (M4 lifecycle testing)
        </h2>
        <p className="mb-3 text-xs text-amber-900/80 dark:text-amber-200/70">
          Synthetic G-Suite webhook events. Same processing path as
          real events — fires through the worker, writes audit. Use to
          rehearse the deactivation lifecycle until M3&apos;s real
          contract is wired.
        </p>
        <GsuiteMockActions tenantId={tenantId} onSuccess={() => refetch()} />
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Action dialogs
// ----------------------------------------------------------------------------

function ResyncSubscriptionAction({
  tenantId,
  disabled,
  onSuccess,
}: {
  tenantId: string;
  disabled?: boolean;
  onSuccess: () => void;
}): JSX.Element {
  const mut = adminApi.tenant.resyncSubscription.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Synced — gSuiteSyncedAt ${new Date(r.gSuiteSyncedAt!).toLocaleString()}`,
      );
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => mut.mutate({ id: tenantId })}
      disabled={mut.isPending || disabled}
      title={disabled ? 'Tenant has no G-Suite link (DIRECT provisioning)' : undefined}
    >
      {mut.isPending ? (
        <Loader2 className="mr-2 size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 size-3.5" />
      )}
      Re-sync subscription
    </Button>
  );
}

function ForceDisconnectWhatsAppAction({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: () => void;
}): JSX.Element {
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm">
          <PowerOff className="mr-2 size-3.5" /> Force-disconnect WhatsApp
        </Button>
      }
      title="Force-disconnect WhatsApp"
      description="Sets the WABA to DISCONNECTED and halts outbound sends. Captured in the audit log."
      mutationName="forceDisconnectWhatsApp"
      tenantId={tenantId}
      onSuccess={() => {
        toast.success('Disconnected.');
        onSuccess();
      }}
    />
  );
}

function LiftSuspensionAction({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: () => void;
}): JSX.Element {
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm">
          <ShieldCheck className="mr-2 size-3.5" /> Lift auto-suspension
        </Button>
      }
      title="Lift suspension"
      description="Clears the auto-suspension and resumes PAUSED campaigns. The audit log captures your reason."
      mutationName="liftSuspension"
      tenantId={tenantId}
      onSuccess={() => {
        toast.success('Suspension lifted.');
        onSuccess();
      }}
    />
  );
}

function ImpersonateAction({
  tenantId,
  tenantSlug,
}: {
  tenantId: string;
  tenantSlug: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mut = adminApi.impersonation.start.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Impersonating ${tenantSlug} — session expires ${new Date(res.expiresAt).toLocaleTimeString()}`,
      );
      setOpen(false);
      // M7.5 wires the actual session-cookie + redirect. For now the
      // audit row is written; surfaces follow.
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-rose-300 bg-rose-50/40 text-rose-900 hover:bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
        onClick={() => setOpen(true)}
      >
        <UserCog className="mr-2 size-3.5" />
        Impersonate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Impersonate {tenantSlug}?</DialogTitle>
            <DialogDescription>
              30-minute session. Owner is notified. All actions taken
              while impersonating are audit-logged with your staff
              identity. Mutations are blocked.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mut.mutate({ tenantId, reason })}
              disabled={mut.isPending || reason.trim().length < 3}
            >
              {mut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Start impersonation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Generic reason dialog for mutations that demand an audit
 * explanation. The two mutations sharing this (`forceDisconnectWhatsApp`,
 * `liftSuspension`) have identical input shape — keying on the
 * `mutationName` lets us reuse the dialog.
 */
function ReasonDialog({
  trigger,
  title,
  description,
  mutationName,
  tenantId,
  onSuccess,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  mutationName: 'forceDisconnectWhatsApp' | 'liftSuspension';
  tenantId: string;
  onSuccess: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  // Both mutations share the same input shape, but tRPC's discriminated
  // hook signature means we can't dispatch dynamically. Two hooks; one
  // active branch each render.
  const disconnect = adminApi.tenant.forceDisconnectWhatsApp.useMutation({
    onSuccess: () => {
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });
  const lift = adminApi.tenant.liftSuspension.useMutation({
    onSuccess: () => {
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });
  const active = mutationName === 'forceDisconnectWhatsApp' ? disconnect : lift;

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-rose-600" /> {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => active.mutate({ id: tenantId, reason })}
              disabled={active.isPending || reason.trim().length < 3}
            >
              {active.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-xs">{children}</dd>
    </div>
  );
}

// ----------------------------------------------------------------------------
// G-Suite mock fire (M4)
// ----------------------------------------------------------------------------

const MOCK_EVENTS = [
  { type: 'subscription.canceled', label: 'Cancel subscription', destructive: false },
  { type: 'tenant.suspended',      label: 'Suspend tenant',      destructive: false },
  { type: 'tenant.reactivated',    label: 'Reactivate tenant',   destructive: false },
  { type: 'tenant.deleted',        label: 'Delete tenant (PURGE)', destructive: true },
] as const;

function GsuiteMockActions({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: () => void;
}): JSX.Element {
  const [open, setOpen] = useState<(typeof MOCK_EVENTS)[number] | null>(null);
  const [reason, setReason] = useState('');
  const fire = adminApi.gsuiteMock.fire.useMutation({
    onSuccess: (res) => {
      toast.success(`Fired ${open?.type} — event id ${res.eventId}`);
      setOpen(null);
      setReason('');
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {MOCK_EVENTS.map((ev) => (
          <Button
            key={ev.type}
            size="sm"
            variant={ev.destructive ? 'destructive' : 'outline'}
            onClick={() => setOpen(ev)}
          >
            {ev.label}
          </Button>
        ))}
      </div>
      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-rose-600" />
              Fire {open?.type}?
            </DialogTitle>
            <DialogDescription>
              Posts a synthetic G-Suite event onto the worker queue.
              Same handler as a real webhook would invoke.
              {open?.destructive &&
                ' This will schedule the tenant purge job — irreversible.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              variant={open?.destructive ? 'destructive' : 'default'}
              disabled={fire.isPending || reason.trim().length < 3 || !open}
              onClick={() =>
                open &&
                fire.mutate({
                  tenantId,
                  eventType: open.type,
                  reason,
                })
              }
            >
              {fire.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Fire {open?.type}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ----------------------------------------------------------------------------
// Phase 5.5 M3 — plan assignment + limit overrides
// ----------------------------------------------------------------------------

const METRICS: PlanMetric[] = [
  PlanMetric.CONTACTS,
  PlanMetric.EMAILS_PER_MONTH,
  PlanMetric.WA_MESSAGES_PER_MONTH,
  PlanMetric.SMS_SEGMENTS_PER_MONTH,
  PlanMetric.AI_CREDITS_PER_MONTH,
  PlanMetric.CUSTOM_SENDING_DOMAINS,
  PlanMetric.USER_SEATS,
  PlanMetric.AI_AGENT_CONVERSATIONS_PER_MONTH,
];

const SUB_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.CANCELED,
  SubscriptionStatus.SUSPENDED,
];

function AssignPlanAction({
  tenantId,
  currentPlanId,
  currentStatus,
  currentPeriodEnd,
  onSuccess,
}: {
  tenantId: string;
  currentPlanId: string | null;
  currentStatus: SubscriptionStatus | null;
  currentPeriodEnd: Date | null;
  onSuccess: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<string>(currentPlanId ?? '');
  const [status, setStatus] = useState<SubscriptionStatus>(
    currentStatus ?? SubscriptionStatus.ACTIVE,
  );
  const [periodEnd, setPeriodEnd] = useState<string>(
    currentPeriodEnd ? new Date(currentPeriodEnd).toISOString().slice(0, 10) : '',
  );
  const [reason, setReason] = useState('');
  const { data: plans } = adminApi.plan.list.useQuery(undefined, {
    enabled: open,
  });
  const eligible = (plans ?? []).filter((p) => !p.isArchived);
  const mut = adminApi.tenant.setSubscription.useMutation({
    onSuccess: () => {
      toast.success(currentPlanId ? 'Plan updated.' : 'Plan assigned.');
      setOpen(false);
      setReason('');
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setPlanId(currentPlanId ?? '');
          setStatus(currentStatus ?? SubscriptionStatus.ACTIVE);
          setPeriodEnd(
            currentPeriodEnd
              ? new Date(currentPeriodEnd).toISOString().slice(0, 10)
              : '',
          );
          setOpen(true);
        }}
      >
        {currentPlanId ? (
          <Pencil className="mr-2 size-3.5" />
        ) : (
          <Plus className="mr-2 size-3.5" />
        )}
        {currentPlanId ? 'Change plan' : 'Assign plan'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {currentPlanId ? 'Change plan' : 'Assign plan'}
            </DialogTitle>
            <DialogDescription>
              Audit-logged. Re-assigning clears any pending cancellation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a plan" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as SubscriptionStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUB_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Period ends (optional)</Label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason (audit log)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. moving to Growth per sales call"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={mut.isPending || !planId || reason.trim().length < 3}
              onClick={() =>
                mut.mutate({
                  tenantId,
                  planId,
                  status,
                  currentPeriodEnd: periodEnd ? new Date(periodEnd) : undefined,
                  reason,
                })
              }
            >
              {mut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CancelSubscriptionAction({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mut = adminApi.tenant.cancelSubscription.useMutation({
    onSuccess: () => {
      toast.success('Subscription canceled.');
      setOpen(false);
      setReason('');
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-rose-300 text-rose-900 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-200 dark:hover:bg-rose-950/30"
        onClick={() => setOpen(true)}
      >
        <Ban className="mr-2 size-3.5" /> Cancel
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel subscription?</DialogTitle>
            <DialogDescription>
              Status flips to CANCELED with cancelAt=now. The plan link is
              preserved for history; reassign to undo.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={mut.isPending || reason.trim().length < 3}
              onClick={() => mut.mutate({ id: tenantId, reason })}
            >
              {mut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Confirm cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddLimitOverrideAction({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<PlanMetric>(PlanMetric.CONTACTS);
  const [included, setIncluded] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const mut = adminApi.tenant.addLimitOverride.useMutation({
    onSuccess: () => {
      toast.success('Override added.');
      setOpen(false);
      setIncluded('');
      setReason('');
      setExpiresAt('');
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const parsedIncluded = Number.parseInt(included, 10);
  const canSave =
    Number.isFinite(parsedIncluded) &&
    parsedIncluded >= -1 &&
    reason.trim().length >= 3;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-2 size-3.5" /> Add override
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add limit override</DialogTitle>
            <DialogDescription>
              Use <code>-1</code> for unlimited. Leaving expiry blank makes
              the override permanent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Metric</Label>
              <Select
                value={metric}
                onValueChange={(v) => setMetric(v as PlanMetric)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METRIC_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Included</Label>
                <Input
                  inputMode="numeric"
                  value={included}
                  onChange={(e) => setIncluded(e.target.value)}
                  placeholder="e.g. 50000"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expires (optional)</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. launch period bump per CSM"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={mut.isPending || !canSave}
              onClick={() =>
                mut.mutate({
                  tenantId,
                  metric,
                  included: parsedIncluded,
                  reason,
                  expiresAt: expiresAt ? new Date(expiresAt) : undefined,
                })
              }
            >
              {mut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RemoveOverrideButton({
  tenantId,
  overrideId,
  onSuccess,
}: {
  tenantId: string;
  overrideId: string;
  onSuccess: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mut = adminApi.tenant.removeLimitOverride.useMutation({
    onSuccess: () => {
      toast.success('Override removed.');
      setOpen(false);
      setReason('');
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        title="Remove"
      >
        <Trash2 className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove override?</DialogTitle>
            <DialogDescription>
              Plan defaults take effect immediately on the next limit check.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={mut.isPending || reason.trim().length < 3}
              onClick={() =>
                mut.mutate({ tenantId, overrideId, reason })
              }
            >
              {mut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
