import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Upload } from 'lucide-react';
import { Role, prisma } from '@getyn/db';

import { ContactList } from '@/components/contacts/contact-list';
import { NewContactDialog } from '@/components/contacts/new-contact-dialog';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Contacts' };

/**
 * Tenant-scoped contacts list. This page intentionally resolves the
 * caller's role server-side so the NewContactDialog trigger is only
 * rendered for EDITORs and above — matches the server's enforceRole.
 */
export default async function ContactsPage({
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Contacts
          </h1>
          <p className="text-sm text-muted-foreground">
            Every person you can market to in {tenant.name}.
          </p>
        </div>
        {canCreate ? (
          <div className="flex gap-2">
            <Link href={`/t/${params.slug}/contacts/import`}>
              <Button variant="outline">
                <Upload className="mr-2 size-4" />
                Import
              </Button>
            </Link>
            <NewContactDialog />
          </div>
        ) : null}
      </div>
      <ContactList tenantSlug={params.slug} currentRole={membership.role} />
    </div>
  );
}
