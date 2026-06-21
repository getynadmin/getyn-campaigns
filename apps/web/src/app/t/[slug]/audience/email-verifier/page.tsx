import { notFound } from 'next/navigation';
import { Role, prisma } from '@getyn/db';

import { EmailVerifierClient } from '@/components/audience/email-verifier-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Email Verifier' };

export default async function EmailVerifierPage({
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
    select: { role: true },
  });
  if (!membership) notFound();

  const canCleanup =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Email Verifier
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan your contact list for obviously-bad addresses — typos,
          disposable domains, role inboxes, and ones that have hard-bounced
          before. Mark them as unsubscribed in bulk to protect your sending
          reputation.
        </p>
      </header>
      <EmailVerifierClient canCleanup={canCleanup} />
    </div>
  );
}
