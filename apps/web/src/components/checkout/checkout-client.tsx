'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/trpc';

interface PricingConfig {
  basePriceCents: number;
  baseIncludedMessages: number;
  blockSize: number;
  pricePerBlockCents: number;
  annualDiscountPercent: number;
  minMessages: number;
  maxMessages: number;
  currency: string;
}

export interface CheckoutInitial {
  planSlug: string;
  planName: string;
  config: PricingConfig;
  volume: number;
  cycle: 'monthly' | 'annual';
  errorFromReturn: string | null;
}

function fmtMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency,
  });
}

function calc(volume: number, cfg: PricingConfig, cycle: 'monthly' | 'annual') {
  const extra = Math.max(0, volume - cfg.baseIncludedMessages);
  const blocks = extra > 0 ? Math.ceil(extra / cfg.blockSize) : 0;
  const monthly = cfg.basePriceCents + blocks * cfg.pricePerBlockCents;
  const yearly = Math.round(
    monthly * 12 * (1 - cfg.annualDiscountPercent / 100),
  );
  return cycle === 'monthly' ? monthly : yearly;
}

export function CheckoutClient({ initial }: { initial: CheckoutInitial }): JSX.Element {
  const [step, setStep] = useState<1 | 2>(initial.errorFromReturn ? 2 : 1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [paymentTab, setPaymentTab] = useState<'card' | 'paypal'>('card');
  const [returnError] = useState<string | null>(initial.errorFromReturn);

  const amount = useMemo(
    () => calc(initial.volume, initial.config, initial.cycle),
    [initial.volume, initial.config, initial.cycle],
  );

  const start = api.checkout.startOrder.useMutation({
    onSuccess: (res) => {
      if (res.previewMode) {
        toast.warning(res.message ?? 'XPay is not configured — preview mode.');
        return;
      }
      if (res.fwdUrl) {
        // Full redirect to XPay hosted checkout. On completion XPay
        // returns to /api/payments/xpay/return which flips the order
        // to PAID after server-side verification.
        window.location.href = res.fwdUrl;
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const goToPayment = () => {
    if (!firstName.trim()) {
      toast.error('Enter your first name.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error('Enter a valid email.');
      return;
    }
    if (!/^\+[1-9]\d{6,14}$/.test(phone.trim())) {
      toast.error('Phone must be in international format, e.g. +14155551234');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    setStep(2);
  };

  const submitPayment = () => {
    if (paymentTab === 'paypal') {
      toast.error('PayPal support is coming in Phase 2. Please pay by card.');
      return;
    }
    start.mutate({
      planSlug: initial.planSlug,
      volume: initial.volume,
      billingCycle: initial.cycle,
      customer: {
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        contactNumber: phone.trim(),
      },
    });
  };

  return (
    <div className="min-h-dvh bg-muted/30">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs text-background">
              G
            </span>
            Getyn <span className="text-muted-foreground">Campaigns</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" /> SECURE CHECKOUT
          </div>
        </div>
      </header>

      {/* Stepper */}
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Stepper current={step} />

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            {step === 1 && (
              <AccountStep
                firstName={firstName}
                lastName={lastName}
                email={email}
                phone={phone}
                password={password}
                onFirstName={setFirstName}
                onLastName={setLastName}
                onEmail={setEmail}
                onPhone={setPhone}
                onPassword={setPassword}
                onContinue={goToPayment}
              />
            )}

            {step === 2 && (
              <PaymentStep
                paymentTab={paymentTab}
                onTab={setPaymentTab}
                onBack={() => setStep(1)}
                onSubmit={submitPayment}
                submitting={start.isPending}
                returnError={returnError}
                amountLabel={fmtMoney(amount, initial.config.currency)}
              />
            )}
          </div>

          <OrderSummary
            planName={initial.planName}
            volume={initial.volume}
            cycle={initial.cycle}
            amountCents={amount}
            currency={initial.config.currency}
          />
        </div>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 }): JSX.Element {
  const steps: Array<{ n: 1 | 2 | 3; label: string }> = [
    { n: 1, label: 'Account' },
    { n: 2, label: 'Payment' },
    { n: 3, label: 'Confirmation' },
  ];
  return (
    <div className="flex items-center justify-center gap-3">
      {steps.map((s, i) => {
        const active = current === s.n;
        const done = current > s.n;
        return (
          <div key={s.n} className="flex items-center gap-2">
            <span
              className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {s.n}
            </span>
            <span
              className={`text-sm ${
                active ? 'font-medium' : 'text-muted-foreground'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="mx-2 h-px w-10 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function AccountStep(props: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  onFirstName: (v: string) => void;
  onLastName: (v: string) => void;
  onEmail: (v: string) => void;
  onPhone: (v: string) => void;
  onPassword: (v: string) => void;
  onContinue: () => void;
}): JSX.Element {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Create your account</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Get started with your subscription
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">First name</Label>
          <Input
            value={props.firstName}
            onChange={(e) => props.onFirstName(e.target.value)}
            placeholder="Alex"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Last name</Label>
          <Input
            value={props.lastName}
            onChange={(e) => props.onLastName(e.target.value)}
            placeholder="Rivera"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Email</Label>
          <Input
            type="email"
            value={props.email}
            onChange={(e) => props.onEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Phone (international format)</Label>
          <Input
            type="tel"
            value={props.phone}
            onChange={(e) => props.onPhone(e.target.value)}
            placeholder="+14155551234"
          />
          <p className="text-[10px] text-muted-foreground">
            Include the country code. Required by our payment provider.
          </p>
        </div>
        <div className="col-span-2 space-y-1">
          <Label className="text-xs">Password</Label>
          <Input
            type="password"
            value={props.password}
            onChange={(e) => props.onPassword(e.target.value)}
            placeholder="Min. 6 characters"
          />
        </div>
      </div>
      <Button className="mt-6 w-full" size="lg" onClick={props.onContinue}>
        Continue to payment <ArrowRight className="ml-1 size-4" />
      </Button>
    </section>
  );
}

function PaymentStep(props: {
  paymentTab: 'card' | 'paypal';
  onTab: (t: 'card' | 'paypal') => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  returnError: string | null;
  amountLabel: string;
}): JSX.Element {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Payment method</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            You&apos;ll be redirected to our secure payment provider.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-3.5" /> Secure payment
        </span>
      </div>

      {props.returnError && (
        <div className="mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertCircle className="size-4 shrink-0" />
          <div>
            <p className="font-medium">Payment was not completed</p>
            <p className="text-xs opacity-80">
              {props.returnError.replaceAll('_', ' ')}. Please try again.
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button
          onClick={() => props.onTab('card')}
          className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
            props.paymentTab === 'card'
              ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
              : 'bg-background text-muted-foreground'
          }`}
        >
          <CreditCard className="size-4" /> Card
        </button>
        <button
          onClick={() => props.onTab('paypal')}
          className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
            props.paymentTab === 'paypal'
              ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
              : 'bg-background text-muted-foreground'
          }`}
        >
          PayPal <span className="text-[10px] uppercase text-muted-foreground">Soon</span>
        </button>
      </div>

      <div className="mt-5 rounded-md border bg-muted/30 p-4 text-sm">
        <p className="mb-1 font-medium">Continue on our secure gateway</p>
        <p className="text-xs text-muted-foreground">
          Clicking below sends you to XPay Checkout to enter your card
          details. You&apos;ll come back here automatically once the
          payment succeeds.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Button variant="ghost" onClick={props.onBack}>
          Back
        </Button>
        <Button
          onClick={props.onSubmit}
          disabled={props.submitting}
          className="ml-auto"
          size="lg"
        >
          {props.submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> Redirecting…
            </>
          ) : (
            <>
              Complete payment — {props.amountLabel}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

function OrderSummary(props: {
  planName: string;
  volume: number;
  cycle: 'monthly' | 'annual';
  amountCents: number;
  currency: string;
}): JSX.Element {
  return (
    <aside className="h-fit rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Order summary
      </h3>
      <div className="mt-4 flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CreditCard className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{props.planName}</p>
          <p className="text-xs text-muted-foreground">
            {props.volume.toLocaleString()} messages /{' '}
            {props.cycle === 'monthly' ? 'month' : 'year'}
          </p>
        </div>
        <div className="text-right text-sm font-medium">
          {(props.amountCents / 100).toLocaleString(undefined, {
            style: 'currency',
            currency: props.currency,
          })}
        </div>
      </div>

      <dl className="mt-5 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd>
            {(props.amountCents / 100).toLocaleString(undefined, {
              style: 'currency',
              currency: props.currency,
            })}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Estimated tax</dt>
          <dd>—</dd>
        </div>
      </dl>

      <div className="mt-4 flex items-baseline justify-between border-t pt-4">
        <span className="text-sm font-semibold">Total</span>
        <span className="text-xl font-bold text-primary">
          {(props.amountCents / 100).toLocaleString(undefined, {
            style: 'currency',
            currency: props.currency,
          })}
        </span>
      </div>

      <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span> 30-day money-back guarantee
        </li>
        <li className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span> Cancel anytime
        </li>
        <li className="flex items-center gap-2">
          <span className="text-emerald-600">✓</span> Unlimited features on your plan
        </li>
      </ul>
    </aside>
  );
}
