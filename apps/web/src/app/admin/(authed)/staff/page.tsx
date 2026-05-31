import { redirect } from 'next/navigation';

/**
 * Phase 5.6 M1 — backward-compat: /admin/staff → /admin/settings/staff.
 */
export default function AdminStaffLegacyRedirect(): never {
  redirect('/admin/settings/staff');
}
