/* eslint-disable no-console */
import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@getyn/db';

import { enqueueWaWebhookEvent } from '@/server/queues';
import { verifyMetaWebhookSignature } from '@/server/whatsapp/webhook-verify';

/**
 * Meta WhatsApp webhook receiver — Phase 4 M9.
 *
 * Path is parameterised on `appId` so we can route to the correct
 * App Secret for signature verification when (eventually) we run
 * multiple Meta apps. Today there's exactly one app, so the appId
 * primarily acts as a routing hint + visible Sentry tag; the secret
 * comes from META_APP_SECRET env.
 *
 * # GET — verification handshake
 * Meta calls GET on initial subscription with hub.mode=subscribe,
 * hub.verify_token=<our token>, hub.challenge=<random string>. We
 * respond with the challenge if the token matches our env var.
 *
 * # POST — event delivery
 * 1. Verify X-Hub-Signature-256 (HMAC-SHA256 with appSecret over the
 *    raw request body). Constant-time compare.
 * 2. Parse the payload. Extract a deterministic dedupeKey for each
 *    embedded event (Meta sends batches; one POST may carry multiple).
 * 3. Persist each event to WhatsAppWebhookEvent with the dedupeKey
 *    as a unique constraint — duplicate POSTs collapse via Prisma's
 *    skipDuplicates: true.
 * 4. Enqueue per-event jobs onto wa-webhooks for async processing.
 *    Worker handles routing into messages / statuses / template-
 *    status / phone-quality branches.
 * 5. Respond 200 fast (Meta retries on non-2xx).
 *
 * Errors here that aren't signature/parse failures (e.g. DB outage)
 * still 200 if at least one event was persisted — Meta won't retry,
 * but the polling fallback (M9 wa-poll-inbound) catches drops.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { appId: string } },
): Promise<NextResponse> {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    console.error('[webhook:wa] WHATSAPP_WEBHOOK_VERIFY_TOKEN unset');
    return new NextResponse('Server not configured', { status: 503 });
  }
  if (mode === 'subscribe' && token === expected && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }
  // Don't leak whether the verify token matched.
  console.warn(
    `[webhook:wa] verification failed for app=${params.appId}; mode=${mode}`,
  );
  return new NextResponse('Forbidden', { status: 403 });
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string; // wabaId
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        messages?: Array<{
          id: string;
          from?: string;
          timestamp?: string;
          type?: string;
          [k: string]: unknown;
        }>;
        statuses?: Array<{
          id: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          conversation?: { id?: string; origin?: { type?: string } };
          pricing?: { category?: string };
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
        message_template_id?: string;
        message_template_name?: string;
        event?: string; // template_status_update
        reason?: string;
        [k: string]: unknown;
      };
    }>;
  }>;
}

interface DerivedEvent {
  dedupeKey: string;
  eventType: string;
  wabaId: string | null;
  phoneNumberMetaId: string | null;
}

/**
 * Build per-embedded-event metadata + a deterministic dedupeKey.
 * Meta sends batches; we explode the batch into individual jobs so
 * the worker can fail one event without rolling back the rest.
 */
function deriveEvents(payload: MetaWebhookPayload): DerivedEvent[] {
  const out: DerivedEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const wabaId = entry.id ?? null;
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const phoneNumberMetaId = v.metadata?.phone_number_id ?? null;

      // 1) inbound messages — one event per message
      for (const m of v.messages ?? []) {
        out.push({
          dedupeKey: `inbound:${m.id}`,
          eventType: `inbound:${m.type ?? 'unknown'}`,
          wabaId,
          phoneNumberMetaId,
        });
      }
      // 2) outbound status updates — one per status row
      for (const s of v.statuses ?? []) {
        out.push({
          dedupeKey: `status:${s.id}:${s.status ?? 'unknown'}`,
          eventType: `status:${s.status ?? 'unknown'}`,
          wabaId,
          phoneNumberMetaId,
        });
      }
      // 3) template status updates — keyed by (template, new status)
      if (change.field === 'message_template_status_update' && v.message_template_id) {
        out.push({
          dedupeKey: `template_status:${v.message_template_id}:${v.event ?? 'unknown'}`,
          eventType: `template_status:${v.event ?? 'unknown'}`,
          wabaId,
          phoneNumberMetaId,
        });
      }
      // 4) phone-number quality update — keyed by (phone, value).
      if (change.field === 'phone_number_quality_update' && phoneNumberMetaId) {
        const value = JSON.stringify(v).slice(0, 60); // brief discriminator
        out.push({
          dedupeKey: `phone_quality:${phoneNumberMetaId}:${value}`,
          eventType: 'phone_quality_update',
          wabaId,
          phoneNumberMetaId,
        });
      }
      // 5) account alerts — best-effort dedupe key.
      if (change.field === 'account_alerts') {
        out.push({
          dedupeKey: `account_alerts:${wabaId}:${Date.now()}`,
          eventType: 'account_alerts',
          wabaId,
          phoneNumberMetaId: null,
        });
      }
    }
  }
  return out;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { appId: string } },
): Promise<NextResponse> {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[webhook:wa] META_APP_SECRET unset; rejecting');
    return NextResponse.json(
      { error: 'Webhook receiver not configured.' },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-hub-signature-256');
  if (!sigHeader) {
    return NextResponse.json(
      { error: 'Missing signature header.' },
      { status: 400 },
    );
  }

  if (!verifyMetaWebhookSignature(appSecret, rawBody, sigHeader)) {
    console.error('[webhook:wa] signature mismatch');
    Sentry.captureMessage('webhook:wa signature mismatch', {
      level: 'warning',
      tags: { webhook: 'whatsapp', failure: 'signature_mismatch' },
    });
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  }

  let parsed: MetaWebhookPayload;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const events = deriveEvents(parsed);
  if (events.length === 0) {
    // Heartbeat / no actionable events — 200 quietly.
    return NextResponse.json({ ok: true, events: 0 });
  }

  // Persist + enqueue per event. Use createMany skipDuplicates for
  // idempotent insert; subsequent enqueue is by-id so re-deliveries
  // collapse cleanly (the worker also re-checks the row's
  // processedAt before doing work).
  const persisted: Array<{ id: string }> = [];
  for (const ev of events) {
    try {
      const row = await prisma.whatsAppWebhookEvent.upsert({
        where: { dedupeKey: ev.dedupeKey },
        create: {
          dedupeKey: ev.dedupeKey,
          eventType: ev.eventType,
          phoneNumberId: null, // resolved by worker via metadata
          tenantId: null, // resolved by worker
          rawPayload: parsed as unknown as object,
        },
        update: {}, // no-op on duplicate
        select: { id: true, processedAt: true },
      });
      persisted.push({ id: row.id });
    } catch (err) {
      console.error('[webhook:wa] persist failed for', ev.dedupeKey, err);
      Sentry.captureException(err, {
        tags: { webhook: 'whatsapp', failure: 'persist' },
        extra: { dedupeKey: ev.dedupeKey, appId: params.appId },
      });
    }
  }

  // Enqueue async processing. Failures here non-fatal — the persisted
  // row stays in DB; the polling fallback (wa-poll-inbound) will catch
  // up if the worker missed it.
  for (const p of persisted) {
    try {
      await enqueueWaWebhookEvent({ webhookEventId: p.id });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { webhook: 'whatsapp', failure: 'enqueue' },
        extra: { webhookEventId: p.id, appId: params.appId },
      });
    }
  }

  return NextResponse.json({ ok: true, events: persisted.length });
}
