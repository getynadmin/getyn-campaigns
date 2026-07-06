import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { EmailInboxClient } from '@/components/email-inbox/email-inbox-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Email inbox' };

/**
 * /t/[slug]/email-inbox — Phase 8 M1.
 *
 * Diagnostic view of every InboundEmail row for this tenant. Shows
 * routing outcome (campaign / agent / automation / unmatched) with
 * a drill-in for the raw payload. Not the Email Agent's approval
 * inbox (that lands in M5).
 */
export default async function EmailInboxPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
    select: { id: true },
  });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();
  return <EmailInboxClient />;
}
