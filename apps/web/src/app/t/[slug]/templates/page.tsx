import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { TemplatesLibraryClient } from '@/components/email-builder/templates-library-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Email templates' };

/**
 * /t/[slug]/templates — the email-template library.
 *
 * The grid mixes system templates (read-only, tenantId NULL) with this
 * tenant's own templates. Server component resolves auth/membership;
 * the actual list + filtering lives in the client to keep the page
 * snappy under search.
 */
export default async function TemplatesPage({
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

  const canCreate =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;
  const canDelete =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Email templates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pre-built starts for common email shapes. Pick one, edit it,
            and use it in a campaign — your edits become a tenant-owned
            template you can reuse.
          </p>
        </div>
      </div>
      <TemplatesLibraryClient
        tenantSlug={params.slug}
        canCreate={canCreate}
        canDelete={canDelete}
      />
    </div>
  );
}
