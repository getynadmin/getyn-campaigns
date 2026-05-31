'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

/**
 * Phase 5.6 M2 — WhatsApp (Meta) integration form.
 *
 * Secret fields render masked when a value is on file and accept
 * "Replace" mode for typing a fresh value. Leaving them blank on
 * save keeps the existing ciphertext untouched (server-side merge).
 */
export function WhatsAppIntegrationClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.whatsApp.get.useQuery();

  const [appId, setAppId] = useState('');
  const [configId, setConfigId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editAppSecret, setEditAppSecret] = useState(false);
  const [appSecret, setAppSecret] = useState('');
  const [editVerifyToken, setEditVerifyToken] = useState(false);
  const [verifyToken, setVerifyToken] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setAppId(data.config.appId);
    setConfigId(data.config.configId);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.whatsApp.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditAppSecret(false);
      setAppSecret('');
      setEditVerifyToken(false);
      setVerifyToken('');
      void utils.integrations.whatsApp.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const test = adminApi.integrations.whatsApp.test.useMutation({
    onSuccess: () => {
      toast.success('Meta accepted the credentials.');
      void utils.integrations.whatsApp.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.whatsApp.get.invalidate();
    },
  });

  if (isLoading || !data) {
    return <Skeleton className="h-96" />;
  }

  const onCopy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      toast.success(`${label} copied.`);
    });
  };

  return (
    <div className="space-y-4">
      <StatusCard
        status={data.lastTestStatus}
        lastTestedAt={data.lastTestedAt}
        error={data.lastTestError}
        liveSource={data.liveSource}
      />

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">App ID</Label>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="e.g. 1234567890123456"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Config ID (Embedded Signup)</Label>
            <Input
              value={configId}
              onChange={(e) => setConfigId(e.target.value)}
              placeholder="e.g. 9876543210"
            />
          </div>

          {/* App Secret */}
          <SecretField
            label="App Secret"
            hasExisting={data.hasSecrets}
            editMode={editAppSecret}
            value={appSecret}
            onChange={setAppSecret}
            onToggleEdit={() => setEditAppSecret((v) => !v)}
            visible={showSecret}
            onToggleVisible={() => setShowSecret((v) => !v)}
          />

          {/* Verify Token */}
          <SecretField
            label="Webhook Verify Token"
            hasExisting={data.hasSecrets}
            editMode={editVerifyToken}
            value={verifyToken}
            onChange={setVerifyToken}
            onToggleEdit={() => setEditVerifyToken((v) => !v)}
            visible={showToken}
            onToggleVisible={() => setShowToken((v) => !v)}
          />

          <div className="md:col-span-2 space-y-1">
            <Label className="text-xs">Webhook URL (paste into Meta)</Label>
            <div className="flex gap-2">
              <Input value={data.webhookUrlHint} readOnly className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => onCopy(data.webhookUrlHint, 'Webhook URL')}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 accent-foreground"
          />
          <span>
            <span className="font-medium">Enable integration</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, the app reads credentials from the DB. When off, it
              falls back to env vars.
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
                appId,
                configId,
                appSecret: editAppSecret ? appSecret : '',
                webhookVerifyToken: editVerifyToken ? verifyToken : '',
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
    </div>
  );
}

function StatusCard({
  status,
  lastTestedAt,
  error,
  liveSource,
}: {
  status: 'UNTESTED' | 'OK' | 'FAILED';
  lastTestedAt: Date | null;
  error: string | null;
  liveSource: 'db' | 'env';
}): JSX.Element {
  const cls =
    status === 'OK'
      ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
      : status === 'FAILED'
        ? 'border-rose-300 bg-rose-50/60 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
        : 'border-amber-300 bg-amber-50/60 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200';
  const Icon =
    status === 'OK' ? Check : status === 'FAILED' ? ShieldAlert : ShieldCheck;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <div className="flex items-center gap-2 font-medium">
        <Icon className="size-4" />
        {status === 'OK'
          ? 'Verified'
          : status === 'FAILED'
            ? 'Failed'
            : 'Untested'}
        <span className="ml-auto text-[10px] uppercase tracking-wide opacity-70">
          Live source: {liveSource}
        </span>
      </div>
      {lastTestedAt && (
        <p className="mt-1 text-xs opacity-80">
          Last tested {new Date(lastTestedAt).toLocaleString()}
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs opacity-80">Last error: {error}</p>
      )}
    </div>
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
      {editMode || !hasExisting ? (
        <div className="flex gap-2">
          <Input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={hasExisting ? 'Type new value' : 'Enter value'}
          />
          <Button variant="outline" size="icon" onClick={onToggleVisible}>
            {visible ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </Button>
          {hasExisting && (
            <Button variant="ghost" size="sm" onClick={onToggleEdit}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input value="••••••••••••" readOnly className="font-mono" />
          <Button variant="outline" size="sm" onClick={onToggleEdit}>
            Replace
          </Button>
        </div>
      )}
    </div>
  );
}
