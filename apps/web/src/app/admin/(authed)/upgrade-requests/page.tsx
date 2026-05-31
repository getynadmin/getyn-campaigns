import { AdminUpgradeRequestsClient } from '@/components/admin/upgrade-requests-client';

export const metadata = { title: 'Upgrade requests · Staff' };

export default function AdminUpgradeRequestsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Upgrade requests</h1>
        <p className="text-sm text-muted-foreground">
          Tenant-submitted plan changes. Approve to (optionally) re-assign
          their subscription in one step; reject with a note for the audit
          log.
        </p>
      </header>
      <AdminUpgradeRequestsClient />
    </div>
  );
}
