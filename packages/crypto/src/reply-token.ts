/**
 * Phase 8 M1 — Reply-routing token codec.
 *
 * When we send an outbound email (campaign, agent, automation) we set
 *
 *   Reply-To: reply+<token>@reply.getyn.com
 *
 * where <token> is the output of `encodeReplyToken`. When the inbound
 * webhook fires, the worker calls `decodeReplyToken` to figure out
 * which record the reply belongs to and fans out.
 *
 * Format:
 *
 *   <kind><b64url(payload)>.<b64url(sig)>
 *
 * where:
 *   - kind is one of 'c' | 'a' | 'w' — see ReplyTokenKind below.
 *   - payload = JSON.stringify({id, tenantId, nodeId?})
 *   - sig    = HMAC-SHA256(kind + b64url(payload), secret)
 *
 * The signature covers both the kind byte AND the payload so an attacker
 * can't swap a valid campaign token into an agent slot.
 *
 * Secret comes from `REPLY_ROUTING_SECRET` — a random 32+ byte value.
 * Not rotatable without invalidating in-flight tokens; the operational
 * cost is a few days of dropped replies. Fine.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Which system the token routes to.
 *
 *   c — CampaignSend (one-off campaign reply)
 *   a — EmailAgentEnrollment (Email Agent conversation)
 *   w — AutomationEnrollment (drip campaign — 'w' for 'workflow'
 *       because 'a' was taken by Agent)
 */
export type ReplyTokenKind = 'c' | 'a' | 'w';

export interface ReplyTokenPayload {
  /** Target row id (CampaignSend / EmailAgentEnrollment / AutomationEnrollment). */
  id: string;
  /**
   * Owning tenant id. Redundant with the target row but included so
   * matching does not require a DB lookup just to decide which
   * tenant to attribute the InboundEmail to before routing succeeds.
   */
  tenantId: string;
  /**
   * Present only for AutomationEnrollment tokens — which node in the
   * workflow definition sent this email. Lets M3's reply handler tag
   * the reply against the specific node in analytics.
   */
  nodeId?: string;
}

export interface DecodedReplyToken {
  kind: ReplyTokenKind;
  payload: ReplyTokenPayload;
}

export type DecodeFailure =
  | 'malformed'
  | 'bad_kind'
  | 'bad_signature'
  | 'bad_payload'
  | 'missing_secret';

export type DecodeResult =
  | { ok: true; token: DecodedReplyToken }
  | { ok: false; reason: DecodeFailure; detail?: string };

const KIND_CHARS = new Set<ReplyTokenKind>(['c', 'a', 'w']);

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(kindChar: string, payloadB64: string, secret: string): string {
  return b64urlEncode(
    createHmac('sha256', secret).update(kindChar + payloadB64).digest(),
  );
}

/**
 * Encode a routing token. Throws if the secret is missing — caller
 * should short-circuit and skip Reply-To injection rather than send
 * an unroutable header.
 */
export function encodeReplyToken(
  kind: ReplyTokenKind,
  payload: ReplyTokenPayload,
  secret: string,
): string {
  if (!secret) {
    throw new Error('encodeReplyToken: secret is empty');
  }
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = sign(kind, payloadB64, secret);
  return `${kind}${payloadB64}.${sig}`;
}

/**
 * Decode + verify a routing token. Returns a discriminated result so
 * callers can log the specific failure reason on the InboundEmail
 * row (`processError`) instead of a generic 'bad token' string.
 */
export function decodeReplyToken(token: string, secret: string): DecodeResult {
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (typeof token !== 'string' || token.length < 4) {
    return { ok: false, reason: 'malformed', detail: 'too short' };
  }
  const kindChar = token[0] as ReplyTokenKind;
  if (!KIND_CHARS.has(kindChar)) {
    return { ok: false, reason: 'bad_kind', detail: `got '${kindChar}'` };
  }
  const rest = token.slice(1);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0 || dot >= rest.length - 1) {
    return { ok: false, reason: 'malformed', detail: 'no signature separator' };
  }
  const payloadB64 = rest.slice(0, dot);
  const sigB64 = rest.slice(dot + 1);

  const expected = createHmac('sha256', secret)
    .update(kindChar + payloadB64)
    .digest();
  let received: Buffer;
  try {
    received = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'bad signature encoding' };
  }
  if (received.length !== expected.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!timingSafeEqual(received, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: unknown;
  try {
    const raw = b64urlDecode(payloadB64).toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_payload', detail: 'not valid JSON' };
  }
  if (!isReplyTokenPayload(payload)) {
    return { ok: false, reason: 'bad_payload', detail: 'shape mismatch' };
  }
  return { ok: true, token: { kind: kindChar, payload } };
}

function isReplyTokenPayload(o: unknown): o is ReplyTokenPayload {
  if (!o || typeof o !== 'object') return false;
  const p = o as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.tenantId === 'string' &&
    p.tenantId.length > 0 &&
    (p.nodeId === undefined || typeof p.nodeId === 'string')
  );
}

/**
 * Build the full Reply-To local-part-and-address given a token and
 * the configured inbound domain. Returns null when either the secret
 * or the domain is missing — callers use this signal to skip the
 * header entirely rather than send `undefined@undefined`.
 */
export function buildReplyToAddress(
  kind: ReplyTokenKind,
  payload: ReplyTokenPayload,
  opts: { secret: string | null; inboundDomain: string | null },
): string | null {
  if (!opts.secret || !opts.inboundDomain) return null;
  const token = encodeReplyToken(kind, payload, opts.secret);
  return `reply+${token}@${opts.inboundDomain}`;
}

/**
 * Parse a To: address of the form `reply+<token>@<domain>` back into
 * a token string. Returns null on any format issue — the token
 * decoder runs afterwards and reports the specific decode failure.
 */
export function extractTokenFromAddress(toAddress: string): string | null {
  if (typeof toAddress !== 'string') return null;
  const at = toAddress.indexOf('@');
  const local = at === -1 ? toAddress : toAddress.slice(0, at);
  const trimmed = local.trim().toLowerCase().startsWith('reply+')
    ? local.slice('reply+'.length)
    : null;
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
