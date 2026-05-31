import { SiteSettingsClient } from '@/components/admin/site-settings-client';

export const metadata = { title: 'Site Settings · Staff' };

export default function AdminSiteSettingsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Site Settings</h1>
        <p className="text-sm text-muted-foreground">
          Branding, appearance, and advanced overrides. Changes apply
          app-wide; tenants see the customer surfaces with these values.
        </p>
      </header>
      <SiteSettingsClient />
    </div>
  );
}
