import { notFound, redirect } from 'next/navigation';

import { Role, prisma } from '@getyn/db';
import { segmentRulesSchema } from '@getyn/types';

import { SegmentEditor } from '@/components/segments/segment-editor';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Edit segment' };

/**
 * Edit an existing segment. We fetch the Segment row server-side and
 * re-parse its rules with `segmentRulesSchema` before handing it to the
 * client. If the stored JSON drifted out of shape somehow (manual DB edit,
 * older migration), we surface a 404 rather than crashing the builder.
 */
export default async function EditSegmentPage({
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

  const canEdit =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;
  if (!canEdit) redirect(`/t/${params.slug}/segments/${params.id}`);

  const segment = await prisma.segment.findFirst({
    where: { id: params.id, tenantId: tenant.id },
  });
  if (!segment) notFound();

  const parsed = segmentRulesSchema.safeParse(segment.rules);
  if (!parsed.success) notFound();

  return (
    <SegmentEditor
      tenantSlug={params.slug}
      mode={{ kind: 'update', segmentId: segment.id }}
      initialName={segment.name}
      initialDescription={segment.description ?? ''}
      initialRules={parsed.data}
    />
  );
}
