import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { WhatsAppTemplateEditor } from '@/components/whatsapp-templates/whatsapp-template-editor';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Edit WhatsApp template' };

export default async function EditWhatsAppTemplatePage({
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
  if (membership.role === Role.VIEWER) notFound();

  // Pre-fetch the template so the editor renders without a loading flash.
  // tRPC client refetches client-side too, but the SSR pass keeps the
  // form populated through the initial render.
  const template = await prisma.whatsAppTemplate.findFirst({
    where: { id: params.id, tenantId: tenant.id, deletedAt: null },
  });
  if (!template) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Edit template
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {template.status === 'DRAFT' ? (
            <>
              Editing the draft — save changes or submit to Meta when
              ready.
            </>
          ) : (
            <>
              Meta does not allow editing of submitted templates. Use
              <strong> Duplicate as draft </strong>
              to create a new editable version.
            </>
          )}
        </p>
      </div>

      <WhatsAppTemplateEditor
        tenantSlug={params.slug}
        mode="edit"
        templateId={params.id}
        initialStatus={template.status}
      />
    </div>
  );
}
