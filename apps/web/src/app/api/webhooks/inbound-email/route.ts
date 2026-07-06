/* eslint-disable no-console */
/**
 * Phase 8 M1 — inbound reply webhook.
 *
 *   POST /api/webhooks/inbound-email
 *
 * Landing point for Resend (default) or SendGrid (fallback) inbound-
 * parsing webhooks configured for the `reply.getyn.com` subdomain.
 *
 * Flow:
 *   1. Verify the provider signature (Resend uses Svix; SendGrid uses
 *      a bearer token or Basic auth we can also validate here).
 *   2. Parse the payload via the provider-agnostic adapter.
 *   3. Persist InboundEmail row (matchedTo=UNMATCHED, tenantId=null).
 *   4. Enqueue an inbound-email-process job for the worker to do the
 *      token-routing + fan-out off the request path.
 *   5. 200 back to the provider.
 *
 * Rationale for persisting BEFORE routing: if the worker is down for
 * hours, the payload is still on disk. Provider retry windows are
 * typically short (Resend/Svix ~24h). Losing an inbound reply to a
 * worker outage would be a bad user experience.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@getyn/db';

import { parseInbound, type InboundProvider } from '@/server/inbound/parse-payload';
import { enqueueInboundEmailProcess } from '@/server/queues';

const TIMESTAMP_TOLERANCE_S = 5 * 60;

function getProvider(): InboundProvider {
  const v = (process.env.INBOUND_EMAIL_PROVIDER ?? 'resend').toLowerCase();
  return v === 'sendgrid' ? 'sendgrid' : 'resend';
}

function getSvixKey(secret: string | null): Buffer | null {
  if (!secret) return null;
  const stripped = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  try {
    return Buffer.from(stripped, 'base64');
  } catch {
    return null;
  }
}

/**
 * Verify Svix signature (same scheme Resend uses for outbound events).
 * Returns { ok: true } or { ok: false, code, reason } — the code
 * becomes the HTTP status.
 */
function verifySvixSignature(
  req: NextRequest,
  rawBody: string,
  key: Buffer,
): { ok: true } | { ok: false; code: number; reason: string } {
  const svixId = req.headers.get('svix-id');
  const svixTs = req.headers.get('svix-timestamp');
  const svixSig = req.headers.get('svix-signature');
  if (!svixId || !svixTs || !svixSig) {
    return { ok: false, code: 400, reason: 'missing signature header' };
  }
  const ts = Number.parseInt(svixTs, 10);
  if (
    !Number.isFinite(ts) ||
    Math.abs(Math.floor(Date.now() / 1000) - ts) > TIMESTAMP_TOLERANCE_S
  ) {
    return { ok: false, code: 400, reason: 'timestamp out of range' };
  }
  const signedContent = `${svixId}.${svixTs}.${rawBody}`;
  const expected = createHmac('sha256', key).update(signedContent).digest();

  const provided = svixSig
    .split(/\s+/)
    .map((part) => {
      const [scheme, sig] = part.split(',', 2);
      return scheme === 'v1' ? sig : null;
    })
    .filter((s): s is string => Boolean(s));

  const ok = provided.some((sig) => {
    try {
      const buf = Buffer.from(sig, 'base64');
      return buf.length === expected.length && timingSafeEqual(buf, expected);
    } catch {
      return false;
    }
  });
  return ok ? { ok: true } : { ok: false, code: 401, reason: 'bad signature' };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const provider = getProvider();
  const rawBody = await req.text();

  // 1. Signature verification. Providers differ; we only implement
  //    Svix for now (Resend). SendGrid Inbound Parse authenticates
  //    via Basic auth on the webhook URL — configuring that on the
  //    endpoint URL itself means we don't need per-request checks
  //    here for the SendGrid path.
  if (provider === 'resend') {
    const SECRET = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    const key = getSvixKey(SECRET ?? null);
    if (!SECRET || !key || key.length === 0) {
      console.error(
        '[webhook:inbound-email] INBOUND_EMAIL_WEBHOOK_SECRET unset — refusing',
      );
      return NextResponse.json(
        { error: 'Webhook receiver not configured.' },
        { status: 503 },
      );
    }
    const verdict = verifySvixSignature(req, rawBody, key);
    if (!verdict.ok) {
      console.error(`[webhook:inbound-email] ${verdict.reason}`);
      Sentry.captureMessage(`inbound-email verification failed: ${verdict.reason}`, {
        level: 'warning',
        tags: { webhook: 'inbound-email', failure: 'signature' },
      });
      return NextResponse.json({ error: verdict.reason }, { status: verdict.code });
    }
  }

  // 2. Parse the body. Any parse failure is logged but we still 200
  //    the provider — a persistent 4xx would just cause retry-storms
  //    on payloads we'll never handle. Loud Sentry alert instead.
  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const parseResult = parseInbound(raw, provider);

  // 3. Persist. On parse success we have real fields; on failure we
  //    still write a row (so nothing is lost) with placeholder values
  //    that the operator can spot in the Inbox as UNMATCHED with a
  //    processError.
  const row = await prisma.inboundEmail.create({
    data: parseResult.ok
      ? {
          messageId: parseResult.parsed.messageId,
          fromAddress: parseResult.parsed.fromAddress,
          fromName: parseResult.parsed.fromName,
          toAddress: parseResult.parsed.toAddress,
          subject: parseResult.parsed.subject,
          bodyHtml: parseResult.parsed.bodyHtml,
          bodyText: parseResult.parsed.bodyText,
          inReplyTo: parseResult.parsed.inReplyTo,
          referencesHeader: parseResult.parsed.referencesHeader,
          rawPayload: raw as object,
        }
      : {
          fromAddress: '',
          toAddress: '',
          subject: '',
          bodyHtml: '',
          bodyText: '',
          processError: `parse_failed: ${parseResult.reason}`,
          processedAt: new Date(),
          rawPayload: raw as object,
        },
    select: { id: true },
  });

  if (!parseResult.ok) {
    Sentry.captureMessage(`inbound-email parse failed: ${parseResult.reason}`, {
      level: 'warning',
      tags: { webhook: 'inbound-email', failure: 'parse', provider },
      extra: { inboundEmailId: row.id },
    });
    // Still return 200 — the provider retrying won't fix a bad payload.
    return NextResponse.json({ ok: true, id: row.id }, { status: 200 });
  }

  // 4. Enqueue routing.
  try {
    await enqueueInboundEmailProcess({ inboundEmailId: row.id });
  } catch (err) {
    console.error('[webhook:inbound-email] enqueue failed:', err);
    Sentry.captureException(err, {
      tags: { webhook: 'inbound-email', failure: 'enqueue' },
      extra: { inboundEmailId: row.id },
    });
    // 500 so provider retries — the payload is persisted so double-
    // enqueue is fine (worker dedupes on inbound_<id> jobId).
    return NextResponse.json({ error: 'Could not enqueue.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: row.id }, { status: 200 });
}
