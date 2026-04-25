import { notFound } from 'next/navigation';
import { Role, prisma } from '@getyn/db';

import { ImportWizard } from '@/components/contacts/import-wizard';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Import contacts' };

/**
 * Entry point for the CSV import wizard. EDITORs and above can import —
 * matches the `enforceRole` on `imports.requestUpload` and `imports.start`.
 */
export default async function ImportContactsPage({
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

  const canImport =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;
  if (!canImport) notFound();

  return <ImportWizard tenantSlug={params.slug} />;
}
