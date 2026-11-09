import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { SmsChannelClient } from '@/components/sms-channel/sms-channel-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'SMS channel' };

export default async function SmsChannelPage({
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
  const canManage =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          SMS
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Twilio-backed transactional + marketing SMS. Buy real phone
          numbers for a given country, or register a brand name as an
          alphanumeric sender ID.
        </p>
      </div>
      <SmsChannelClient canManage={canManage} tenantSlug={params.slug} />
    </div>
  );
}
