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
      <TrackingPanel />
    </div>
  );
}

function TrackingPanel(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.metaPixel.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [gaId, setGaId] = useState('');
  const [gtagId, setGtagId] = useState('');
  const [adsConversionId, setAdsConversionId] = useState('');
  const [adsPurchaseLabel, setAdsPurchaseLabel] = useState('');
  const [adsAddToCartLabel, setAdsAddToCartLabel] = useState('');

  useEffect(() => {
    if (!data || hydrated) return;
    setEnabled(data.enabled);
    setPixelId(data.config.pixelId);
    setGaId(data.config.gaId);
    setGtagId(data.config.gtagId);
    setAdsConversionId(data.config.adsConversionId);
    setAdsPurchaseLabel(data.config.adsPurchaseLabel);
    setAdsAddToCartLabel(data.config.adsAddToCartLabel);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.metaPixel.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      void utils.integrations.metaPixel.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !data) return <Skeleton className="h-96" />;

  return (
    <section className="space-y-4">
      {/* Master toggle */}
      <div className="flex items-center justify-between rounded-lg border bg-card p-5">
        <div>
          <p className="font-semibold">Enable tracking</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Master switch. When off, no pixels or tags load anywhere,
            regardless of the IDs below.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative inline-block h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-emerald-500">
            <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
        </label>
      </div>

      <section className="space-y-5 rounded-lg border bg-card p-5">
        <Field
          label="Facebook Pixel ID"
          hint="Meta Pixel — fires a PageView on every page."
          placeholder="773182113413719"
          value={pixelId}
          onChange={(v) => setPixelId(v.replace(/\D/g, ''))}
          mono
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Google Analytics ID"
            hint="GA4 measurement ID."
            placeholder="G-XXXXXXXXXX"
            value={gaId}
            onChange={setGaId}
            mono
          />
          <Field
            label="Google Tag ID"
            hint="Optional Google Tag (gtag) container."
            placeholder="AW-XXXXXXXXXX"
            value={gtagId}
            onChange={setGtagId}
            mono
          />
        </div>

        <Field
          label="Google Ads Conversion ID"
          hint="Google Ads / conversion tag. Loaded via the same gtag.js."
          placeholder="11322651176"
          value={adsConversionId}
          onChange={setAdsConversionId}
          mono
        />

        <Field
          label="Google Ads purchase label"
          hint={
            <>
              Optional. The conversion label for the <b>Purchase</b> action
              (the part after the slash in <code>AW-XXXX/label</code>). Used
              to fire the paid-checkout conversion. GA4{' '}
              <code>purchase</code> fires regardless.
            </>
          }
          placeholder="Cy_pCKX3-docEKjkh5cq"
          value={adsPurchaseLabel}
          onChange={setAdsPurchaseLabel}
          mono
        />

        <Field
          label="Google Ads add-to-cart label"
          hint={
            <>
              Optional. The conversion label for the <b>Add to cart</b>{' '}
              action (the part after the slash in <code>AW-XXXX/label</code>).
              Fires once when a visitor reaches the checkout page with a
              plan selected. Also sends a Meta <code>AddToCart</code> event.
            </>
          }
          placeholder="PBudCO35ubEdEKjkh5cq"
          value={adsAddToCartLabel}
          onChange={setAdsAddToCartLabel}
          mono
        />

        <div className="flex justify-end pt-2">
          <Button
            onClick={() =>
              save.mutate({
                pixelId,
                gaId,
                gtagId,
                adsConversionId,
                adsPurchaseLabel,
                adsAddToCartLabel,
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

function Field({
  label,
  hint,
  placeholder,
  value,
  onChange,
  mono,
}: {
  label: string;
  hint?: React.ReactNode;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? 'font-mono' : undefined}
      />
      {hint ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
