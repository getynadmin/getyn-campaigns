import { notFound } from 'next/navigation';
import { Role } from '@getyn/db';

import { WorkspaceSettingsForm } from '@/components/settings/workspace-settings-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { prisma } from '@getyn/db';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Workspace settings' };

export default async function WorkspaceSettingsPage({
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

  const canEdit = membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          Change how your workspace shows up across the product.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <WorkspaceSettingsForm
          defaults={{ name: tenant.name, slug: tenant.slug }}
          canEdit={canEdit}
        />
      </CardContent>
    </Card>
  );
}
