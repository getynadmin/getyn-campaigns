'use client';

import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Loader2, Save, Wifi } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

export function PaymentGatewaysClient(): JSX.Element {
  return (
    <div className="space-y-4">
      <XpayPanel />
    </div>
  );
}

function XpayPanel(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.xpay.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [publicKey, setPublicKey] = useState('');
  const [callbackBaseUrl, setCallbackBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editPriv, setEditPriv] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [editHook, setEditHook] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [showPriv, setShowPriv] = useState(false);
  const [showHook, setShowHook] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setEnvironment(data.config.environment);
    setPublicKey(data.config.publicKey);
    setCallbackBaseUrl(data.config.callbackBaseUrl);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.xpay.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditPriv(false);
      setPrivateKey('');
      setEditHook(false);
      setWebhookSecret('');
      void utils.integrations.xpay.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const test = adminApi.integrations.xpay.test.useMutation({
    onSuccess: (r) => {
      toast.success(r.message);
      void utils.integrations.xpay.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.xpay.get.invalidate();
    },
  });

  if (isLoading || !data) return <Skeleton className="h-96" />;

  const copy = (v: string) => {
    void navigator.clipboard.writeText(v);
    toast.success('Copied.');
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            💳
          </div>
          <div>
            <p className="font-semibold">XPay Checkout</p>
            <p className="text-xs text-muted-foreground">
              docs.xpaycheckout.com · Basic auth · Hosted checkout redirect
            </p>
          </div>
        </div>
        <StatusPill
          lastStatus={data.lastTestStatus}
          liveSource={data.liveSource}
          environment={data.liveEnvironment}
        />
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Environment</Label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Public Key</Label>
            <Input
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="pk_live_… or pk_test_…"
            />
          </div>
          <SecretField
            label="Private Key"
            hasExisting={data.hasSecrets}
            editMode={editPriv}
            value={privateKey}
            onChange={setPrivateKey}
            onToggleEdit={() => setEditPriv((v) => !v)}
            visible={showPriv}
            onToggleVisible={() => setShowPriv((v) => !v)}
          />
          <SecretField
            label="Webhook Signing Secret"
            hasExisting={data.hasSecrets}
            editMode={editHook}
            value={webhookSecret}
            onChange={setWebhookSecret}
            onToggleEdit={() => setEditHook((v) => !v)}
            visible={showHook}
            onToggleVisible={() => setShowHook((v) => !v)}
          />
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">
              Callback base URL <span className="text-muted-foreground">(optional — defaults to this host)</span>
            </Label>
            <Input
              value={callbackBaseUrl}
              onChange={(e) => setCallbackBaseUrl(e.target.value)}
              placeholder="https://campaigns.getyn.com"
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <p className="text-sm font-medium">URLs to register in the XPay dashboard</p>
          <UrlRow label="Return URL" value={data.returnUrlHint} onCopy={copy} />
          <UrlRow label="Webhook URL" value={data.webhookUrlHint} onCopy={copy} />
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 accent-foreground"
          />
          <span>
            <span className="font-medium">Enable XPay</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, the /checkout flow creates real subscription
              intents against XPay. Off = checkout runs in preview mode
              (no charge, no callback).
            </span>
          </span>
        </label>

        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {test.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Wifi className="mr-2 size-4" />
            )}
            Test connection
          </Button>
          <Button
            onClick={() =>
              save.mutate({
                environment,
                publicKey,
                privateKey: editPriv ? privateKey : '',
                webhookSecret: editHook ? webhookSecret : '',
                callbackBaseUrl,
                enabled,
              })
            }
            disabled={save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Save
          </Button>
        </div>
      </section>
    </section>
  );
}

function SecretField({
  label,
  hasExisting,
  editMode,
  value,
  onChange,
  onToggleEdit,
  visible,
  onToggleVisible,
}: {
  label: string;
  hasExisting: boolean;
  editMode: boolean;
  value: string;
  onChange: (v: string) => void;
  onToggleEdit: () => void;
  visible: boolean;
  onToggleVisible: () => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {!editMode && hasExisting ? (
        <div className="flex items-center gap-2">
          <Input value="••••••••••••" readOnly className="font-mono" />
          <Button variant="outline" size="sm" onClick={onToggleEdit}>
            Change
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={hasExisting ? 'Enter new value or leave blank' : 'Paste value'}
            className="font-mono"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleVisible}
            title={visible ? 'Hide' : 'Show'}
          >
            {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          {hasExisting && (
            <Button variant="ghost" size="sm" onClick={onToggleEdit}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function UrlRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-xs text-muted-foreground">{label}</span>
      <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{value}</code>
      <Button variant="ghost" size="sm" onClick={() => onCopy(value)}>
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

function StatusPill({
  lastStatus,
  liveSource,
  environment,
}: {
  lastStatus: string;
  liveSource: string;
  environment: string;
}): JSX.Element {
  const color =
    lastStatus === 'PASS'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
      : lastStatus === 'FAIL'
        ? 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200'
        : 'bg-muted text-muted-foreground';
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
      <span className={`rounded-full px-2 py-0.5 font-medium ${color}`}>
        {lastStatus}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
        {environment}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
        {liveSource}
      </span>
    </div>
  );
}
