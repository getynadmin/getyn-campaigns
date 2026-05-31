'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  HeartPulse,
  Loader2,
  Plus,
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { adminApi } from '@/lib/admin-trpc';

export function SendingServersClient(): JSX.Element {
  return (
    <Tabs defaultValue="resend" className="space-y-4">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="resend">Resend</TabsTrigger>
          <TabsTrigger value="railway">Railway Worker API</TabsTrigger>
        </TabsList>
        <Button
          variant="outline"
          size="sm"
          onClick={() => toast.message('More providers coming soon (Postmark, SES, …).')}
        >
          <Plus className="mr-2 size-3.5" />
          Add Provider
        </Button>
      </div>
      <TabsContent value="resend">
        <ResendTab />
      </TabsContent>
      <TabsContent value="railway">
        <RailwayTab />
      </TabsContent>
    </Tabs>
  );
}

function ResendTab(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.resend.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [defaultFromEmail, setDefaultFromEmail] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editKey, setEditKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [editHook, setEditHook] = useState(false);
  const [webhookSigningSecret, setWebhookSigningSecret] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showHook, setShowHook] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setDefaultFromEmail(data.config.defaultFromEmail);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.resend.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditKey(false);
      setApiKey('');
      setEditHook(false);
      setWebhookSigningSecret('');
      void utils.integrations.resend.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const test = adminApi.integrations.resend.test.useMutation({
    onSuccess: () => {
      toast.success('Resend accepted the API key.');
      void utils.integrations.resend.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.resend.get.invalidate();
    },
  });

  if (isLoading || !data) return <Skeleton className="h-80" />;

  return (
    <div className="space-y-4">
      <StatusCard status={data.lastTestStatus} lastTestedAt={data.lastTestedAt} error={data.lastTestError} liveSource={data.liveSource} />
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Default from email</Label>
            <Input
              type="email"
              value={defaultFromEmail}
              onChange={(e) => setDefaultFromEmail(e.target.value)}
              placeholder="noreply@send.getyn.app"
            />
          </div>
          <SecretField
            label="API Key"
            hasExisting={data.hasSecrets}
            editMode={editKey}
            value={apiKey}
            onChange={setApiKey}
            onToggleEdit={() => setEditKey((v) => !v)}
            visible={showKey}
            onToggleVisible={() => setShowKey((v) => !v)}
          />
          <SecretField
            label="Webhook Signing Secret"
            hasExisting={data.hasSecrets}
            editMode={editHook}
            value={webhookSigningSecret}
            onChange={setWebhookSigningSecret}
            onToggleEdit={() => setEditHook((v) => !v)}
            visible={showHook}
            onToggleVisible={() => setShowHook((v) => !v)}
          />
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 accent-foreground"
          />
          <span>
            <span className="font-medium">Enable Resend</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, tenant campaigns + Resend domain operations read this row. Off = env vars.
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
                apiKey: editKey ? apiKey : '',
                defaultFromEmail,
                webhookSigningSecret: editHook ? webhookSigningSecret : '',
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

function RailwayTab(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.railway.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [workerUrl, setWorkerUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editToken, setEditToken] = useState(false);
  const [projectToken, setProjectToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setWorkerUrl(data.config.workerUrl);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.railway.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditToken(false);
      setProjectToken('');
      void utils.integrations.railway.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const test = adminApi.integrations.railway.test.useMutation({
    onSuccess: () => {
      toast.success('Worker /health responded OK.');
      void utils.integrations.railway.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.railway.get.invalidate();
    },
  });

  if (isLoading || !data) return <Skeleton className="h-80" />;

  return (
    <div className="space-y-4">
      <StatusCard status={data.lastTestStatus} lastTestedAt={data.lastTestedAt} error={data.lastTestError} liveSource="db" />
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Worker URL</Label>
            <Input
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://getyn-worker.up.railway.app"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Project Token</Label>
            {editToken || !data.hasSecrets ? (
              <div className="flex gap-2">
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={projectToken}
                  onChange={(e) => setProjectToken(e.target.value)}
                  placeholder={data.hasSecrets ? 'Type new token' : 'Token'}
                />
                <Button variant="outline" size="icon" onClick={() => setShowToken((v) => !v)}>
                  {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
                {data.hasSecrets && (
                  <Button variant="ghost" size="sm" onClick={() => setEditToken(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input value="••••••••••••" readOnly className="font-mono" />
                <Button variant="outline" size="sm" onClick={() => setEditToken(true)}>
                  Replace
                </Button>
              </div>
            )}
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
            <span className="font-medium">Enable Railway integration</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Used for worker control-plane operations (health checks, restarts).
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
              <HeartPulse className="mr-2 size-4" />
            )}
            Health check
          </Button>
          <Button
            onClick={() =>
              save.mutate({
                workerUrl,
                projectToken: editToken ? projectToken : '',
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
  const Icon = status === 'OK' ? Check : status === 'FAILED' ? ShieldAlert : ShieldCheck;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <div className="flex items-center gap-2 font-medium">
        <Icon className="size-4" />
        {status === 'OK' ? 'OK' : status === 'FAILED' ? 'Failed' : 'Untested'}
        <span className="ml-auto text-[10px] uppercase tracking-wide opacity-70">
          Live source: {liveSource}
        </span>
      </div>
      {lastTestedAt && (
        <p className="mt-1 text-xs opacity-80">
          Last tested {new Date(lastTestedAt).toLocaleString()}
        </p>
      )}
      {error && <p className="mt-1 text-xs opacity-80">Last error: {error}</p>}
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
            {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
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
