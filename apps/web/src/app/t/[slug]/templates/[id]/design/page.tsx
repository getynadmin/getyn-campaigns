import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { TemplateDesignClient } from '@/components/email-builder/template-design-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Design template' };

/**
 * Template design page — hosts the Unlayer editor for a single
 * EmailTemplate. The editor takes the entire viewport below the topbar.
 *
 * Server component: resolves user/tenant/membership/template, then hands
 * a tight payload to the client. Permission is OWNER/ADMIN/EDITOR for
 * tenant-owned templates; system templates are not editable from here
 * (the client surfaces a banner + Save button is hidden).
 */
export default async function TemplateDesignPage({
  params,
}: {
  params: { slug: string; id: string };
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

  // System templates (tenantId NULL) are visible to every tenant; tenant-
  // owned templates only to their owner. We fetch with that OR clause.
  const template = await prisma.emailTemplate.findFirst({
    where: {
      id: params.id,
      OR: [{ tenantId: null }, { tenantId: tenant.id }],
    },
  });
  if (!template) notFound();

  const isSystemTemplate = template.tenantId === null;
  const canEdit =
    !isSystemTemplate &&
    (membership.role === Role.OWNER ||
      membership.role === Role.ADMIN ||
      membership.role === Role.EDITOR);

  return (
    <TemplateDesignClient
      template={{
        id: template.id,
        name: template.name,
        description: template.description,
        designJson: template.designJson as Record<string, unknown>,
        isSystemTemplate,
      }}
      tenantSlug={params.slug}
      canEdit={canEdit}
    />
  );
}
