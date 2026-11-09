/**
 * Twilio SMS integration — thin REST wrapper + credential resolver.
 *
 * Reads the platform-level `twilio` row from IntegrationCredential.
 * Secrets travel through the @getyn/crypto envelope with AD
 * "integration:twilio". No npm dep — the public Twilio REST API is a
 * single HTTPS POST with Basic-auth (SID:TOKEN), so standard fetch
 * does the job.
 *
 * Adding another SMS provider (Telnyx, MSG91, etc.) is the same
 * shape: new row with provider = 'telnyx', its own send() helper,
 * `getSmsProvider()` resolves the active one.
 */
import { loadIntegration } from './credential-store';

export type TwilioConfig = {
  accountSid: string;
  /** Default from-number OR messaging-service SID (either works on Twilio). */
  fromNumber: string;
};

export type TwilioSecrets = {
  authToken: string;
};

export interface TwilioCredentials {
  enabled: boolean;
  config: TwilioConfig | null;
  authToken: string | null;
}

export async function getTwilioCredentials(): Promise<TwilioCredentials> {
  const row = await loadIntegration<TwilioConfig, TwilioSecrets>('twilio');
  if (!row) {
    return { enabled: false, config: null, authToken: null };
  }
  return {
    enabled: row.enabled,
    config: row.config,
    authToken: row.secrets?.authToken ?? null,
  };
}

export type TwilioSendInput = {
  to: string;
  body: string;
  from?: string;
  statusCallback?: string;
};

export type TwilioSendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; error: string; code?: string };

/**
 * POST to Twilio's REST Messages endpoint. Uses the configured
 * default from-number unless the caller overrides it (per-tenant
 * from-numbers are a later-phase feature).
 */
export async function sendTwilioSms(
  input: TwilioSendInput,
): Promise<TwilioSendResult> {
  const creds = await getTwilioCredentials();
  if (!creds.enabled || !creds.config || !creds.authToken) {
    return {
      ok: false,
      error: 'Twilio integration is not configured or disabled.',
    };
  }
  const from = input.from || creds.config.fromNumber;
  if (!from) {
    return { ok: false, error: 'No Twilio from-number configured.' };
  }
  const sid = creds.config.accountSid;
  const body = new URLSearchParams();
  body.set('To', input.to);
  body.set('Body', input.body);
  // If `from` looks like a messaging-service SID (MGxxxxxxxx) send
  // as MessagingServiceSid, otherwise as From. Lets the admin paste
  // either into the same field.
  if (from.startsWith('MG')) {
    body.set('MessagingServiceSid', from);
  } else {
    body.set('From', from);
  }
  if (input.statusCallback) body.set('StatusCallback', input.statusCallback);
  const auth = Buffer.from(`${sid}:${creds.authToken}`).toString('base64');
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      code?: number | string;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.message ?? `Twilio returned HTTP ${res.status}`,
        code: json.code ? String(json.code) : undefined,
      };
    }
    return {
      ok: true,
      sid: json.sid ?? '',
      status: json.status ?? 'queued',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Twilio request failed.',
    };
  }
}

/**
 * Rough SMS segment estimate — GSM-7 fits 160 chars/segment (153
 * when concatenated), Unicode UCS-2 fits 70 (67 concat). Used by the
 * client for the live counter AND the server for plan-limit gating
 * at send time.
 *
 * We approximate "does this message contain non-GSM characters?" by
 * checking for anything outside the printable-ASCII + common Latin-1
 * range; good enough for the counter and billing-ceiling math.
 */
export function estimateSmsSegments(body: string): {
  chars: number;
  encoding: 'GSM' | 'UCS2';
  segments: number;
} {
  const chars = [...body].length;
  // eslint-disable-next-line no-control-regex
  const nonGsm = /[^\u0000-\u007F -ÿ]/.test(body);
  const encoding = nonGsm ? 'UCS2' : 'GSM';
  if (chars === 0) return { chars: 0, encoding, segments: 0 };
  const single = encoding === 'GSM' ? 160 : 70;
  const concat = encoding === 'GSM' ? 153 : 67;
  const segments =
    chars <= single ? 1 : Math.ceil(chars / concat);
  return { chars, encoding, segments };
}
