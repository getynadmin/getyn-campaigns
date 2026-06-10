import { ThemesSettingsClient } from '@/components/settings/themes-settings-client';

export const metadata = { title: 'Themes' };

/**
 * Phase 5.8 — per-user theme preferences (app + sidebar).
 *
 * Choices are stored in the browser's localStorage so each member of
 * the workspace can pick independently without a DB write. No
 * server data needed; the page is a thin shell.
 */
export default function ThemesSettingsPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Themes
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Switch the whole app or just the sidebar between light and dark.
          Saved per device on this browser.
        </p>
      </div>
      <ThemesSettingsClient />
    </div>
  );
}
