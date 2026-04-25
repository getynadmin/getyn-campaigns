import { notFound } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { prisma } from '@getyn/db';
import { TRIAL_DAYS } from '@/lib/constants';

export const metadata = { title: 'Billing' };

export default async function BillingSettingsPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
  });
  if (!tenant) notFound();

  const daysLeft = tenant.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (tenant.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        ),
      )
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>
          Payment and plan management lands in the next phase.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Tile label="Plan" value={tenant.plan} />
          <Tile label="Status" value={tenant.billingStatus.replace('_', ' ')} />
          <Tile
            label="Trial"
            value={
              daysLeft !== null
                ? `${daysLeft} of ${TRIAL_DAYS} days left`
                : 'No trial'
            }
          />
        </div>
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Stripe checkout, invoices, and plan changes arrive in Phase 3.
        </p>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-lg font-semibold capitalize">{value.toLowerCase()}</p>
    </div>
  );
}
