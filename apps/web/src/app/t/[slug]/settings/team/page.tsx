import { notFound } from 'next/navigation';
import { Role } from '@getyn/db';

import { InviteDialog } from '@/components/settings/invite-dialog';
import { PendingInvites } from '@/components/settings/pending-invites';
import { TeamTable } from '@/components/settings/team-table';
import { prisma } from '@getyn/db';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Team' };

export default async function TeamSettingsPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
  });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();

  const canManage = membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Members</h2>
            <p className="text-sm text-muted-foreground">
              Everyone with access to {tenant.name}.
            </p>
          </div>
          {canManage ? <InviteDialog tenantSlug={params.slug} /> : null}
        </div>
        <TeamTable currentUserId={user.id} currentRole={membership.role} />
      </section>
      <section>
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold">
            Pending invitations
          </h2>
          <p className="text-sm text-muted-foreground">
            Links expire 7 days after they&apos;re sent.
          </p>
        </div>
        <PendingInvites canManage={canManage} />
      </section>
    </div>
  );
}
