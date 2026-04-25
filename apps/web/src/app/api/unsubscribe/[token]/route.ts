/* eslint-disable no-console */
import { NextResponse, type NextRequest } from 'next/server';

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

/**
 * RFC 8058 one-click unsubscribe POST handler.
 *
 * The email's `List-Unsubscribe` header carries this URL; compliant
 * mail clients POST `List-Unsubscribe=One-Click` to it without any
 * user interaction beyond a single button press in the inbox UI.
 *
 * The token in the URL serves as the auth — no cookies, no CSRF
 * protection. That's compliant: RFC 8058 explicitly forbids redirects,
 * forms, and anything that would require a browser session.
 *
 * Returns 204 on success regardless of the contact's prior status
 * (idempotent). 4xx only when the token itself is invalid.
 *
 * This file lives next to /u/[token]/page.tsx — Next.js dispatches GET
 * to the page and POST to this route handler.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  let verified;
  try {
    verified = verifyEmailToken(params.token);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Invalid or expired token.',
      },
      { status: 400 },
    );
  }
  if (verified.kind !== 'unsubscribe') {
    return NextResponse.json({ error: 'Invalid token kind.' }, { status: 400 });
  }

  const send = await prisma.campaignSend.findUnique({
    where: { id: verified.campaignSendId },
    select: {
      id: true,
      tenantId: true,
      contactId: true,
      campaignId: true,
      contact: { select: { id: true, email: true, emailStatus: true } },
    },
  });
  if (!send || send.tenantId !== verified.tenantId) {
    return NextResponse.json(
      { error: 'Subscription not found.' },
      { status: 404 },
    );
  }

  if (
    send.contact?.emailStatus !== SubscriptionStatus.UNSUBSCRIBED &&
    send.contact
  ) {
    try {
      await withTenant(send.tenantId, async (tx) => {
        await tx.contact.update({
          where: { id: send.contact!.id },
          data: { emailStatus: SubscriptionStatus.UNSUBSCRIBED },
        });
        if (send.contact!.email) {
          await upsertSuppressionEntry(tx, {
            tenantId: send.tenantId,
            channel: Channel.EMAIL,
            value: send.contact!.email,
            reason: SuppressionReason.UNSUBSCRIBED,
            metadata: {
              via: 'list_unsubscribe',
              campaignSendId: send.id,
              campaignId: send.campaignId,
            },
          });
        }
        await emitContactEvent(tx, {
          tenantId: send.tenantId,
          contactId: send.contact!.id,
          type: ContactEventType.UNSUBSCRIBED,
          metadata: {
            channel: 'EMAIL',
            campaignId: send.campaignId,
            via: 'list_unsubscribe',
          },
        });
        await tx.campaignEvent.create({
          data: {
            tenantId: send.tenantId,
            campaignSendId: send.id,
            campaignId: send.campaignId,
            type: 'UNSUBSCRIBED',
            metadata: { via: 'list_unsubscribe' },
          },
        });
      });
    } catch (err) {
      console.error('[unsubscribe:one-click] failed:', err);
      return NextResponse.json(
        { error: 'Internal error.' },
        { status: 500 },
      );
    }
  }

  // RFC 8058: 200 or 204 acceptable.
  return new NextResponse(null, { status: 204 });
}
