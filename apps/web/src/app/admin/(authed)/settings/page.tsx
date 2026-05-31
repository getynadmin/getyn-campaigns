import { redirect } from 'next/navigation';

/**
 * Phase 5.6 M1 — backward-compat: /admin/settings → /admin/settings/plans.
 * The Phase 5.5 AppSettings page now lives under the Settings group.
 */
export default function AdminSettingsIndex(): never {
  redirect('/admin/settings/plans');
}
