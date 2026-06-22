/**
 * AdminCentral → Campaigns SSO token verifier.
 *
 * Token format (single string, dot-separated):
 *
 *   <payloadB64Url>.<hmacB64Url>
 *
 * where:
 *   - payloadB64Url = base64url(JSON.stringify(payload))
 *   - hmacB64Url    = base64url(HMAC-SHA256(payloadB64Url, secret))
 *
 * The signing secret is shared with AdminCentral via the env var
 * `APP_SSO_SIGNING_SECRET`. Both sides must rotate it together — a
 * mismatch surfaces here as VerifyError('bad_signature').
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SsoPayload {
  email: string;
  ownerEmail: string;
  appSlug: 'campaigns';
  tenantId: string;
  name: string;
  role: 'owner' | 'member';
  provision: boolean;
  plan: {
    slug: string;
    name: string;
    /** Monthly email send quota — surfaced as the EMAILS_PER_MONTH limit. */
    emailsAllowed: number;
  };
  /** Unix epoch milliseconds — token expires past this. */
  exp: number;
}

export type VerifyFailure =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'wrong_app'
  | 'missing_secret';

export type VerifyResult =
  | { ok: true; payload: SsoPayload }
  | { ok: false; reason: VerifyFailure; detail?: string };

function b64urlDecode(s: string): Buffer {
  // Base64-URL → base64 (replace `-_` with `+/`, pad to multiple of 4).
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function isSsoPayload(o: unknown): o is SsoPayload {
  if (!o || typeof o !== 'object') return false;
  const p = o as Record<string, unknown>;
  return (
    typeof p.email === 'string' &&
    typeof p.ownerEmail === 'string' &&
    typeof p.appSlug === 'string' &&
    typeof p.tenantId === 'string' &&
    typeof p.name === 'string' &&
    (p.role === 'owner' || p.role === 'member') &&
    typeof p.provision === 'boolean' &&
    typeof p.exp === 'number' &&
    p.plan !== null &&
    typeof p.plan === 'object' &&
    typeof (p.plan as Record<string, unknown>).slug === 'string' &&
    typeof (p.plan as Record<string, unknown>).name === 'string' &&
    typeof (p.plan as Record<string, unknown>).emailsAllowed === 'number'
  );
}

export function verifySsoToken(token: string): VerifyResult {
  const secret = process.env.APP_SSO_SIGNING_SECRET;
  if (!secret) {
    return {
      ok: false,
      reason: 'missing_secret',
      detail:
        'APP_SSO_SIGNING_SECRET is not set on this deploy — refusing to verify SSO tokens.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, reason: 'malformed', detail: 'expected two segments' };
  }
  const [payloadEncoded, signatureEncoded] = parts;
  if (!payloadEncoded || !signatureEncoded) {
    return { ok: false, reason: 'malformed' };
  }

  // Constant-time signature comparison. Both sides must encode the
  // HMAC the same way (raw bytes → base64url). We decode the
  // claimant's signature and compare buffers byte-by-byte.
  const expected = createHmac('sha256', secret).update(payloadEncoded).digest();
  let candidate: Buffer;
  try {
    candidate = b64urlDecode(signatureEncoded);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'bad signature encoding' };
  }
  if (candidate.length !== expected.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!timingSafeEqual(candidate, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Signature verified — now parse and validate the payload.
  let payloadJson: string;
  try {
    payloadJson = b64urlDecode(payloadEncoded).toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed', detail: 'bad payload encoding' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'payload not JSON' };
  }
  if (!isSsoPayload(parsed)) {
    return { ok: false, reason: 'malformed', detail: 'payload shape invalid' };
  }
  if (parsed.appSlug !== 'campaigns') {
    return {
      ok: false,
      reason: 'wrong_app',
      detail: `token issued for "${parsed.appSlug}", not campaigns`,
    };
  }
  if (parsed.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload: parsed };
}
