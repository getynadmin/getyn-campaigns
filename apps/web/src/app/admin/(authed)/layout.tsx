import { notFound } from 'next/navigation';

import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { AdminTrpcProvider } from '@/components/providers/admin-trpc-provider';
import { resolveStaffSession } from '@/server/admin/staff-session';

/**
 * Admin layout + gate.
 *
 * Wraps every /admin/* page. If there's no staff session we 404
 * (NOT 401/403) so the surface's existence isn't leaked to
 * unauthenticated probes. The /admin/login page renders without
 * this layout via its own page-level branch.
 *
 * Sidebar (Phase 5.6 M1) is a grouped client component — it needs
 * usePathname() to highlight the active item and auto-open the
 * containing group.
 */

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const staff = await resolveStaffSession();
  if (!staff) {
    notFound();
  }

  return (
    <div className="flex min-h-dvh bg-muted/20">
      <AdminSidebar staffEmail={staff.staffEmail} staffRole={staff.role} />
      <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-10 lg:py-8">
        <AdminTrpcProvider>{children}</AdminTrpcProvider>
      </main>
    </div>
  );
}
