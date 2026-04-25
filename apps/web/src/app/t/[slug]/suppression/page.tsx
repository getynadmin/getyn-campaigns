import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { NewSuppressionDialog } from '@/components/suppression/new-suppression-dialog';
import { SuppressionList } from '@/components/suppression/suppression-list';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Suppression list' };

/**
 * Tenant-scoped suppression list. Browse is open to all members; the "Add"
 * button + per-row delete are gated to OWNER/ADMIN (mirrors the tRPC
 * `enforceRole`).
 */
export default async function SuppressionPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { slug: params.slug } });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();

  const canManage =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Suppression list
          </h1>
          <p className="text-sm text-muted-foreground">
            Addresses we won't send to — even if they're in a segment. Updated
            automatically when contacts unsubscribe, bounce, or complain.
          </p>
        </div>
        {canManage ? <NewSuppressionDialog /> : null}
      </div>
      <SuppressionList currentRole={membership.role} />
    </div>
  );
}
