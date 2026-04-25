/* eslint-disable no-console */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { enqueueResendWebhookEvent } from '@/server/queues';

/**
 * Resend webhook receiver — `/api/webhooks/resend`.
 *
 * Resend POSTs delivery / bounce / complaint events here as they
 * happen. We do the bare minimum here:
 *   1. Verify the signature.
 *   2. Parse the event.
 *   3. Enqueue a `webhooks` queue job for async processing.
 *   4. 200.
 *
 * Doing the actual DB updates inline would couple webhook latency to
 * our DB and fan-out — Resend retries non-2xx responses, so a slow
 * DB read here would flood us with duplicates. The queue producer
 * is fast, so we hand the event off and reply immediately.
 *
 * Signature verification: HMAC-SHA256 of the raw body, hex-encoded,
 * compared to the `resend-webhook-signature` header. Resend's docs
 * call this header `svix-signature` historically; we accept both.
 *
 * Idempotency: the worker dedupes on `(messageId, eventType,
 * eventTimestamp)` so duplicate POSTs (Resend retries on timeouts)
 * don't double-write. We pass the raw event body through untouched
 * so the worker has the same signal.
 */

const SECRET = process.env.RESEND_WEBHOOK_SECRET;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!SECRET) {
    // No secret set — refuse to process. Otherwise an attacker who
    // knew the URL could send arbitrary "events" that mutate our DB.
    console.error(
      '[webhook:resend] RESEND_WEBHOOK_SECRET unset; rejecting request',
    );
    return NextResponse.json(
      { error: 'Webhook receiver not configured.' },
      { status: 503 },
    );
  }

  // Read raw body for signature verification — JSON parsing changes
  // the bytes (whitespace, key order in some implementations) so we
  // verify against the literal payload.
  const rawBody = await req.text();

  const sigHeader =
    req.headers.get('resend-webhook-signature') ??
    req.headers.get('svix-signature') ??
    '';
  if (!sigHeader) {
    return NextResponse.json(
      { error: 'Missing signature header.' },
      { status: 400 },
    );
  }

  // Resend's signature format is `t=<timestamp>,v1=<hex>`. Older
  // payloads include just the hex. Be tolerant of both.
  const expectedHex = createHmac('sha256', SECRET)
    .update(rawBody)
    .digest('hex');
  const provided =
    sigHeader.includes('v1=')
      ? (sigHeader.match(/v1=([a-f0-9]+)/i)?.[1] ?? '')
      : sigHeader.replace(/^sha256=/, '');
  const sigOk = (() => {
    try {
      if (provided.length !== expectedHex.length) return false;
      return timingSafeEqual(
        Buffer.from(provided, 'hex'),
        Buffer.from(expectedHex, 'hex'),
      );
    } catch {
      return false;
    }
  })();
  if (!sigOk) {
    console.error('[webhook:resend] signature mismatch');
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Resend's payload shape (excerpt):
  //   { type: "email.delivered" | "email.bounced" | "email.complained" | ...
  //     created_at: ISO,
  //     data: { email_id, to, from, subject, ... }
  //   }
  const eventType = String(parsed.type ?? '');
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const messageId = String(data.email_id ?? data.id ?? '');
  if (!eventType || !messageId) {
    return NextResponse.json(
      { error: 'Missing event type or message id.' },
      { status: 400 },
    );
  }

  try {
    await enqueueResendWebhookEvent({
      eventType,
      messageId,
      payload: parsed,
      receivedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[webhook:resend] enqueue failed:', err);
    // Tell Resend to retry — the failure was on our side, not theirs.
    return NextResponse.json(
      { error: 'Could not enqueue.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
