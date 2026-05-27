import { redirect } from 'next/navigation';

/**
 * Phase 5 M7 — /admin lands on /admin/tenants.
 *
 * Splitting an index page from a dashboard buys us nothing yet;
 * the tenants list IS the dashboard for support engineers.
 */
export default function AdminIndexPage(): never {
  redirect('/admin/tenants');
}
