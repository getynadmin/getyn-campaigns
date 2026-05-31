export const metadata = { title: 'Site Settings · Staff' };

export default function AdminSiteSettingsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Site Settings</h1>
        <p className="text-sm text-muted-foreground">
          Coming in Phase 5.6 M5 — branding, appearance, advanced overrides.
        </p>
      </header>
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Branding controls land in M5.
      </div>
    </div>
  );
}
