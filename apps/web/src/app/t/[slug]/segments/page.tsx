import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Role, prisma } from '@getyn/db';

import { SegmentList } from '@/components/segments/segment-list';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Segments' };

/**
 * Tenant-scoped segments list. Role check mirrors `contacts/page.tsx`:
 * the "New segment" button is gated to EDITOR and above server-side, which
 * matches the server's enforceRole on `segments.create`.
 */
export default async function SegmentsPage({
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
            Segments
          </h1>
          <p className="text-sm text-muted-foreground">
            Saved contact filters you can target in campaigns.
          </p>
        </div>
        {canCreate ? (
          <Link href={`/t/${params.slug}/segments/new`}>
            <Button>
              <Plus className="mr-2 size-4" />
              New segment
            </Button>
          </Link>
        ) : null}
      </div>
      <SegmentList tenantSlug={params.slug} />
    </div>
  );
}
