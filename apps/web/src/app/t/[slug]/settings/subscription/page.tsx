import { SubscriptionClient } from '@/components/subscription/subscription-client';

export const metadata = { title: 'Subscription' };

/**
 * Phase 5.5 M5 — tenant subscription page.
 *
 * Shows: current plan, status, period info, per-metric limits + usage
 * with progress bars, all eligible plans, and the upgrade-request CTA.
 *
 * Everything fetched through the new `subscription.get` tRPC query —
 * no server-side data plumbing here.
 */
export default function SubscriptionPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Subscription
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your plan, this month&apos;s usage, and how to move up. Limits
          reset on the 1st of each month (UTC).
        </p>
      </div>
      <SubscriptionClient />
    </div>
  );
}
