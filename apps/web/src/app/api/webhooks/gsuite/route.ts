/* eslint-disable no-console */
import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';

import { prisma, type Prisma } from '@getyn/db';

import { verifyGsuiteWebhookSignature } from '@/server/billing/gsuite-webhook-verify';
import { enqueueGsuiteWebhookEvent } from '@/server/queues';

/**
 * Phase 5 M4 — G-Suite lifecycle webhook receiver.
 *
 * # Flow
 *   1. Verify X-GSuite-Signature (HMAC-SHA256 over raw body with
 *      GSUITE_WEBHOOK_SECRET). Constant-time compare.
 *   2. Parse payload. Expected shape per kickoff contract:
 *        { eventId, eventType, tenantId, occurredAt, payload }
 *      (tenantId is the G-Suite tenant id; we resolve to our local
 *      Tenant via Tenant.gSuiteTenantId in the worker.)
 *   3. Upsert into GSuiteWebhookEvent by gSuiteEventId — duplicate
 *      POSTs (G-Suite retries on non-2xx) collapse cleanly.
 *   4. Enqueue worker job carrying the row id. The worker dispatches
 *      by eventType.
 *   5. Respond 200 fast — G-Suite retries non-2xx, and we've already
 *      persisted.
 *
 * # Signature assumptions documented + contract-flagged
 * If the real G-Suite team's spec differs (different header name,
 * different envelope), only this file + gsuite-webhook-verify.ts
 * change. Worker handler reads from the persisted row, not the
 * request directly, so the dispatch is decoupled.
 */

interface GsuiteWebhookEnvelope {
  eventId?: string;
  eventType?: string;
  tenantId?: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.GSUITE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook:gsuite] GSUITE_WEBHOOK_SECRET unset; rejecting');
    return NextResponse.json(
      { error: 'Webhook receiver not configured.' },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-gsuite-signature');

  if (!verifyGsuiteWebhookSignature(secret, rawBody, sigHeader)) {
    console.error('[webhook:gsuite] signature mismatch');
    Sentry.captureMessage('webhook:gsuite signature mismatch', {
      level: 'warning',
      tags: { webhook: 'gsuite', failure: 'signature_mismatch' },
    });
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  }

  let envelope: GsuiteWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!envelope.eventId || !envelope.eventType) {
    return NextResponse.json(
      { error: 'Missing eventId or eventType.' },
      { status: 400 },
    );
  }

  // Resolve our local tenant id from the G-Suite tenant id (when
  // present) so the worker doesn't re-query. Null is fine — the
  // worker can handle global events (e.g. plan catalog updates).
  let localTenantId: string | null = null;
  if (envelope.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { gSuiteTenantId: envelope.tenantId },
      select: { id: true },
    });
    localTenantId = tenant?.id ?? null;
  }

  // Persist (idempotent on gSuiteEventId).
  let persisted;
  try {
    persisted = await prisma.gSuiteWebhookEvent.upsert({
      where: { gSuiteEventId: envelope.eventId },
      create: {
        gSuiteEventId: envelope.eventId,
        eventType: envelope.eventType,
        tenantId: localTenantId,
        rawPayload: envelope as unknown as Prisma.JsonObject,
      },
      update: {},
      select: { id: true, processedAt: true },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { webhook: 'gsuite', failure: 'persist' },
      extra: { eventId: envelope.eventId, eventType: envelope.eventType },
    });
    return NextResponse.json(
      { error: 'Could not persist event.' },
      { status: 500 },
    );
  }

  // Re-enqueue even on duplicate — the worker is idempotent on
  // processedAt + cheaper than discriminating here.
  try {
    await enqueueGsuiteWebhookEvent({ webhookEventId: persisted.id });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { webhook: 'gsuite', failure: 'enqueue' },
      extra: { webhookEventId: persisted.id },
    });
    // Persist succeeded; 200 anyway. The cron-style replay (M8) will
    // pick up unprocessed rows if the worker never sees this enqueue.
  }

  return NextResponse.json({ ok: true });
}
