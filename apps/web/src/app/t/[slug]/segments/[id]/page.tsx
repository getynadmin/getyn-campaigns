import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { SegmentDetail } from '@/components/segments/segment-detail';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Segment' };

export default async function SegmentDetailPage({
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
    <SegmentDetail
      tenantSlug={params.slug}
      segmentId={params.id}
      currentRole={membership.role}
    />
  );
}
