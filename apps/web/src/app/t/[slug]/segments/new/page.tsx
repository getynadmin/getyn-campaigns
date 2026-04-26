import { notFound, redirect } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { emptyRules } from '@/components/segments/empty-rules';
import { SegmentEditor } from '@/components/segments/segment-editor';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'New segment' };

/**
 * Create a new segment. We gate the route server-side to EDITOR+ so a VIEWER
 * can't even land on the form — matches the tRPC `enforceRole` on
 * `segments.create`.
 */
export default async function NewSegmentPage({
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

  const canCreate =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;
  if (!canCreate) redirect(`/t/${params.slug}/segments`);

  return (
    <SegmentEditor
      tenantSlug={params.slug}
      mode={{ kind: 'create' }}
      initialRules={emptyRules()}
    />
  );
}
