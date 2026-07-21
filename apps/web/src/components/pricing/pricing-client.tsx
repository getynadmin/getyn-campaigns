'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface PricingConfig {
  model: 'dynamic';
  basePriceCents: number;
  baseIncludedMessages: number;
  blockSize: number;
  pricePerBlockCents: number;
  annualDiscountPercent: number;
  minMessages: number;
  maxMessages: number;
  currency: string;
}

export interface PricingInitial {
  planId: string | null;
  planSlug: string | null;
  planName: string;
  description: string | null;
  features: Array<{ metric: string; included: number }>;
  config: PricingConfig;
}

type BillingCycle = 'monthly' | 'annual';

function fmtMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function normalizeVolume(v: number, cfg: PricingConfig): number {
  const c = Math.min(Math.max(v, cfg.minMessages), cfg.maxMessages);
  if (c <= cfg.baseIncludedMessages) return cfg.baseIncludedMessages;
  const extra = c - cfg.baseIncludedMessages;
  const blocks = Math.ceil(extra / cfg.blockSize);
  return cfg.baseIncludedMessages + blocks * cfg.blockSize;
}

function calc(volume: number, cfg: PricingConfig) {
  const v = normalizeVolume(volume, cfg);
  const extra = Math.max(0, v - cfg.baseIncludedMessages);
  const blocks = extra > 0 ? Math.ceil(extra / cfg.blockSize) : 0;
  const monthly = cfg.basePriceCents + blocks * cfg.pricePerBlockCents;
  const yearly = Math.round(
    monthly * 12 * (1 - cfg.annualDiscountPercent / 100),
  );
  return { volume: v, monthly, yearly, yearlyPerMonth: Math.round(yearly / 12) };
}

const INCLUDED_FEATURES = [
  'Unlimited email campaigns',
  'WhatsApp Business messaging',
  'Drip campaigns & automations',
  'AI email + WhatsApp agents',
  'Contact segmentation',
  'Drag-and-drop email designer',
  'Bulk import + email verifier',
  'Analytics & reporting',
  'Advance webhooks',
  'Inbuilt webforms',
  'Verified sending domains',
  '24×5 support',
];

export function PricingClient({ initial }: { initial: PricingInitial }): JSX.Element {
  const cfg = initial.config;
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [volume, setVolume] = useState<number>(cfg.minMessages);
  const quote = useMemo(() => calc(volume, cfg), [volume, cfg]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12 lg:py-20">
      <div className="mb-10 text-center">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3" /> Simple, usage-based pricing
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          One plan. Every feature.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          Slide to pick your monthly volume. Emails and WhatsApp messages share
          one bucket — send whichever mix your customers respond to.
        </p>
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm lg:p-8">
        {/* Volume slider */}
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <label className="text-sm font-medium text-muted-foreground">
                Marketing messages / month
              </label>
              <div className="rounded-md border bg-background px-3 py-1 text-sm font-mono">
                <span className="font-semibold">
                  {quote.volume.toLocaleString()}
                </span>{' '}
                <span className="text-xs text-muted-foreground">msgs</span>
              </div>
            </div>
            <input
              type="range"
              min={cfg.minMessages}
              max={cfg.maxMessages}
              step={cfg.blockSize}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>{cfg.minMessages.toLocaleString()}</span>
              <span>{Math.round(cfg.maxMessages / 2).toLocaleString()}</span>
              <span>{cfg.maxMessages.toLocaleString()}+</span>
            </div>
          </div>

          {/* Billing period toggle */}
          <div className="flex flex-col items-center gap-1">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Billing period
            </div>
            <div className="inline-flex rounded-full border bg-muted p-1">
              <button
                onClick={() => setCycle('monthly')}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  cycle === 'monthly'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setCycle('annual')}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  cycle === 'annual'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Annually
              </button>
            </div>
            {cfg.annualDiscountPercent > 0 && (
              <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                save {cfg.annualDiscountPercent}% off
              </div>
            )}
          </div>
        </div>

        {/* Price + CTA + features */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="rounded-xl border bg-background p-6">
            <div className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700">
              <Sparkles className="size-3.5" /> {initial.planName}
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-bold tracking-tight">
                  {fmtMoney(
                    cycle === 'monthly' ? quote.monthly : quote.yearlyPerMonth,
                    cfg.currency,
                  )}
                </span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {cycle === 'monthly'
                  ? `${quote.volume.toLocaleString()} messages, billed monthly`
                  : `${quote.volume.toLocaleString()} messages · ${fmtMoney(
                      quote.yearly,
                      cfg.currency,
                    )} billed yearly`}
              </p>
            </div>
            <div className="mt-5 space-y-2">
              <Button
                asChild
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Link
                  href={`/checkout?plan=${initial.planSlug ?? 'campaigns-pro'}&volume=${quote.volume}&cycle=${cycle}`}
                >
                  Subscribe now →
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="w-full border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                <Link
                  href={`/signup?plan=${initial.planSlug ?? 'campaigns-pro'}&trial=1`}
                >
                  Start free trial
                </Link>
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                14 days free · No credit card required
              </p>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-6">
            <p className="mb-4 text-sm font-medium">What&apos;s included:</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {INCLUDED_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3" />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">
              AI credits are billed separately inside the app · SMS coming soon
            </p>
          </div>
        </div>
      </section>

      {/* Preset volume examples */}
      <div className="mt-6 grid gap-3 text-center sm:grid-cols-4">
        {[cfg.minMessages, 25_000, 100_000, cfg.maxMessages].map((v) => {
          const q = calc(v, cfg);
          const price = cycle === 'monthly' ? q.monthly : q.yearlyPerMonth;
          return (
            <button
              key={v}
              onClick={() => setVolume(v)}
              className={`rounded-lg border p-3 text-left transition hover:border-primary/60 ${
                volume === v ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40' : 'bg-card'
              }`}
            >
              <div className="text-xs text-muted-foreground">
                {q.volume.toLocaleString()} msgs
              </div>
              <div className="mt-1 font-semibold">
                {fmtMoney(price, cfg.currency)}
                <span className="text-xs font-normal text-muted-foreground">
                  /mo
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Connect section */}
      <div className="mt-16 text-center">
        <h2 className="text-2xl font-semibold">Connect With Us</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Have questions? We&apos;re here to help you find the right plan.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-6 text-left">
            <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              💬
            </div>
            <p className="font-semibold">Chat with Sales</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Available Monday–Friday, 9 AM – 6 PM IST.
            </p>
            <Link
              href="https://getyn.com/contact"
              className="mt-3 inline-block text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Chat with Us →
            </Link>
          </div>
          <div className="rounded-xl border bg-card p-6 text-left">
            <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              ▶
            </div>
            <p className="font-semibold">Watch Product Tour</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Explore interactive demo videos of our apps and features.
            </p>
            <Link
              href="https://getyn.com/apps/campaigns#demo"
              className="mt-3 inline-block text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              See a demo →
            </Link>
          </div>
          <div className="rounded-xl border bg-card p-6 text-left">
            <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              ✎
            </div>
            <p className="font-semibold">Book a Demo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Schedule a call with a product specialist for a personalised
              walkthrough.
            </p>
            <Link
              href="https://getyn.com/contact"
              className="mt-3 inline-block text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Schedule call →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
