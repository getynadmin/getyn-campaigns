import { notFound } from 'next/navigation';
import { Role, prisma } from '@getyn/db';

import { CustomFieldsTable } from '@/components/settings/custom-fields-table';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Custom fields' };

export default async function CustomFieldsSettingsPage({
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
    <section>
      <div className="mb-4">
        <h2 className="font-display text-lg font-semibold">Custom fields</h2>
        <p className="text-sm text-muted-foreground">
          Extra attributes you want to attach to contacts — like plan tier,
          lifetime value, or preferred language.
        </p>
      </div>
      <CustomFieldsTable canManage={canManage} />
    </section>
  );
}
