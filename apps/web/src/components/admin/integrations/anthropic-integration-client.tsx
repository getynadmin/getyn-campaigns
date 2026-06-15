'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

export function AnthropicIntegrationClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.anthropic.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editKey, setEditKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setModel(data.config.model);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.anthropic.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditKey(false);
      setApiKey('');
      void utils.integrations.anthropic.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const test = adminApi.integrations.anthropic.test.useMutation({
    onSuccess: () => {
      toast.success('Anthropic API key is valid.');
      void utils.integrations.anthropic.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.anthropic.get.invalidate();
    },
  });

  if (isLoading || !data) return <Skeleton className="h-72" />;

  return (
    <div className="space-y-4">
      <StatusCard
        status={data.lastTestStatus}
        lastTestedAt={data.lastTestedAt}
        error={data.lastTestError}
        liveSource={data.liveSource}
      />

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Anthropic API key</Label>
            {editKey || !data.hasSecrets ? (
              <div className="flex gap-2">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    data.hasSecrets
                      ? 'sk-ant-… (paste new key)'
                      : 'sk-ant-…'
                  }
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </Button>
                {data.hasSecrets && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditKey(false)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value="••••••••••••••••••••"
                  readOnly
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditKey(true)}
                >
                  Replace
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Used platform-wide for the Campaign Agent and all AI drafting.
              Stored encrypted (AES-256-GCM). Get a key from{' '}
              <a
                className="underline"
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
              >
                console.anthropic.com
              </a>
              .
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Model override (optional)</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-3-5-sonnet-20241022 (default)"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use the package default. Pin a specific Claude
              version to keep agent behaviour stable across deploys.
            </p>
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
            <span className="font-medium">Enable Anthropic</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, the agent and template drafter call Claude with
              the key above. When off, AI surfaces fall back to the
              ANTHROPIC_API_KEY env var (if set) or report &ldquo;AI not
              configured&rdquo;.
            </span>
          </span>
        </label>

        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending || !data.hasSecrets}
          >
            {test.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Zap className="mr-2 size-4" />
            )}
            Test connection
          </Button>
          <Button
            onClick={() =>
              save.mutate({
                // The input is editable whenever there's no saved key
                // yet OR the user clicked "Replace". In both cases the
                // typed value is what they want persisted.
                apiKey: editKey || !data.hasSecrets ? apiKey : '',
                model: model.trim(),
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
        {status === 'OK' ? 'OK' : status === 'FAILED' ? 'Failed' : 'Untested'}
        <span className="ml-auto rounded border px-1.5 py-0.5 text-[10px] uppercase opacity-70">
          Live key: {liveSource}
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
