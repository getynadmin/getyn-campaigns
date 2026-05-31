import { AdminPlansClient } from '@/components/admin/plans-client';

export const metadata = { title: 'Plans · Staff' };

/**
 * Phase 5.5 M2 — admin plan management.
 *
 * Read access for all staff; create/edit/archive/setDefault gated to
 * SUPPORT_ADMIN at the tRPC layer. The page is intentionally a thin
 * shell — the client component handles the table + edit dialog.
 */
export default function AdminPlansPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Tier definitions and per-metric limits. Tenants get assigned to a
          plan via{' '}
          <code className="rounded bg-muted px-1 text-xs">/admin/tenants</code>
          . Plan deletion is intentionally not exposed — archive instead.
        </p>
      </header>
      <AdminPlansClient />
    </div>
  );
}
