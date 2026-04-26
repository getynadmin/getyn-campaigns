/* eslint-disable no-console */
import { createHmac, timingSafeEqual } from 'crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { enqueueResendWebhookEvent } from '@/server/queues';

/**
 * Resend webhook receiver — `/api/webhooks/resend`.
 *
 * Resend POSTs delivery / bounce / complaint events here as they
 * happen. We do the bare minimum here:
 *   1. Verify the signature (Svix format — Resend uses Svix infra).
 *   2. Parse the event.
 *   3. Enqueue a `webhooks` queue job for async processing.
 *   4. 200.
 *
 * Doing the actual DB updates inline would couple webhook latency to
 * our DB and fan-out — Resend retries non-2xx responses, so a slow
 * DB read here would flood us with duplicates. The queue producer is
 * fast, so we hand the event off and reply immediately.
 *
 * SVIX signature verification:
 *   - The signing key is `RESEND_WEBHOOK_SECRET`. It comes prefixed
 *     `whsec_<base64>`; we strip the prefix and base64-decode to get
 *     the raw HMAC key.
 *   - Signed content = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   - HMAC-SHA256 → base64 (NOT hex)
 *   - The `svix-signature` header carries one or more space-separated
 *     versions, each `v1,<base64>`. We must match any.
 *   - 5-minute timestamp tolerance against replay.
 *
 * Idempotency: the worker dedupes on `(messageId, eventType,
 * eventTimestamp)` so duplicate POSTs (Resend retries on timeouts)
 * don't double-write. We pass the raw event body through untouched
 * so the worker has the same signal.
 */

const SECRET = process.env.RESEND_WEBHOOK_SECRET;
const TIMESTAMP_TOLERANCE_S = 5 * 60;

function getSigningKey(): Buffer | null {
  if (!SECRET) return null;
  // Svix secret format: `whsec_<base64>`.
  const stripped = SECRET.startsWith('whsec_')
    ? SECRET.slice('whsec_'.length)
    : SECRET;
  try {
    return Buffer.from(stripped, 'base64');
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const key = getSigningKey();
  if (!SECRET || !key || key.length === 0) {
    // No secret set — refuse to process. Otherwise an attacker who
    // knew the URL could send arbitrary "events" that mutate our DB.
    console.error(
      '[webhook:resend] RESEND_WEBHOOK_SECRET unset or unparseable; rejecting request',
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

  const svixId = req.headers.get('svix-id');
  const svixTs = req.headers.get('svix-timestamp');
  const svixSig = req.headers.get('svix-signature');
  if (!svixId || !svixTs || !svixSig) {
    return NextResponse.json(
      { error: 'Missing signature header.' },
      { status: 400 },
    );
  }

  // Replay-attack guard: reject events older than 5 minutes.
  const ts = Number.parseInt(svixTs, 10);
  if (
    !Number.isFinite(ts) ||
    Math.abs(Math.floor(Date.now() / 1000) - ts) > TIMESTAMP_TOLERANCE_S
  ) {
    return NextResponse.json(
      { error: 'Timestamp out of range.' },
      { status: 400 },
    );
  }

  // Compute expected signature over the Svix-style signed content.
  const signedContent = `${svixId}.${svixTs}.${rawBody}`;
  const expectedSig = createHmac('sha256', key)
    .update(signedContent)
    .digest('base64');

  // The header may contain multiple versions, space-separated:
  //   `v1,<base64sig> v1a,<otherbase64sig>`
  // We only validate v1. Match any version that succeeds.
  const provided = svixSig
    .split(/\s+/)
    .map((part) => {
      const [scheme, sig] = part.split(',', 2);
      return scheme === 'v1' ? sig : null;
    })
    .filter((s): s is string => s !== null);

  const expectedBuf = Buffer.from(expectedSig, 'base64');
  const sigOk = provided.some((sig) => {
    try {
      const buf = Buffer.from(sig, 'base64');
      return (
        buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf)
      );
    } catch {
      return false;
    }
  });
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
