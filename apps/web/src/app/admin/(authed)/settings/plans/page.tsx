import { AdminAppSettingsClient } from '@/components/admin/app-settings-client';

export const metadata = { title: 'Settings · Staff' };

/**
 * Phase 5.5 M2 — global Campaigns settings.
 *
 * Singleton AppSettings row. Read access for all staff; mutations gated
 * to SUPPORT_ADMIN at the tRPC layer.
 */
export default function AdminSettingsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Global behavior — default plan for new signups, upgrade-request
          intake, etc.
        </p>
      </header>
      <AdminAppSettingsClient />
    </div>
  );
}
