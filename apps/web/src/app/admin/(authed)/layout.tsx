import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowUpCircle,
  ClipboardList,
  Database,
  KeyRound,
  Layers,
  LayoutDashboard,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { AdminTrpcProvider } from '@/components/providers/admin-trpc-provider';
import { resolveStaffSession } from '@/server/admin/staff-session';

/**
 * Phase 5 M7 — admin layout + gate.
 *
 * Wrapping every /admin/* page. If there's no staff session we 404
 * (NOT 401/403) so the surface's existence isn't leaked to
 * unauthenticated probes. The /admin/login page is the only
 * exception — its layout opts out by checking pathname.
 *
 * Sidebar nav stays static and read-from-code; tenants list is
 * the primary surface so it leads.
 */

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin/tenants', label: 'Tenants', icon: Database },
  { href: '/admin/plans', label: 'Plans', icon: Layers },
  { href: '/admin/upgrade-requests', label: 'Upgrade requests', icon: ArrowUpCircle },
  { href: '/admin/audit-log', label: 'Audit log', icon: ScrollText },
  { href: '/admin/webhook-log', label: 'Webhooks', icon: ClipboardList },
  { href: '/admin/queues', label: 'Queues', icon: Server },
  { href: '/admin/staff', label: 'Staff', icon: Users },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const staff = await resolveStaffSession();
  if (!staff) {
    // /admin/login renders without this layout — Next.js group
    // routes would be the canonical fix; here we use notFound() as
    // a tighter gate. The login route has its own page-level branch.
    notFound();
  }

  return (
    <div className="flex min-h-dvh bg-muted/20">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r bg-card px-3 py-5 md:flex">
        <Link
          href="/admin"
          className="mb-6 flex items-center gap-2 px-3 py-2"
        >
          <span className="grid size-7 place-items-center rounded-md bg-rose-600 text-sm font-bold text-white">
            S
          </span>
          <span className="font-display text-base font-semibold">
            Staff
          </span>
        </Link>
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <Icon className="size-4" />
              {n.label}
            </Link>
          );
        })}
        <div className="mt-auto rounded-md border bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
          <p className="flex items-center gap-1">
            <ShieldCheck className="size-3" />
            {staff.staffEmail}
          </p>
          <p className="mt-0.5 capitalize">{staff.role.toLowerCase().replace('_', ' ')}</p>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-10 lg:py-8">
        <AdminTrpcProvider>{children}</AdminTrpcProvider>
      </main>
    </div>
  );
}

void LayoutDashboard;
void KeyRound;
