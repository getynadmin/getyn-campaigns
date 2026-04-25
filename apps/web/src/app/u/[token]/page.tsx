/* eslint-disable no-console */
import {
  Channel,
  ContactEventType,
  SubscriptionStatus,
  SuppressionReason,
  emitContactEvent,
  prisma,
  upsertSuppressionEntry,
  verifyEmailToken,
  withTenant,
} from '@getyn/db';

export const metadata = {
  title: 'Unsubscribe',
  // Hide from indexers — recipient bearer URLs shouldn't show up in
  // search results.
  robots: { index: false, follow: false },
};

/**
 * `/u/{token}` — unsubscribe confirmation page.
 *
 * Server component: verifies the token, performs the unsubscribe, then
 * renders confirmation HTML. We do the unsubscribe on GET (not just
 * POST) because most mail clients render the link as a clickable URL,
 * not a form submission — the recipient expects the click itself to
 * unsubscribe them, with this page just confirming.
 *
 * This deliberately deviates from "GET-doesn't-mutate" REST orthodoxy:
 * email unsubscribe links have always worked this way and recipient
 * UX takes precedence. The token's signature + tenant scoping limit
 * the blast radius — only the legitimate token holder can trigger the
 * mutation.
 *
 * The route handler at /u/[token]/route.ts handles RFC 8058 one-click
 * POST separately for compliant mail clients.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: { token: string };
}): Promise<JSX.Element> {
  let verified;
  try {
    verified = verifyEmailToken(params.token);
  } catch (err) {
    return (
      <ErrorView
        message={
          err instanceof Error
            ? err.message
            : 'This unsubscribe link is invalid or expired.'
        }
      />
    );
  }
  if (verified.kind !== 'unsubscribe') {
    return <ErrorView message="This link is not a valid unsubscribe link." />;
  }

  const send = await prisma.campaignSend.findUnique({
    where: { id: verified.campaignSendId },
    select: {
      id: true,
      tenantId: true,
      contactId: true,
      email: true,
      campaignId: true,
      contact: {
        select: { id: true, email: true, emailStatus: true },
      },
    },
  });
  if (!send || send.tenantId !== verified.tenantId) {
    return <ErrorView message="Subscription not found." />;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: send.tenantId },
    select: { name: true },
  });

  // Idempotent: if already unsubscribed, just render the confirmation —
  // no DB writes.
  const alreadyUnsubscribed =
    send.contact?.emailStatus === SubscriptionStatus.UNSUBSCRIBED;

  if (!alreadyUnsubscribed) {
    try {
      await withTenant(send.tenantId, async (tx) => {
        if (send.contact) {
          await tx.contact.update({
            where: { id: send.contact.id },
            data: { emailStatus: SubscriptionStatus.UNSUBSCRIBED },
          });
        }
        if (send.contact?.email) {
          await upsertSuppressionEntry(tx, {
            tenantId: send.tenantId,
            channel: Channel.EMAIL,
            value: send.contact.email,
            reason: SuppressionReason.UNSUBSCRIBED,
            metadata: {
              via: 'link',
              campaignSendId: send.id,
              campaignId: send.campaignId,
            },
          });
        }
        if (send.contact) {
          await emitContactEvent(tx, {
            tenantId: send.tenantId,
            contactId: send.contact.id,
            type: ContactEventType.UNSUBSCRIBED,
            metadata: {
              channel: 'EMAIL',
              campaignId: send.campaignId,
              via: 'link',
            },
          });
        }
        // CampaignEvent for the unsubscribe (analytics).
        await tx.campaignEvent.create({
          data: {
            tenantId: send.tenantId,
            campaignSendId: send.id,
            campaignId: send.campaignId,
            type: 'UNSUBSCRIBED',
            metadata: { via: 'link' },
          },
        });
      });
    } catch (err) {
      console.error('[unsubscribe:page] failed:', err);
      return (
        <ErrorView message="Something went wrong. Please try again or contact support." />
      );
    }
  }

  return <ConfirmedView tenantName={tenant?.name ?? 'this workspace'} email={send.email} />;
}

function ConfirmedView({
  tenantName,
  email,
}: {
  tenantName: string;
  email: string;
}): JSX.Element {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
        <span className="text-2xl">✓</span>
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        You've been unsubscribed
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium">{email}</span> will no longer receive
        emails from <span className="font-medium">{tenantName}</span>.
      </p>
      <p className="mt-6 text-xs text-muted-foreground">
        If this was a mistake, contact {tenantName} directly. Re-subscribing
        requires explicit action by the workspace owner.
      </p>
    </div>
  );
}

function ErrorView({ message }: { message: string }): JSX.Element {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950">
        <span className="text-2xl">!</span>
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Couldn't unsubscribe
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
