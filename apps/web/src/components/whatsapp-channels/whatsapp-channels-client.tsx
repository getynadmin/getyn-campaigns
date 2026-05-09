'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Phone,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';

import {
  whatsAppAccountConnectManuallySchema,
  type WhatsAppAccountConnectManuallyInput,
} from '@getyn/types';

import { EmbeddedSignupButton } from '@/components/whatsapp-channels/embedded-signup-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const QUALITY_TONE: Record<string, string> = {
  GREEN:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  YELLOW: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  RED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  UNKNOWN: 'bg-muted text-muted-foreground',
};

const TIER_LIMITS: Record<string, number | null> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: null,
};

const TIER_LABEL: Record<string, string> = {
  TIER_50: '50 / 24h',
  TIER_250: '250 / 24h',
  TIER_1K: '1K / 24h',
  TIER_10K: '10K / 24h',
  TIER_100K: '100K / 24h',
  TIER_UNLIMITED: 'Unlimited',
};

export function WhatsAppChannelsClient({
  canManage,
}: {
  canManage: boolean;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.whatsAppAccount.get.useQuery();
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const account = data ?? null;
  const isConnected = Boolean(account && account.status === 'CONNECTED');

  return (
    <div className="space-y-6">
      {/* Connection card */}
      {!account ? (
        <EmptyState
          canManage={canManage}
          onConnect={() => setConnectOpen(true)}
          onEmbeddedSignupSuccess={() => {
            void utils.whatsAppAccount.get.invalidate();
          }}
        />
      ) : (
        <ConnectedState
          account={account}
          canManage={canManage}
          onDisconnect={() => setConfirmDisconnect(true)}
          onRefresh={async () => {
            await utils.whatsAppAccount.get.invalidate();
          }}
        />
      )}

      {/* Phone numbers list (only when connected) */}
      {isConnected && account && (
        <PhoneNumbersCard
          account={account}
          canManage={canManage}
          onRefreshed={() => utils.whatsAppAccount.get.invalidate()}
        />
      )}

      <ConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onSuccess={async () => {
          setConnectOpen(false);
          await utils.whatsAppAccount.get.invalidate();
        }}
      />

      <DisconnectDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        onSuccess={async () => {
          setConfirmDisconnect(false);
          await utils.whatsAppAccount.get.invalidate();
        }}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Empty state
// ----------------------------------------------------------------------------

function EmptyState({
  canManage,
  onConnect,
  onEmbeddedSignupSuccess,
}: {
  canManage: boolean;
  onConnect: () => void;
  onEmbeddedSignupSuccess: () => void;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
        <PlugZap className="size-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-base font-semibold">No WhatsApp account connected</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Connect your WABA to start sending template campaigns and replying to
        inbound messages from the inbox.
      </p>
      {canManage ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <EmbeddedSignupButton onSuccess={onEmbeddedSignupSuccess} />
          <Button variant="outline" onClick={onConnect}>
            <PlugZap className="mr-2 size-4" /> Connect manually
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          An owner or admin can connect a WABA from this page.
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Connected state
// ----------------------------------------------------------------------------

interface AccountData {
  id: string;
  wabaId: string;
  displayName: string;
  status: string;
  connectedAt: Date | string | null;
  disconnectedAt: Date | string | null;
  appId: string;
  metadata: unknown;
}

function ConnectedState({
  account,
  canManage,
  onDisconnect,
  onRefresh,
}: {
  account: AccountData;
  canManage: boolean;
  onDisconnect: () => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const isConnected = account.status === 'CONNECTED';
  const test = api.whatsAppAccount.testConnection.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Token works — Meta returned id ${res.me.id}`);
      } else {
        toast.error(`Connection check failed: ${res.error}`);
      }
    },
    onError: (err) => toast.error(err.message),
  });
  const syncTemplates = api.whatsAppTemplate.syncNow.useMutation({
    onSuccess: (summary) => {
      toast.success(
        `Templates synced — ${summary.created} new, ${summary.updated} updated, ${summary.linked} linked, ${summary.pendingExpired} expired.`,
      );
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{account.displayName}</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                isConnected
                  ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
              )}
            >
              {isConnected ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
              {account.status}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">WABA ID</dt>
              <dd className="font-mono text-xs">{account.wabaId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">App ID</dt>
              <dd className="font-mono text-xs">{account.appId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Connected</dt>
              <dd>{formatDate(account.connectedAt)}</dd>
            </div>
            {!isConnected && account.disconnectedAt && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Disconnected</dt>
                <dd>{formatDate(account.disconnectedAt)}</dd>
              </div>
            )}
          </dl>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => test.mutate({})}
              disabled={test.isPending || !isConnected}
            >
              {test.isPending ? (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 size-3.5" />
              )}
              Test connection
            </Button>
            {isConnected && (
              <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
                <RefreshCw className="mr-2 size-3.5" />
                Refresh
              </Button>
            )}
            {isConnected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncTemplates.mutate()}
                disabled={syncTemplates.isPending}
              >
                {syncTemplates.isPending ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-3.5" />
                )}
                Sync templates
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onDisconnect}>
              <Trash2 className="mr-2 size-3.5" />
              Disconnect
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Phone numbers card
// ----------------------------------------------------------------------------

interface PhoneNumberData {
  id: string;
  phoneNumberId: string;
  phoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  messagingTier: string;
  currentTier24hUsage: number;
  displayPhoneNumberStatus: string;
  // Json column populated by the wa-phone-refresh cron / per-number
  // refresh. Tenants edit this in Meta Business Manager — we display
  // read-only.
  metadata?: unknown;
  tier24hWindowResetAt?: Date | string | null;
}

function PhoneNumbersCard({
  account,
  canManage,
  onRefreshed,
}: {
  account: { phoneNumbers?: PhoneNumberData[] };
  canManage: boolean;
  onRefreshed: () => void;
}): JSX.Element {
  const refresh = api.whatsAppAccount.refreshPhoneNumbers.useMutation({
    onSuccess: () => {
      toast.success('Phone numbers refreshed.');
      onRefreshed();
    },
    onError: (err) => toast.error(err.message),
  });

  const phones = account.phoneNumbers ?? [];

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h3 className="text-sm font-semibold">Phone numbers</h3>
          <p className="text-xs text-muted-foreground">
            Numbers registered to this WABA. Add new numbers in Meta Business
            Manager, then refresh.
          </p>
        </div>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh.mutate({})}
            disabled={refresh.isPending}
          >
            {refresh.isPending ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-3.5" />
            )}
            Pull from Meta
          </Button>
        )}
      </div>
      {phones.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          <Phone className="mx-auto size-6 opacity-40" />
          <p className="mt-3">
            No phone numbers registered yet. Register one in Meta Business
            Manager and click <strong>Pull from Meta</strong>.
          </p>
        </div>
      ) : (
        <ul className="divide-y">
          {phones.map((p) => (
            <PhoneNumberRow
              key={p.id}
              phone={p}
              canManage={canManage}
              onRefreshed={onRefreshed}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Phone number row + expansion (M4)
// ----------------------------------------------------------------------------

interface BusinessProfileShape {
  about?: string;
  description?: string;
  email?: string;
  address?: string;
  vertical?: string;
  websites?: string[];
  profile_picture_url?: string;
}

function PhoneNumberRow({
  phone: p,
  canManage,
  onRefreshed,
}: {
  phone: PhoneNumberData;
  canManage: boolean;
  onRefreshed: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const utils = api.useUtils();
  const refresh = api.whatsAppPhoneNumber.refresh.useMutation({
    onSuccess: () => {
      toast.success(`Refreshed ${p.phoneNumber}`);
      void utils.whatsAppAccount.get.invalidate();
      onRefreshed();
    },
    onError: (err) => toast.error(err.message),
  });

  const rawTierLimit = TIER_LIMITS[p.messagingTier];
  const tierLimit: number | null = rawTierLimit === undefined ? null : rawTierLimit;
  const usagePct =
    tierLimit !== null && tierLimit > 0
      ? Math.min(100, Math.round((p.currentTier24hUsage / tierLimit) * 100))
      : 0;

  const profile = (p.metadata as BusinessProfileShape | null) ?? null;
  const hasProfile =
    profile !== null &&
    (profile.about ||
      profile.description ||
      profile.address ||
      profile.email ||
      profile.vertical ||
      (profile.websites && profile.websites.length > 0));

  return (
    <li className="px-6 py-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{p.phoneNumber}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs',
                QUALITY_TONE[p.qualityRating] ?? QUALITY_TONE.UNKNOWN,
              )}
            >
              {p.qualityRating}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {p.displayPhoneNumberStatus}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {p.verifiedName} · {TIER_LABEL[p.messagingTier] ?? p.messagingTier}
          </p>
        </div>
        <div className="w-40 text-right text-xs text-muted-foreground">
          {tierLimit !== null ? (
            <>
              <div className="mb-1 flex items-center justify-end gap-1">
                <span>
                  {p.currentTier24hUsage.toLocaleString()} /{' '}
                  {tierLimit.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div
                  className={cn(
                    'h-1.5 rounded-full',
                    usagePct >= 90
                      ? 'bg-rose-500'
                      : usagePct >= 60
                      ? 'bg-amber-500'
                      : 'bg-emerald-500',
                  )}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            </>
          ) : (
            <span>No tier limit</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3 rounded-md border bg-muted/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Business profile
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Edit in Meta Business Manager. Refreshes every 6h via cron, or pull now.
              </p>
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => refresh.mutate({ id: p.id })}
                disabled={refresh.isPending}
              >
                {refresh.isPending ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-3.5" />
                )}
                Refresh
              </Button>
            )}
          </div>
          {hasProfile && profile ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {profile.about && (
                <ProfileField label="About" value={profile.about} />
              )}
              {profile.description && (
                <ProfileField label="Description" value={profile.description} />
              )}
              {profile.email && (
                <ProfileField label="Email" value={profile.email} />
              )}
              {profile.address && (
                <ProfileField label="Address" value={profile.address} />
              )}
              {profile.vertical && (
                <ProfileField label="Vertical" value={profile.vertical} />
              )}
              {profile.websites && profile.websites.length > 0 && (
                <ProfileField label="Websites" value={profile.websites.join(', ')} />
              )}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              No business profile fields set in Meta yet.
            </p>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-t pt-3 text-xs sm:grid-cols-2">
            <ProfileField label="Phone ID" value={p.phoneNumberId} mono />
            {p.tier24hWindowResetAt && (
              <ProfileField
                label="Tier window resets"
                value={new Date(p.tier24hWindowResetAt).toLocaleString()}
              />
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

function ProfileField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={cn('break-words', mono && 'font-mono text-[11px]')}>
        {value}
      </dd>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Connect dialog
// ----------------------------------------------------------------------------

function ConnectDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => Promise<void>;
}): JSX.Element {
  const form = useForm<WhatsAppAccountConnectManuallyInput>({
    resolver: zodResolver(whatsAppAccountConnectManuallySchema),
    defaultValues: {
      wabaId: '',
      accessToken: '',
      appId: '',
      appSecret: '',
      displayName: '',
    },
  });

  const connect = api.whatsAppAccount.connectManually.useMutation({
    onSuccess: async () => {
      toast.success('WhatsApp Business account connected.');
      form.reset();
      await onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect manually</DialogTitle>
          <DialogDescription>
            Paste credentials from{' '}
            <a
              href="https://business.facebook.com/"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Meta Business Manager
            </a>
            . Your token is encrypted at rest with a tenant-bound key.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => connect.mutate(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Demo Brands" {...field} />
                  </FormControl>
                  <FormDescription>
                    A short label so you can identify this WABA in our UI.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="wabaId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WABA ID</FormLabel>
                  <FormControl>
                    <Input placeholder="107655329012345" {...field} />
                  </FormControl>
                  <FormDescription>
                    Find this in Business Manager → Accounts → WhatsApp Accounts.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accessToken"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>System-User Access Token</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="EAA…" {...field} />
                  </FormControl>
                  <FormDescription>
                    Generate a long-lived system-user token in Business Settings →
                    System Users. Required scopes:{' '}
                    <code className="rounded bg-muted px-1 text-xs">whatsapp_business_messaging</code>
                    ,{' '}
                    <code className="rounded bg-muted px-1 text-xs">whatsapp_business_management</code>
                    .
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="appId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>App ID</FormLabel>
                  <FormControl>
                    <Input placeholder="1234567890" {...field} />
                  </FormControl>
                  <FormDescription>
                    The numeric Meta App ID associated with this WABA.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="appSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>App Secret (optional in M3)</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="32-char hex…" {...field} />
                  </FormControl>
                  <FormDescription>
                    Used by webhook signature verification. Optional for now —
                    we&apos;ll require it when webhooks ship in M9.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={connect.isPending}>
                {connect.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Verify &amp; connect
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Disconnect dialog
// ----------------------------------------------------------------------------

function DisconnectDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => Promise<void>;
}): JSX.Element {
  const disconnect = api.whatsAppAccount.disconnect.useMutation({
    onSuccess: async () => {
      toast.success('WhatsApp account disconnected.');
      await onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect WhatsApp?</DialogTitle>
          <DialogDescription>
            We&apos;ll wipe the encrypted token and stop sending. Templates,
            phone numbers, conversations, and message history are kept — you
            can reconnect later without losing anything.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => disconnect.mutate({ confirmation: 'disconnect' })}
            disabled={disconnect.isPending}
          >
            {disconnect.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString();
}
