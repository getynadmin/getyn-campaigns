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

// ------------------------------------------------------------------
// Phase 10 — number marketplace + alphanumeric sender IDs.
// ------------------------------------------------------------------

type TwilioNumberType = 'Local' | 'Mobile' | 'TollFree';

export interface TwilioAvailableNumber {
  phoneNumber: string;        // E.164
  friendlyName: string;
  locality: string | null;
  region: string | null;
  isoCountry: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  monthlyPriceCents: number | null;
  type: TwilioNumberType;
}

export interface TwilioPurchasedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

async function twilioFetch(
  path: string,
  init: RequestInit & { creds: { accountSid: string; authToken: string } },
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const { creds, ...rest } = init;
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
  const headers = new Headers(rest.headers);
  headers.set('Authorization', `Basic ${auth}`);
  if (!headers.has('Content-Type') && rest.body) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
  }
  const res = await fetch(`https://api.twilio.com${path}`, { ...rest, headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

// Twilio's pricing endpoint sits on a different host.
async function twilioPricingFetch(
  path: string,
  creds: { accountSid: string; authToken: string },
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
  const res = await fetch(`https://pricing.twilio.com${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

// In-memory pricing cache keyed by country+type. Twilio's monthly
// price doesn't change often; a 24h TTL keeps the UI snappy without
// an upstream refetch on every search.
const PRICING_TTL_MS = 24 * 60 * 60 * 1_000;
const pricingCache = new Map<
  string,
  { at: number; byType: Record<TwilioNumberType, number | null> }
>();

async function getCountryPricingUsdCents(
  country: string,
  creds: { accountSid: string; authToken: string },
): Promise<Record<TwilioNumberType, number | null>> {
  const key = country.toUpperCase();
  const cached = pricingCache.get(key);
  if (cached && Date.now() - cached.at < PRICING_TTL_MS) return cached.byType;

  const empty: Record<TwilioNumberType, number | null> = {
    Local: null, Mobile: null, TollFree: null,
  };
  const res = await twilioPricingFetch(
    `/v1/PhoneNumbers/Countries/${encodeURIComponent(key)}`,
    creds,
  );
  if (!res.ok) {
    pricingCache.set(key, { at: Date.now(), byType: empty });
    return empty;
  }
  const body = res.body as {
    phone_number_prices?: Array<{
      number_type?: string;
      base_price?: string | number;
      current_price?: string | number;
    }>;
  };
  const byType = { ...empty };
  for (const row of body.phone_number_prices ?? []) {
    const price = row.current_price ?? row.base_price;
    if (price == null) continue;
    const usd = typeof price === 'string' ? parseFloat(price) : price;
    if (!Number.isFinite(usd)) continue;
    const cents = Math.round(usd * 100);
    const t = (row.number_type || '').toLowerCase();
    if (t === 'local') byType.Local = cents;
    else if (t === 'mobile') byType.Mobile = cents;
    else if (t === 'toll free' || t === 'tollfree') byType.TollFree = cents;
  }
  pricingCache.set(key, { at: Date.now(), byType });
  return byType;
}

export interface SearchAvailableNumbersInput {
  country: string;
  areaCode?: string;
  contains?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Search Twilio's available-number inventory for a country. Tries
 * Local first, then falls back to Mobile and TollFree so small
 * markets (that may have no Local) still return something.
 */
export async function listAvailablePhoneNumbers(
  input: SearchAvailableNumbersInput,
): Promise<{ ok: true; numbers: TwilioAvailableNumber[] } | { ok: false; error: string }> {
  const creds = await getTwilioCredentials();
  if (!creds.enabled || !creds.config || !creds.authToken) {
    return { ok: false, error: 'Twilio integration is not configured.' };
  }
  const cc = input.country.toUpperCase();
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 50));
  const page = Math.max(0, input.page ?? 0);
  const prices = await getCountryPricingUsdCents(cc, {
    accountSid: creds.config.accountSid,
    authToken: creds.authToken,
  });
  const search = async (type: TwilioNumberType): Promise<TwilioAvailableNumber[]> => {
    const q = new URLSearchParams();
    q.set('SmsEnabled', 'true');
    q.set('PageSize', String(pageSize));
    q.set('Page', String(page));
    if (input.areaCode) q.set('AreaCode', input.areaCode);
    if (input.contains) q.set('Contains', input.contains);
    const res = await twilioFetch(
      `/2010-04-01/Accounts/${creds.config!.accountSid}/AvailablePhoneNumbers/${cc}/${type}.json?${q.toString()}`,
      { method: 'GET', creds: { accountSid: creds.config!.accountSid, authToken: creds.authToken! } },
    );
    if (!res.ok) return [];
    const body = res.body as {
      available_phone_numbers?: Array<{
        phone_number: string;
        friendly_name: string;
        locality?: string | null;
        region?: string | null;
        iso_country: string;
        capabilities?: { voice?: boolean; SMS?: boolean; sms?: boolean; MMS?: boolean; mms?: boolean };
      }>;
    };
    return (body.available_phone_numbers ?? []).map((n) => ({
      phoneNumber: n.phone_number,
      friendlyName: n.friendly_name,
      locality: n.locality ?? null,
      region: n.region ?? null,
      isoCountry: n.iso_country,
      capabilities: {
        voice: Boolean(n.capabilities?.voice),
        sms: Boolean(n.capabilities?.SMS ?? n.capabilities?.sms),
        mms: Boolean(n.capabilities?.MMS ?? n.capabilities?.mms),
      },
      monthlyPriceCents: prices[type],
      type,
    }));
  };
  const local = await search('Local');
  if (local.length > 0) return { ok: true, numbers: local };
  const mobile = await search('Mobile');
  if (mobile.length > 0) return { ok: true, numbers: mobile };
  const toll = await search('TollFree');
  return { ok: true, numbers: toll };
}

export async function purchasePhoneNumber(
  e164: string,
  friendlyName?: string,
): Promise<
  | { ok: true; number: TwilioPurchasedNumber }
  | { ok: false; error: string; code?: string }
> {
  const creds = await getTwilioCredentials();
  if (!creds.enabled || !creds.config || !creds.authToken) {
    return { ok: false, error: 'Twilio integration is not configured.' };
  }
  const body = new URLSearchParams();
  body.set('PhoneNumber', e164);
  if (friendlyName) body.set('FriendlyName', friendlyName);
  const res = await twilioFetch(
    `/2010-04-01/Accounts/${creds.config.accountSid}/IncomingPhoneNumbers.json`,
    {
      method: 'POST',
      body: body.toString(),
      creds: { accountSid: creds.config.accountSid, authToken: creds.authToken },
    },
  );
  const j = res.body as {
    sid?: string;
    phone_number?: string;
    friendly_name?: string;
    capabilities?: { voice?: boolean; SMS?: boolean; sms?: boolean; MMS?: boolean; mms?: boolean };
    code?: number | string;
    message?: string;
  };
  if (!res.ok || !j.sid) {
    return {
      ok: false,
      error: j.message ?? `Twilio returned HTTP ${res.status}`,
      code: j.code ? String(j.code) : undefined,
    };
  }
  return {
    ok: true,
    number: {
      sid: j.sid,
      phoneNumber: j.phone_number ?? e164,
      friendlyName: j.friendly_name ?? e164,
      capabilities: {
        voice: Boolean(j.capabilities?.voice),
        sms: Boolean(j.capabilities?.SMS ?? j.capabilities?.sms),
        mms: Boolean(j.capabilities?.MMS ?? j.capabilities?.mms),
      },
    },
  };
}

export async function releasePhoneNumber(
  sid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const creds = await getTwilioCredentials();
  if (!creds.enabled || !creds.config || !creds.authToken) {
    return { ok: false, error: 'Twilio integration is not configured.' };
  }
  const res = await twilioFetch(
    `/2010-04-01/Accounts/${creds.config.accountSid}/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`,
    {
      method: 'DELETE',
      creds: { accountSid: creds.config.accountSid, authToken: creds.authToken },
    },
  );
  if (!res.ok && res.status !== 204) {
    const j = res.body as { message?: string };
    return { ok: false, error: j.message ?? `Twilio returned HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function ensureTenantMessagingService(
  existingSid: string | null,
  tenantSlug: string,
): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  if (existingSid) return { ok: true, sid: existingSid };
  const creds = await getTwilioCredentials();
  if (!creds.enabled || !creds.config || !creds.authToken) {
    return { ok: false, error: 'Twilio integration is not configured.' };
  }
  const body = new URLSearchParams();
  body.set('FriendlyName', `${tenantSlug}-sender`);
  const res = await fetch('https://messaging.twilio.com/v1/Services', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.config.accountSid}:${creds.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok || !j.sid) {
    return { ok: false, error: j.message ?? `Twilio returned HTTP ${res.status}` };
  }
  return { ok: true, sid: j.sid };
}

export interface CreateAlphaSenderResult {
  ok: true;
  sid: string;
  status: 'APPROVED' | 'SUBMITTED';
}

export async function createAlphaSender(
  messagingServiceSid: string,
  alphaSender: string,
): Promise<CreateAlphaSenderResult | { ok: false; error: string; code?: string }> {
  const creds = await getTwilioCredentials();
  if (!creds.enabled || !creds.config || !creds.authToken) {
    return { ok: false, error: 'Twilio integration is not configured.' };
  }
  const body = new URLSearchParams();
  body.set('AlphaSender', alphaSender);
  const res = await fetch(
    `https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}/AlphaSenders`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.config.accountSid}:${creds.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );
  const j = (await res.json().catch(() => ({}))) as {
    sid?: string;
    alpha_sender?: string;
    code?: number | string;
    message?: string;
  };
  if (!res.ok || !j.sid) {
    return {
      ok: false,
      error: j.message ?? `Twilio returned HTTP ${res.status}`,
      code: j.code ? String(j.code) : undefined,
    };
  }
  // Twilio returns the alpha sender as immediately registered for
  // supported destinations; countries that require pre-registration
  // (India DLT, UAE, etc.) return a message indicating pending
  // review. The API doesn't expose a per-sender status flag, so we
  // treat creation success as APPROVED — the registration flow is
  // the operator's responsibility if regulatory holds apply.
  return { ok: true, sid: j.sid, status: 'APPROVED' };
}

/**
 * Twilio documents the set of destination countries where an
 * alphanumeric sender ID is routable WITHOUT prior registration.
 * Hard-coded list keeps the UI honest — US and CA are deliberately
 * excluded (they require 10DLC / toll-free / short codes).
 */
export const ALPHA_SENDER_COUNTRIES: Array<{ code: string; name: string }> = [
  { code: 'AT', name: 'Austria' },
  { code: 'AU', name: 'Australia' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'ES', name: 'Spain' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'GR', name: 'Greece' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IN', name: 'India' },
  { code: 'IT', name: 'Italy' },
  { code: 'KE', name: 'Kenya' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SG', name: 'Singapore' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'ZA', name: 'South Africa' },
];

export function listSupportedAlphaSenderCountries(): typeof ALPHA_SENDER_COUNTRIES {
  return ALPHA_SENDER_COUNTRIES;
}

/**
 * Small country catalog for the "buy a number" country selector.
 * Not exhaustive — Twilio sells numbers in ~100 countries; this is
 * the set most tenants will reach for day one.
 */
export const COMMON_PHONE_NUMBER_COUNTRIES: Array<{ code: string; name: string; flag: string }> = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
];

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
  let nonGsm = false;
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) > 0xff) { nonGsm = true; break; }
  }
  const encoding: 'GSM' | 'UCS2' = nonGsm ? 'UCS2' : 'GSM';
  if (chars === 0) return { chars: 0, encoding, segments: 0 };
  const single = encoding === 'GSM' ? 160 : 70;
  const concat = encoding === 'GSM' ? 153 : 67;
  const segments =
    chars <= single ? 1 : Math.ceil(chars / concat);
  return { chars, encoding, segments };
}
