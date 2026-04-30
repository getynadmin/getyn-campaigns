import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { WhatsAppTemplateEditor } from '@/components/whatsapp-templates/whatsapp-template-editor';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'New WhatsApp template' };

export default async function NewWhatsAppTemplatePage({
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
  // EDITOR can author; VIEWER cannot.
  if (membership.role === Role.VIEWER) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          New WhatsApp template
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Save as draft to keep iterating, or submit to Meta for review.
          Approval typically takes minutes; rejection comes back with a
          reason you can act on.
        </p>
      </div>

      <WhatsAppTemplateEditor tenantSlug={params.slug} mode="create" />
    </div>
  );
}
