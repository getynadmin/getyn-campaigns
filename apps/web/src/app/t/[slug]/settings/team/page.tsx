import { ExternalLink, Users } from 'lucide-react';
import { notFound } from 'next/navigation';

import { ProvisioningSource, Role, prisma } from '@getyn/db';

import { InviteDialog } from '@/components/settings/invite-dialog';
import { PendingInvites } from '@/components/settings/pending-invites';
import { TeamTable } from '@/components/settings/team-table';
import { Button } from '@/components/ui/button';
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
  // Phase 5 M5 — SSO-provisioned tenants delegate team management to G-Suite.
  const isManagedByGSuite =
    tenant.provisioningSource === ProvisioningSource.G_SUITE;
  const gSuiteBaseUrl = process.env.GSUITE_BASE_URL ?? 'https://getyn.com';

  return (
    <div className="space-y-8">
      {isManagedByGSuite && (
        <section className="rounded-lg border bg-card p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">
              <Users className="size-4" />
            </span>
            <div className="flex-1">
              <h3 className="text-sm font-semibold">
                Team is managed in G-Suite
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Members and roles for this workspace come from G-Suite.
                Add or remove people there; changes apply on their next
                sign-in to Campaigns.
              </p>
              <div className="mt-3">
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`${gSuiteBaseUrl}/team?tenant=${encodeURIComponent(tenant.gSuiteTenantId ?? '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="mr-2 size-3.5" />
                    Open G-Suite team settings
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Members</h2>
            <p className="text-sm text-muted-foreground">
              Everyone with access to {tenant.name}.
            </p>
          </div>
          {/* InviteDialog hidden under SSO — the G-Suite card above
              already directs the user to the right place. */}
          {canManage && !isManagedByGSuite ? (
            <InviteDialog tenantSlug={params.slug} />
          ) : null}
        </div>
        <TeamTable
          currentUserId={user.id}
          currentRole={membership.role}
          canEditMembers={!isManagedByGSuite}
        />
      </section>

      {!isManagedByGSuite && (
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
      )}
    </div>
  );
}
