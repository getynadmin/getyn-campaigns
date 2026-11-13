import { MarketingPanel } from '@/components/admin/marketing/marketing-panel';

export const metadata = { title: 'Retargeting · Marketing' };
export const dynamic = 'force-dynamic';

export default function AdminMarketingRetargetingPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Retargeting</h1>
        <p className="text-sm text-muted-foreground">
          Win back signed-in users who've gone dormant. Each user receives the
          one reminder matching their current inactivity window — delivered
          via Resend on a 10-minute cron.
        </p>
      </header>
      <MarketingPanel kind="retargeting" />
    </div>
  );
}
