'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

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
        <h2 className="mb-3 text-sm font-semibold">Subscription</h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Row label="Plan (legacy enum)">{t.plan}</Row>
          <Row label="Billing status">{t.billingStatus}</Row>
          <Row label="Provisioning">{t.provisioningSource}</Row>
          {t.billingSubscription && (
            <>
              <Row label="Billing plan">{t.billingSubscription.plan.name}</Row>
              <Row label="Subscription">{t.billingSubscription.status}</Row>
              <Row label="Renews">
                {new Date(t.billingSubscription.currentPeriodEnd).toLocaleDateString()}
              </Row>
            </>
          )}
          {t.gSuiteSyncedAt && (
            <Row label="G-Suite synced">
              {new Date(t.gSuiteSyncedAt).toLocaleString()}
            </Row>
          )}
        </dl>
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
