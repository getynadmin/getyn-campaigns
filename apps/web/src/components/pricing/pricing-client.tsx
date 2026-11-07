'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Check,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
} from 'lucide-react';

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
  freeTrialEnabled: boolean;
  extras?: {
    aiPricePer100Cents: number;
    whatsappPricePer100Cents: number;
    smsPricePer100Cents: number;
  };
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

/**
 * Non-quota features — supplement the dynamic quota tiles so the
 * "What's included" section still conveys the qualitative product
 * story (editor, agents, analytics, support).
 */
const QUALITATIVE_FEATURES = [
  'Drag-and-drop email designer',
  'Drip campaigns & automations',
  'AI email + WhatsApp agents',
  'Contact segmentation',
  'Bulk import + email verifier',
  'Analytics & reporting',
  'Advanced webhooks',
  'Inbuilt webforms',
  'Verified sending domains',
  '24×5 support',
];

/**
 * Baseline included allowances if the DB-driven `features` array
 * doesn't surface one — keeps the four tiles populated even on a
 * fresh install. Numbers match the current Campaigns Pro defaults.
 */
const DEFAULT_INCLUDED = {
  emailsMonthly: 250_000,
  whatsappMonthly: 10_000,
  smsMonthly: 0,
  aiCreditsMonthly: 2_000,
};

function lookupIncluded(
  features: PricingInitial['features'],
  metric: string,
  fallback: number,
): number {
  const hit = features.find((f) => f.metric === metric);
  return hit ? hit.included : fallback;
}

export function PricingClient({ initial }: { initial: PricingInitial }): JSX.Element {
  const cfg = initial.config;
  const extras = initial.extras ?? {
    aiPricePer100Cents: 2500,
    whatsappPricePer100Cents: 500,
    smsPricePer100Cents: 200,
  };
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [volume, setVolume] = useState<number>(cfg.minMessages);
  const [extraAi, setExtraAi] = useState(0);
  const [extraWa, setExtraWa] = useState(0);
  const [extraSms, setExtraSms] = useState(0);
  const baseQuote = useMemo(() => calc(volume, cfg), [volume, cfg]);
  const extrasMonthly =
    extraAi * extras.aiPricePer100Cents +
    extraWa * extras.whatsappPricePer100Cents +
    extraSms * extras.smsPricePer100Cents;
  const extrasYearly = Math.round(
    extrasMonthly * 12 * (1 - cfg.annualDiscountPercent / 100),
  );
  const totalMonthly = baseQuote.monthly + extrasMonthly;
  const totalYearly = baseQuote.yearly + extrasYearly;
  const totalYearlyPerMonth = Math.round(totalYearly / 12);
  const quote = {
    ...baseQuote,
    monthly: totalMonthly,
    yearly: totalYearly,
    yearlyPerMonth: totalYearlyPerMonth,
  };

  // Base plan's monthly included quotas come from the server's
  // `features` payload. Marketing volume is the slider; the other
  // three come from the plan row.
  const includedEmails = quote.volume;
  const includedWhatsapp =
    lookupIncluded(initial.features, 'whatsappMonthly', DEFAULT_INCLUDED.whatsappMonthly) +
    extraWa * 100;
  const includedSms =
    lookupIncluded(initial.features, 'smsMonthly', DEFAULT_INCLUDED.smsMonthly) +
    extraSms * 100;
  const includedAiCredits =
    lookupIncluded(initial.features, 'aiCreditsMonthly', DEFAULT_INCLUDED.aiCreditsMonthly) +
    extraAi * 100;

  // ── Force light theme on /pricing regardless of tenant dark-mode preference.
  // The app toggles `<html class="dark">`; strip it on mount for this route
  // and restore on unmount so navigating back to the app keeps the user's choice.
  useEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains('dark');
    html.classList.remove('dark');
    return () => {
      if (wasDark) html.classList.add('dark');
    };
  }, []);

  return (
    <div className="light bg-white text-neutral-900">
      <div className="mx-auto max-w-6xl px-6 py-12 lg:py-20">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <Sparkles className="size-3" /> Simple, usage-based pricing
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
            One plan. Every feature.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-neutral-600">
            Slide to pick your monthly volume. Emails and WhatsApp messages share
            one bucket — send whichever mix your customers respond to.
          </p>
        </div>

        <section className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-white via-emerald-50/30 to-white p-6 shadow-sm lg:p-8">
          {/* Volume slider */}
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <label className="text-sm font-medium text-neutral-600">
                  Marketing messages / month
                </label>
                <div className="rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm font-mono tabular-nums">
                  <span className="font-semibold text-neutral-900">
                    {quote.volume.toLocaleString()}
                  </span>{' '}
                  <span className="text-xs text-neutral-500">msgs</span>
                </div>
              </div>
              <input
                type="range"
                min={cfg.minMessages}
                max={cfg.maxMessages}
                step={cfg.blockSize}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-200 accent-emerald-600"
              />
              <div className="mt-2 flex justify-between text-[11px] text-neutral-500">
                <span>{cfg.minMessages.toLocaleString()}</span>
                <span>{Math.round(cfg.maxMessages / 2).toLocaleString()}</span>
                <span>{cfg.maxMessages.toLocaleString()}+</span>
              </div>
            </div>

            {/* Billing period toggle */}
            <div className="flex flex-col items-center gap-1">
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                Billing period
              </div>
              <div className="inline-flex rounded-full border border-neutral-200 bg-neutral-100 p-1">
                <button
                  onClick={() => setCycle('monthly')}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    cycle === 'monthly'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setCycle('annual')}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    cycle === 'annual'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Annually
                </button>
              </div>
              {cfg.annualDiscountPercent > 0 && (
                <div className="text-[11px] font-medium text-emerald-700">
                  save {cfg.annualDiscountPercent}% off
                </div>
              )}
            </div>
          </div>

          {/* Extras sliders */}
          <div className="mt-6 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-3">
            <ExtrasSlider
              label="AI credits"
              unit="credits"
              value={extraAi}
              onChange={setExtraAi}
              max={50}
              pricePer100Cents={extras.aiPricePer100Cents}
              currency={cfg.currency}
            />
            <ExtrasSlider
              label="WhatsApp msgs"
              unit="msgs"
              value={extraWa}
              onChange={setExtraWa}
              max={100}
              pricePer100Cents={extras.whatsappPricePer100Cents}
              currency={cfg.currency}
            />
            <ExtrasSlider
              label="SMS messages"
              unit="msgs"
              value={extraSms}
              onChange={setExtraSms}
              max={100}
              pricePer100Cents={extras.smsPricePer100Cents}
              currency={cfg.currency}
            />
          </div>

          {/* Price + CTA + features */}
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
            <div className="rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-600/10 px-2.5 py-0.5 text-sm font-semibold text-emerald-700">
                <Sparkles className="size-3.5" /> {initial.planName}
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-bold tracking-tight text-neutral-900">
                    {fmtMoney(
                      cycle === 'monthly' ? quote.monthly : quote.yearlyPerMonth,
                      cfg.currency,
                    )}
                  </span>
                  <span className="text-sm text-neutral-500">/mo</span>
                </div>
                {cycle === 'annual' && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {fmtMoney(quote.yearly, cfg.currency)} billed yearly
                  </p>
                )}
              </div>
              <div className="mt-5 space-y-2">
                <Button
                  asChild
                  className="w-full bg-emerald-600 text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700"
                >
                  <Link
                    href={`/checkout?plan=${initial.planSlug ?? 'campaigns-pro'}&volume=${quote.volume}&cycle=${cycle}&extraAi=${extraAi}&extraWa=${extraWa}&extraSms=${extraSms}`}
                  >
                    Subscribe now →
                  </Link>
                </Button>
                {initial.freeTrialEnabled && (
                  <>
                    <Button
                      asChild
                      variant="outline"
                      className="w-full border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50"
                    >
                      <Link
                        href={`/signup?plan=${initial.planSlug ?? 'campaigns-pro'}&trial=1&extraAi=${extraAi}&extraWa=${extraWa}&extraSms=${extraSms}`}
                      >
                        Start free trial
                      </Link>
                    </Button>
                    <p className="text-center text-[11px] text-neutral-500">
                      14 days free · No credit card required
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-6">
              <p className="mb-4 text-sm font-medium text-neutral-900">
                What&apos;s included this month:
              </p>

              {/* 2×2 dynamic quota tiles — updates live with sliders */}
              <div className="grid gap-3 sm:grid-cols-2">
                <QuotaTile
                  icon={Mail}
                  label="Marketing emails"
                  value={includedEmails}
                  unit="/mo"
                  tone="mint"
                />
                <QuotaTile
                  icon={MessageCircle}
                  label="WhatsApp messages"
                  value={includedWhatsapp}
                  unit="/mo"
                  tone="teal"
                />
                <QuotaTile
                  icon={Phone}
                  label="SMS messages"
                  value={includedSms}
                  unit="/mo"
                  tone="amber"
                  comingSoon={includedSms === 0}
                />
                <QuotaTile
                  icon={BrainCircuit}
                  label="AI credits"
                  value={includedAiCredits}
                  unit="/mo"
                  tone="violet"
                />
              </div>

              {/* Qualitative features */}
              <ul className="mt-5 grid gap-2 border-t border-neutral-100 pt-4 sm:grid-cols-2">
                {QUALITATIVE_FEATURES.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-neutral-700">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                      <Check className="size-2.5" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
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
                className={`rounded-lg border p-3 text-left transition hover:border-emerald-400 ${
                  volume === v
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="text-xs text-neutral-500">
                  {q.volume.toLocaleString()} msgs
                </div>
                <div className="mt-1 font-semibold text-neutral-900">
                  {fmtMoney(price, cfg.currency)}
                  <span className="text-xs font-normal text-neutral-500">/mo</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Connect section */}
        <div className="mt-16 text-center">
          <h2 className="text-2xl font-semibold text-neutral-900">Connect With Us</h2>
          <p className="mt-2 text-sm text-neutral-600">
            Have questions? We&apos;re here to help you find the right plan.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <a
              href="https://wa.me/447859779507?text=I%27m%20interested%20in%20your%20apps"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-neutral-200 bg-white p-6 text-left transition hover:border-emerald-400 hover:shadow-sm"
            >
              <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <MessageCircle className="size-5" />
              </div>
              <p className="font-semibold text-neutral-900">Chat with Sales</p>
              <p className="mt-1 text-xs text-neutral-500">
                Available Monday–Friday, 9 AM – 6 PM IST.
              </p>
              <span className="mt-3 inline-block text-sm font-medium text-emerald-700">
                Chat with Us →
              </span>
            </a>
            <a
              href="mailto:sales@getyn.com"
              className="block rounded-xl border border-neutral-200 bg-white p-6 text-left transition hover:border-emerald-400 hover:shadow-sm"
            >
              <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <Mail className="size-5" />
              </div>
              <p className="font-semibold text-neutral-900">Email Us</p>
              <p className="mt-1 text-xs text-neutral-500">
                Email our sales and support team for anything and we&apos;ll
                respond within 24 hours.
              </p>
              <span className="mt-3 inline-block text-sm font-medium text-emerald-700">
                Send an email →
              </span>
            </a>
            <a
              href="https://calendly.com/getyn/30min"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-neutral-200 bg-white p-6 text-left transition hover:border-emerald-400 hover:shadow-sm"
            >
              <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <Sparkles className="size-5" />
              </div>
              <p className="font-semibold text-neutral-900">Book a personalized demo</p>
              <p className="mt-1 text-xs text-neutral-500">
                Need additional help or consultation? Schedule a call with our
                product specialist.
              </p>
              <span className="mt-3 inline-block text-sm font-medium text-emerald-700">
                Schedule demo call →
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

type Tone = 'mint' | 'teal' | 'amber' | 'violet';

const TONES: Record<
  Tone,
  { bg: string; icon: string; value: string; border: string }
> = {
  mint: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
    icon: 'bg-emerald-500/15 text-emerald-700',
    value: 'text-emerald-900',
  },
  teal: {
    bg: 'bg-teal-50',
    border: 'border-teal-100',
    icon: 'bg-teal-500/15 text-teal-700',
    value: 'text-teal-900',
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    icon: 'bg-amber-500/15 text-amber-700',
    value: 'text-amber-900',
  },
  violet: {
    bg: 'bg-violet-50',
    border: 'border-violet-100',
    icon: 'bg-violet-500/15 text-violet-700',
    value: 'text-violet-900',
  },
};

function QuotaTile({
  icon: Icon,
  label,
  value,
  unit,
  tone,
  comingSoon,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  unit: string;
  tone: Tone;
  comingSoon?: boolean;
}): JSX.Element {
  const t = TONES[tone];
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border ${t.border} ${t.bg} p-3`}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-md ${t.icon}`}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-600">
          {label}
        </p>
        <p className="mt-0.5 flex items-baseline gap-1">
          <span
            className={`text-lg font-bold tabular-nums ${t.value}`}
          >
            {comingSoon ? '—' : value.toLocaleString()}
          </span>
          {!comingSoon && (
            <span className="text-[11px] text-neutral-500">{unit}</span>
          )}
          {comingSoon && (
            <span className="text-[10px] font-medium text-neutral-500">
              coming soon
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function ExtrasSlider({
  label,
  unit,
  value,
  onChange,
  max,
  pricePer100Cents,
  currency,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (n: number) => void;
  max: number;
  pricePer100Cents: number;
  currency: string;
}): JSX.Element {
  const extra = value * 100;
  const extraCost = value * pricePer100Cents;
  return (
    <div className="space-y-1.5 rounded-md border border-neutral-100 bg-neutral-50/60 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-800">{label}</span>
        <span className="text-[11px] tabular-nums text-neutral-500">
          +{extra.toLocaleString()} {unit}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-600"
      />
      <div className="flex items-baseline justify-between text-[10px] text-neutral-500">
        <span>${(pricePer100Cents / 100).toFixed(2)} / 100</span>
        <span className="font-mono text-emerald-700">
          {extraCost === 0 ? '—' : `+${fmtMoney(extraCost, currency)}/mo`}
        </span>
      </div>
    </div>
  );
}
