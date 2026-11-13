import { MarketingPanel } from '@/components/admin/marketing/marketing-panel';

export const metadata = { title: 'Cart Recovery · Marketing' };
export const dynamic = 'force-dynamic';

export default function AdminMarketingCartRecoveryPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Cart Recovery</h1>
        <p className="text-sm text-muted-foreground">
          Chase abandoned checkouts (plans picked but never paid). The chaser
          runs stage-based — one reminder per order per window — and
          auto-suppresses when the email converts.
        </p>
      </header>
      <MarketingPanel kind="cart" />
    </div>
  );
}
