/* eslint-disable no-console */
/**
 * SMS send pipeline — Twilio-backed, single-job model.
 *
 * `prepare-sms-campaign` runs end-to-end per campaign:
 *   1. Pre-flight: Twilio integration enabled + configured.
 *   2. Resolve recipient set: same pragmatic shortcut as the WA
 *      pipeline — all contacts with a phone, not on the SMS
 *      suppression list, E.164-valid.
 *   3. Merge-tag the body per recipient ({{first_name}} etc).
 *   4. POST each message to Twilio sequentially (volume is low for
 *      now — if we hit scale we'll chunk + fan out like wa-sends).
 *   5. Persist SmsCampaignSend with Twilio SID + status.
 *   6. Flip Campaign to SENT when done.
 *
 * Twilio status callbacks land at /api/webhooks/twilio/status and
 * flip individual sends to DELIVERED / FAILED / UNDELIVERED.
 */
import type { Job } from 'bullmq';

import { decrypt, type EncryptedField } from '@getyn/crypto';
import {
  CampaignStatus,
  CampaignType,
  Channel,
  SmsSendStatus,
  prisma,
  withTenant,
} from '@getyn/db';
import { prepareSmsCampaignPayloadSchema } from '@getyn/types';

import { notify } from '../utils/notify';

type TwilioCreds = {
  enabled: boolean;
  accountSid: string;
  fromNumber: string;
  authToken: string;
};

async function loadTwilio(): Promise<TwilioCreds | null> {
  const row = await prisma.integrationCredential.findUnique({
    where: { provider: 'twilio' },
  });
  if (!row || !row.enabled) return null;
  const sec = row.secrets as unknown as EncryptedField | null;
  if (
    !sec ||
    typeof sec !== 'object' ||
    !sec.ciphertext ||
    !sec.iv ||
    !sec.authTag
  ) {
    return null;
  }
  let authToken = '';
  try {
    authToken = (JSON.parse(decrypt(sec, 'integration:twilio')) as {
      authToken?: string;
    }).authToken ?? '';
  } catch {
    return null;
  }
  const cfg = row.config as { accountSid?: string; fromNumber?: string };
  return {
    enabled: true,
    accountSid: cfg.accountSid ?? '',
    fromNumber: cfg.fromNumber ?? '',
    authToken,
  };
}

async function sendOne(
  creds: TwilioCreds,
  to: string,
  body: string,
  from: string | undefined,
  statusCallback: string | undefined,
): Promise<
  | { ok: true; sid: string }
  | { ok: false; error: string; code?: string }
> {
  const useFrom = from || creds.fromNumber;
  if (!useFrom) return { ok: false, error: 'no from-number configured' };
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('Body', body);
  if (useFrom.startsWith('MG')) form.set('MessagingServiceSid', useFrom);
  else form.set('From', useFrom);
  if (statusCallback) form.set('StatusCallback', statusCallback);
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString(
    'base64',
  );
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      sid?: string;
      code?: number | string;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.message ?? `HTTP ${res.status}`,
        code: json.code ? String(json.code) : undefined,
      };
    }
    return { ok: true, sid: json.sid ?? '' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'twilio request failed',
    };
  }
}

type Contact = {
  id: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  customFields: unknown;
};

function mergeBody(body: string, c: Contact): string {
  const tokens: Record<string, string> = {
    first_name: c.firstName ?? '',
    last_name: c.lastName ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
  };
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    return tokens[k] ?? '';
  });
}

export async function handleSmsSendsJob(job: Job): Promise<void> {
  if (job.name !== 'prepare-sms-campaign') {
    console.warn(`[sms-sends] unknown job name: ${job.name}`);
    return;
  }
  const payload = prepareSmsCampaignPayloadSchema.parse(job.data);
  const { campaignId, tenantId } = payload;

  const campaign = await withTenant(tenantId, (tx) =>
    tx.campaign.findFirst({
      where: { id: campaignId, tenantId, type: CampaignType.SMS },
      include: { smsCampaign: true },
    }),
  );
  if (!campaign || !campaign.smsCampaign) {
    console.warn(`[sms-sends] campaign ${campaignId} not found; skipping`);
    return;
  }
  if (campaign.status === CampaignStatus.CANCELED) {
    console.log(`[sms-sends] campaign ${campaignId} cancelled; skipping`);
    return;
  }

  const creds = await loadTwilio();
  if (!creds) {
    await withTenant(tenantId, (tx) =>
      tx.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.FAILED },
      }),
    );
    console.error(
      `[sms-sends] Twilio not configured — campaign ${campaignId} marked FAILED`,
    );
    return;
  }

  const result = await withTenant(tenantId, async (tx) => {
    const suppressed = await tx.suppressionEntry.findMany({
      where: { tenantId, channel: Channel.SMS },
      select: { value: true },
    });
    const suppressedPhones = new Set(suppressed.map((s: { value: string }) => s.value));

    const candidates = await tx.contact.findMany({
      where: {
        tenantId,
        phone: { not: null },
      },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        email: true,
        customFields: true,
      },
    });

    const accepted = candidates.filter(
      (c) =>
        c.phone !== null &&
        /^\+\d{6,15}$/.test(c.phone) &&
        !suppressedPhones.has(c.phone),
    );

    if (accepted.length === 0) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.SENT, sentAt: new Date() },
      });
      return { kind: 'empty' as const };
    }

    const existing = await tx.smsCampaignSend.findMany({
      where: { tenantId, campaignId },
      select: { contactId: true },
    });
    const already = new Set(existing.map((e) => e.contactId));
    const fresh = accepted.filter((c) => !already.has(c.id));

    if (fresh.length > 0) {
      await tx.smsCampaignSend.createMany({
        data: fresh.map((c) => ({
          tenantId,
          campaignId,
          contactId: c.id,
          phone: c.phone as string,
          status: SmsSendStatus.QUEUED,
          segments: campaign.smsCampaign?.segmentsPerMessage ?? 1,
        })),
        skipDuplicates: true,
      });
    }

    return { kind: 'ready' as const, contacts: accepted };
  });

  if (result.kind === 'empty') {
    return;
  }

  // Dispatch sequentially. Twilio has per-account concurrency limits
  // but for low volume (<1k) this is fine; larger volume will need
  // a batch/fan-out model like wa-sends.
  const callbackBase = process.env.APP_BASE_URL ?? '';
  const statusCallback = callbackBase
    ? `${callbackBase}/api/webhooks/twilio/status`
    : undefined;

  let ok = 0;
  let failed = 0;
  for (const c of result.contacts) {
    const body = mergeBody(campaign.smsCampaign.body, c);
    const send = await sendOne(
      creds,
      c.phone as string,
      body,
      campaign.smsCampaign.fromNumber ?? undefined,
      statusCallback,
    );
    await prisma.smsCampaignSend.updateMany({
      where: { tenantId, campaignId, contactId: c.id },
      data: send.ok
        ? {
            providerMessageId: send.sid,
            status: SmsSendStatus.SENT,
            sentAt: new Date(),
            lastEventAt: new Date(),
          }
        : {
            status: SmsSendStatus.FAILED,
            errorCode: send.code ?? null,
            errorMessage: send.error,
            lastEventAt: new Date(),
          },
    });
    if (send.ok) ok += 1;
    else failed += 1;
  }

  const row = await withTenant(tenantId, (tx) =>
    tx.campaign.update({
      where: { id: campaignId },
      data: {
        status: CampaignStatus.SENT,
        sentAt: new Date(),
      },
      select: { id: true, name: true, tenant: { select: { slug: true } } },
    }),
  );
  console.log(
    `[sms-sends] campaign ${campaignId}: ${ok} sent, ${failed} failed`,
  );
  await notify({
    tenantId,
    kind: 'CAMPAIGN_SENT',
    title: `SMS campaign sent: ${row.name}`,
    body: `${ok} delivered, ${failed} failed.`,
    href: `/t/${row.tenant.slug}/campaigns/${row.id}`,
  });
}
