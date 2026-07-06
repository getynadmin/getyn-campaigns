import { CreateTenantDialog } from '@/components/admin/create-tenant-dialog';
import { AdminTenantsClient } from '@/components/admin/tenants-client';

export const metadata = { title: 'Tenants · Staff' };

export default function AdminTenantsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Every Campaigns workspace. Click into one to see channel health,
            subscription status, and emergency actions.
          </p>
        </div>
        <CreateTenantDialog />
      </header>
      <AdminTenantsClient />
    </div>
  );
}
