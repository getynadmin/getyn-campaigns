'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type SliderRowProps = {
  label: string;
  unit: string;
  included: number;
  bundles: number;
  pricePer100Cents: number;
  maxBundles: number;
  onChange: (n: number) => void;
};

function SliderRow({
  label,
  unit,
  included,
  bundles,
  pricePer100Cents,
  maxBundles,
  onChange,
}: SliderRowProps): JSX.Element {
  const extra = bundles * 100;
  const total = included === -1 ? -1 : included + extra;
  return (
    <div className="space-y-2 rounded-md border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px] text-muted-foreground">
            {included === -1
              ? 'Unlimited in plan'
              : `${included.toLocaleString()} ${unit} included`}
            {extra > 0
              ? ` · +${extra.toLocaleString()} extra = ${total === -1 ? '∞' : total.toLocaleString()}`
              : null}
          </p>
        </div>
        <p className="text-right font-mono text-sm tabular-nums">
          {bundles === 0
            ? '—'
            : `+${formatUSD(bundles * pricePer100Cents)}/mo`}
        </p>
      </div>
      <input
        type="range"
        min={0}
        max={maxBundles}
        step={1}
        value={bundles}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-foreground"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <span>{maxBundles * 100} extra</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        ${(pricePer100Cents / 100).toFixed(2)} per 100 extra {unit}
      </p>
    </div>
  );
}

export function UpgradeModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}): JSX.Element {
  const utils = api.useUtils();
  const { data } = api.subscription.get.useQuery();
  const [ai, setAi] = useState(0);
  const [wa, setWa] = useState(0);
  const [sms, setSms] = useState(0);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');

  const sub = data?.subscription;
  const limits = data?.limits;

  const aiPricePer100 = sub?.extraAiCreditsPricePer100 ?? 2500;
  const waPricePer100 = sub?.extraWhatsappPricePer100 ?? 500;
  const smsPricePer100 = sub?.extraSmsPricePer100 ?? 200;

  const extrasMonthly =
    ai * aiPricePer100 + wa * waPricePer100 + sms * smsPricePer100;
  const base = sub?.priceMonthlyCents ?? 0;
  const monthly = base + extrasMonthly;
  const annualBeforeDiscount = monthly * 12;
  // 10% annual discount — matches /pricing convention; fine-tune per-plan later.
  const annual = Math.round(annualBeforeDiscount * 0.9);
  const totalShown = cycle === 'monthly' ? monthly : annual;

  const start = api.subscription.startUpgrade.useMutation({
    onSuccess: (res) => {
      if (res.previewMode && res.applied) {
        toast.success('Upgrade applied. Enjoy the extra capacity.');
        void utils.subscription.get.invalidate();
        void utils.subscription.usage.invalidate();
        onOpenChange(false);
      } else if (res.fwdUrl) {
        window.location.href = res.fwdUrl;
      }
    },
    onError: (err) => toast.error(err.message ?? 'Could not start upgrade.'),
  });

  const includedAi = useMemo(
    () => limits?.AI_CREDITS_PER_MONTH ?? 0,
    [limits],
  );
  const includedWa = useMemo(
    () => limits?.WA_MESSAGES_PER_MONTH ?? 0,
    [limits],
  );
  const includedSms = useMemo(
    () => limits?.SMS_SEGMENTS_PER_MONTH ?? 0,
    [limits],
  );

  const showSms = includedSms !== 0; // hide if plan doesn't ship SMS
  const nothingSelected = ai === 0 && wa === 0 && sms === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upgrade your plan</DialogTitle>
          <DialogDescription>
            Keep the plan you're on — add exactly the extra capacity
            you need. New limits apply instantly after checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-2 inline-flex items-center gap-1 rounded-md border bg-muted/40 p-1 text-xs">
          {(['monthly', 'annual'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={cn(
                'rounded px-3 py-1 font-medium transition-colors',
                cycle === c
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {c === 'monthly' ? 'Monthly' : 'Annually — save 10%'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {includedAi !== 0 ? (
            <SliderRow
              label="AI credits / month"
              unit="credits"
              included={includedAi}
              bundles={ai}
              pricePer100Cents={aiPricePer100}
              maxBundles={50}
              onChange={setAi}
            />
          ) : null}
          {includedWa !== 0 ? (
            <SliderRow
              label="WhatsApp messages / month"
              unit="messages"
              included={includedWa}
              bundles={wa}
              pricePer100Cents={waPricePer100}
              maxBundles={100}
              onChange={setWa}
            />
          ) : null}
          {showSms ? (
            <SliderRow
              label="SMS segments / month"
              unit="segments"
              included={includedSms}
              bundles={sms}
              pricePer100Cents={smsPricePer100}
              maxBundles={100}
              onChange={setSms}
            />
          ) : null}
        </div>

        <div className="mt-3 flex items-center justify-between rounded-md border bg-primary/5 px-4 py-3">
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-mono text-xl font-semibold tabular-nums">
              {formatUSD(totalShown)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                / {cycle === 'monthly' ? 'month' : 'year'}
              </span>
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            base {formatUSD(base)} + extras{' '}
            {formatUSD(
              extrasMonthly * (cycle === 'monthly' ? 1 : 12 * 0.9),
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={start.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              start.mutate({
                extraAiBundles: ai,
                extraWhatsappBundles: wa,
                extraSmsBundles: sms,
                billingCycle: cycle,
              })
            }
            disabled={start.isPending || nothingSelected}
          >
            {start.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            Upgrade now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
