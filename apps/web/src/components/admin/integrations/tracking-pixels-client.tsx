'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

export function TrackingPixelsClient(): JSX.Element {
  return (
    <div className="space-y-4">
      <MetaPixelPanel />
    </div>
  );
}

function MetaPixelPanel(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.metaPixel.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setPixelId(data.config.pixelId);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.metaPixel.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      void utils.integrations.metaPixel.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !data) return <Skeleton className="h-72" />;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            f
          </div>
          <div>
            <p className="font-semibold">Meta Pixel (Facebook)</p>
            <p className="text-xs text-muted-foreground">
              Tracks PageView on every marketing page, Purchase on
              /checkout/confirmation. Uses your Business Manager Pixel ID.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            data.enabled
              ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {data.enabled ? 'Live' : 'Off'}
        </span>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="space-y-1">
          <Label className="text-xs">Meta Pixel ID</Label>
          <Input
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value.replace(/\D/g, ''))}
            placeholder="123456789012345"
            className="font-mono"
            inputMode="numeric"
          />
          <p className="text-[11px] text-muted-foreground">
            Numeric only. Find yours in Business Manager → Events Manager →
            your Pixel → Settings.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 accent-foreground"
          />
          <span>
            <span className="font-medium">Enable Meta Pixel</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, the pixel script is injected on the public
              /pricing, /checkout, and /checkout/confirmation pages. Fires
              a standard Purchase event with the order value on the
              confirmation page.
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate({ pixelId, enabled })}
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
