'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

type Size = '1024x1024' | '1792x1024' | '1024x1792';
type Quality = 'standard' | 'hd';
type Style = 'vivid' | 'natural';

export function DalleIntegrationClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.dalle.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [model, setModel] = useState('');
  const [defaultSize, setDefaultSize] = useState<Size>('1024x1024');
  const [defaultQuality, setDefaultQuality] = useState<Quality>('standard');
  const [defaultStyle, setDefaultStyle] = useState<Style>('vivid');
  const [enabled, setEnabled] = useState(false);
  const [editKey, setEditKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testImageUrl, setTestImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data || hydrated) return;
    setModel(data.config.model);
    setDefaultSize(data.config.defaultSize as Size);
    setDefaultQuality(data.config.defaultQuality as Quality);
    setDefaultStyle(data.config.defaultStyle as Style);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.dalle.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditKey(false);
      setApiKey('');
      void utils.integrations.dalle.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const test = adminApi.integrations.dalle.test.useMutation({
    onSuccess: () => {
      toast.success('OpenAI key is valid.');
      void utils.integrations.dalle.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.dalle.get.invalidate();
    },
  });
  const generateTest = adminApi.integrations.dalle.generateTest.useMutation({
    onSuccess: (res) => {
      setTestImageUrl(res.url);
      toast.success('Test image generated.');
      void utils.integrations.dalle.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.dalle.get.invalidate();
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
            <Label className="text-xs">OpenAI API key</Label>
            {editKey || !data.hasSecrets ? (
              <div className="flex gap-2">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    data.hasSecrets ? 'sk-… (paste new key)' : 'sk-…'
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
              Used platform-wide for DALL-E 3 image generation inside the
              Campaign Agent. Stored encrypted (AES-256-GCM). Get a key
              from{' '}
              <a
                className="underline"
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
              >
                platform.openai.com
              </a>
              .
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Model override (optional)</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="dall-e-3 (default)"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <RadioGroup
              label="Default size"
              value={defaultSize}
              onChange={(v) => setDefaultSize(v as Size)}
              options={[
                { value: '1024x1024', label: 'Square' },
                { value: '1792x1024', label: 'Wide' },
                { value: '1024x1792', label: 'Tall' },
              ]}
            />
            <RadioGroup
              label="Default quality"
              value={defaultQuality}
              onChange={(v) => setDefaultQuality(v as Quality)}
              options={[
                { value: 'standard', label: 'Standard ($0.04)' },
                { value: 'hd', label: 'HD ($0.08)' },
              ]}
            />
            <RadioGroup
              label="Default style"
              value={defaultStyle}
              onChange={(v) => setDefaultStyle(v as Style)}
              options={[
                { value: 'vivid', label: 'Vivid' },
                { value: 'natural', label: 'Natural' },
              ]}
            />
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
            <span className="font-medium">Enable DALL-E for tenants</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, the campaign agent can call
              {' '}<code>generate_image_for_block</code> (max 3 generations per
              conversation). Off = agent uses only attached images or
              placeholders.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => test.mutate()}
              disabled={test.isPending || !data.hasSecrets}
            >
              {test.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              Test connection
            </Button>
            <Button
              variant="outline"
              onClick={() => generateTest.mutate()}
              disabled={generateTest.isPending || !data.hasSecrets}
            >
              {generateTest.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 size-4" />
              )}
              Test generation ($0.04)
            </Button>
          </div>
          <Button
            onClick={() =>
              save.mutate({
                apiKey: editKey || !data.hasSecrets ? apiKey : '',
                model: model.trim(),
                defaultSize,
                defaultQuality,
                defaultStyle,
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

        {testImageUrl && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium">Test image</p>
            <Image
              src={testImageUrl}
              alt="DALL-E test"
              width={512}
              height={512}
              className="rounded-md"
              unoptimized
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Prompt: <em>&ldquo;a simple geometric pattern, minimalist,
              soft pastel colors&rdquo;</em>. OpenAI&rsquo;s URL expires
              in ~1 hour.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function RadioGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-col gap-1 rounded-md border p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={
              'rounded px-2 py-1 text-left text-xs ' +
              (value === opt.value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
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
