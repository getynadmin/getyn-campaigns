// Bare `crypto` (no `node:` prefix) — works in both Node runtime and
// Next.js's client-bundle webpack, where the `node:` scheme is rejected.
// Functions below only run on server paths (route handlers, worker
// handlers); the client-side bundle that pulls this file via the
// `@getyn/db` barrel never CALLS them, so webpack stubbing crypto to an
// empty module is harmless at runtime.
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed tokens for the unsubscribe (`/u/{token}`) and web-view
 * (`/v/{token}`) URLs embedded in every email.
 *
 * Format: `${payloadB64}.${signatureB64}` (URL-safe base64, no padding).
 * Payload is `${campaignSendId}|${tenantId}|${kind}|${expSeconds}`.
 *
 * Why not JWT? JWT brings a massive amount of complexity (alg field, kid,
 * jose / jsonwebtoken deps) for a single-purpose signed value. We don't
 * need cross-issuer interop, multiple algs, or claim semantics — just an
 * unforgeable bearer token that the same app can verify.
 *
 * The shared secret comes from `EMAIL_TOKEN_SECRET` env (must be set on
 * Vercel + Railway). Rotating it invalidates every outstanding email's
 * unsubscribe link — accept that cost during a rotation, treat the
 * value like a database password.
 *
 * Tokens are bearer credentials. Anyone with one can act on behalf of the
 * recipient (unsubscribe them). Treat URLs containing them as
 * confidential — never log, never echo to clients other than the
 * recipient.
 */

export type EmailTokenKind = 'unsubscribe' | 'webview';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function urlSafeBase64(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function urlSafeBase64Decode(s: string): Buffer {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function getSecret(): string {
  const s = process.env.EMAIL_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'EMAIL_TOKEN_SECRET must be set to a 32+ char random string in env.',
    );
  }
  return s;
}

export function signEmailToken(args: {
  campaignSendId: string;
  tenantId: string;
  kind: EmailTokenKind;
  ttlSeconds?: number;
}): string {
  const exp = Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload = `${args.campaignSendId}|${args.tenantId}|${args.kind}|${exp}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest();
  return `${urlSafeBase64(Buffer.from(payload))}.${urlSafeBase64(sig)}`;
}

export interface VerifiedEmailToken {
  campaignSendId: string;
  tenantId: string;
  kind: EmailTokenKind;
  expSeconds: number;
}

export function verifyEmailToken(token: string): VerifiedEmailToken {
  const dot = token.indexOf('.');
  if (dot < 0) throw new Error('Malformed token.');
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const payload = urlSafeBase64Decode(payloadB64).toString('utf-8');

  const expectedSig = createHmac('sha256', getSecret())
    .update(payload)
    .digest();
  const givenSig = urlSafeBase64Decode(sigB64);
  if (
    expectedSig.length !== givenSig.length ||
    !timingSafeEqual(expectedSig, givenSig)
  ) {
    throw new Error('Token signature mismatch.');
  }

  const parts = payload.split('|');
  if (parts.length !== 4)
    throw new Error('Malformed payload — expected 4 fields.');
  const [campaignSendId, tenantId, kindRaw, expRaw] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (kindRaw !== 'unsubscribe' && kindRaw !== 'webview') {
    throw new Error(`Unknown kind "${kindRaw}".`);
  }
  const expSeconds = parseInt(expRaw, 10);
  if (Number.isNaN(expSeconds)) {
    throw new Error('Malformed exp field.');
  }
  if (Math.floor(Date.now() / 1000) > expSeconds) {
    throw new Error('Token expired.');
  }
  return {
    campaignSendId,
    tenantId,
    kind: kindRaw,
    expSeconds,
  };
}
