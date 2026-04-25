import { notFound } from 'next/navigation';
import { prisma } from '@getyn/db';

import { ContactDetail } from '@/components/contacts/contact-detail';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Contact' };

export default async function ContactDetailPage({
  params,
}: {
  params: { slug: string; id: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { slug: params.slug } });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();

  return (
    <ContactDetail
      tenantSlug={params.slug}
      contactId={params.id}
      currentRole={membership.role}
    />
  );
}
