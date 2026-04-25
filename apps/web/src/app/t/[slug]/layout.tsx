import { notFound, redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell/app-shell';
import { Providers } from '@/components/providers/providers';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@getyn/db';

/**
 * Tenant-scoped layout. This is the authoritative membership check —
 * middleware only verifies auth, not tenant access.
 *
 * We 404 (not 403) on missing membership so the existence of a tenant
 * slug can't be probed by strangers.
 *
 * All child pages run inside a `<Providers tenantSlug=...>` tree so
 * tRPC requests automatically carry the `x-tenant-slug` header.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/t/${params.slug}`)}`);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
  });
  if (!tenant) notFound();

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { tenant: true },
    orderBy: { createdAt: 'asc' },
  });
  const tenants = memberships.map((m) => ({
    id: m.tenant.id,
    name: m.tenant.name,
    slug: m.tenant.slug,
  }));

  return (
    <Providers tenantSlug={params.slug}>
      <AppShell
        currentSlug={params.slug}
        tenants={tenants}
        user={{
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
        }}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
