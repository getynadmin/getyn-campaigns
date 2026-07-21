import { cache } from 'react';

import { loadIntegration } from './credential-store';

/**
 * XPay Checkout — payment gateway config.
 *
 * Docs: docs.xpaycheckout.com. Auth is Basic: username = publicKey,
 * password = privateKey, base64-encoded. Two environments (sandbox,
 * production) map to different base URLs.
 *
 * Subscription flow (Phase 2):
 *   POST /subscriptions/create → returns { subscriptionId, fwdUrl }
 *   Redirect user to fwdUrl (hosted checkout page).
 *   On completion XPay redirects to callbackUrl?subscriptionId=...
 *   We verify server-side via GET /subscriptions/get/{id} — never trust
 *   the callback alone.
 *   Backstop: webhook at /api/payments/xpay/webhook (HMAC via
 *   webhookSecret).
 */
const PROVIDER = 'xpay';

export interface XpayConfig {
  environment: 'sandbox' | 'production';
  publicKey?: string;
  callbackBaseUrl?: string;
}

export interface XpaySecrets {
  privateKey: string;
  webhookSecret?: string;
}

export interface ResolvedXpay {
  publicKey: string | null;
  privateKey: string | null;
  webhookSecret: string | null;
  environment: 'sandbox' | 'production';
  callbackBaseUrl: string | null;
  source: 'db' | 'env' | 'none';
}

function envDefaults(): ResolvedXpay {
  const envKey = process.env.XPAY_PUBLIC_KEY ?? null;
  const priv = process.env.XPAY_PRIVATE_KEY ?? null;
  return {
    publicKey: envKey,
    privateKey: priv,
    webhookSecret: process.env.XPAY_WEBHOOK_SECRET ?? null,
    environment:
      (process.env.XPAY_ENVIRONMENT as 'sandbox' | 'production' | undefined) ??
      'sandbox',
    callbackBaseUrl: process.env.XPAY_CALLBACK_BASE_URL ?? null,
    source: envKey && priv ? 'env' : 'none',
  };
}

async function load(): Promise<ResolvedXpay> {
  const row = await loadIntegration<XpayConfig, XpaySecrets>(PROVIDER);
  if (row && row.secrets?.privateKey) {
    return {
      publicKey: row.config.publicKey ?? null,
      privateKey: row.secrets.privateKey,
      webhookSecret: row.secrets.webhookSecret ?? null,
      environment: row.config.environment ?? 'sandbox',
      callbackBaseUrl: row.config.callbackBaseUrl ?? null,
      source: 'db',
    };
  }
  return envDefaults();
}

export const getXpayCredentials = cache(load);

export function xpayBaseUrl(env: 'sandbox' | 'production'): string {
  return env === 'production'
    ? 'https://api.xpaycheckout.com'
    : 'https://sandbox.xpaycheckout.com';
}

function basicAuthHeader(pub: string, priv: string): string {
  const token = Buffer.from(`${pub}:${priv}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function xpayFetch(
  path: string,
  init: RequestInit & { creds: ResolvedXpay },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const { creds, ...rest } = init;
  if (!creds.publicKey || !creds.privateKey) {
    return {
      ok: false,
      status: 0,
      body: { message: 'XPay credentials not configured' },
    };
  }
  const res = await fetch(`${xpayBaseUrl(creds.environment)}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: basicAuthHeader(creds.publicKey, creds.privateKey),
      ...(rest.headers ?? {}),
    },
  });
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Health check — the cheapest authenticated call XPay exposes is a
 * GET on a probably-nonexistent subscription (returns 404 with a
 * proper error body when creds are valid, 401 when they're not).
 * Good enough to prove Basic auth works.
 */
export async function testXpayCredentials(
  creds: ResolvedXpay,
): Promise<{ ok: boolean; message: string }> {
  if (!creds.publicKey || !creds.privateKey) {
    return { ok: false, message: 'Missing public or private key.' };
  }
  const probe = await xpayFetch('/subscription/get/health-probe', {
    method: 'GET',
    creds,
  });
  // 401/403 = bad creds. 404 or 400 with error body = auth worked.
  if (probe.status === 401 || probe.status === 403) {
    return { ok: false, message: 'XPay rejected the API credentials (401/403).' };
  }
  return {
    ok: true,
    message: `Connected to ${creds.environment} at status ${probe.status}.`,
  };
}

export interface CreateSubscriptionInput {
  planName: string;
  amountCents: number;
  currency: string;
  billingCycle: 'monthly' | 'annual';
  customer: {
    email: string;
    /** Full name — XPay wants a single `name` field, not first+last. */
    name: string;
    /** E.164 phone REQUIRED by XPay per docs. */
    contactNumber: string;
  };
  /** Our internal order id — echoed back on callback + webhook. */
  merchantReference: string;
  /** Where XPay should redirect after the hosted checkout completes. */
  callbackUrl: string;
  /** Optional metadata we want back on the webhook / get-subscription. */
  metadata?: Record<string, string>;
}

export interface CreateSubscriptionResult {
  ok: boolean;
  subscriptionId?: string;
  fwdUrl?: string;
  message?: string;
  raw: unknown;
}

/**
 * Create a subscription intent. Returns the hosted-checkout URL to
 * redirect the shopper to. See docs.xpaycheckout.com for the exact
 * body shape — the field names below match the current API.
 */
export async function createXpaySubscription(
  input: CreateSubscriptionInput,
): Promise<CreateSubscriptionResult> {
  const creds = await getXpayCredentials();
  // Per docs: interval MONTH/YEAR + intervalCount + cycleCount for
  // the billing frequency. cycleCount=0 isn't documented; we use a
  // large finite number (120 months / 10 years) as a proxy for
  // "recurring indefinitely" until XPay confirms otherwise.
  const isMonthly = input.billingCycle === 'monthly';
  const body = {
    amount: input.amountCents,
    currency: input.currency,
    interval: isMonthly ? 'MONTH' : 'YEAR',
    intervalCount: 1,
    cycleCount: isMonthly ? 120 : 10,
    receiptId: input.merchantReference,
    callbackUrl: input.callbackUrl,
    customerDetails: {
      name: input.customer.name,
      email: input.customer.email,
      contactNumber: input.customer.contactNumber,
    },
    metadata: {
      ...(input.metadata ?? {}),
      planName: input.planName,
      merchantReference: input.merchantReference,
    },
  };
  const res = await xpayFetch('/subscription/create', {
    method: 'POST',
    creds,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      ok: false,
      message:
        (res.body as { message?: string })?.message ??
        `XPay returned ${res.status}`,
      raw: res.body,
    };
  }
  const b = res.body as { subscriptionId?: string; fwdUrl?: string };
  return {
    ok: true,
    subscriptionId: b.subscriptionId,
    fwdUrl: b.fwdUrl,
    raw: res.body,
  };
}

export interface GetSubscriptionResult {
  ok: boolean;
  status?: 'ACTIVE' | 'PENDING' | 'CANCELED' | 'FAILED' | string;
  raw: unknown;
}

/** Server-side verification. Never trust callback params alone. */
export async function getXpaySubscription(
  subscriptionId: string,
): Promise<GetSubscriptionResult> {
  const creds = await getXpayCredentials();
  const res = await xpayFetch(
    `/subscription/get/${encodeURIComponent(subscriptionId)}`,
    { method: 'GET', creds },
  );
  if (!res.ok) return { ok: false, raw: res.body };
  const b = res.body as { status?: string };
  return { ok: true, status: b.status, raw: res.body };
}
