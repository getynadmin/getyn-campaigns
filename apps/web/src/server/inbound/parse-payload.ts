/**
 * Phase 8 M1 — provider-agnostic inbound-email parser.
 *
 * The web's /api/webhooks/inbound-email route accepts a raw JSON body
 * from either Resend inbound parsing (default) or SendGrid Inbound
 * Parse (fallback, behind INBOUND_PROVIDER=sendgrid). This module
 * normalizes both to a common shape the persistence step and the
 * worker's routing step can consume without knowing which vendor
 * fired.
 *
 * If we ever need to move providers, adding a new adapter here and
 * flipping the env var is the whole migration.
 */

export interface ParsedInboundEmail {
  /** Vendor-assigned message id (Resend inbound id, SendGrid parse id, or a synthesized one). */
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddress: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  /** RFC 5322 In-Reply-To header — secondary matching signal. */
  inReplyTo: string | null;
  /** RFC 5322 References header, split on whitespace. */
  referencesHeader: string[];
}

export type InboundProvider = 'resend' | 'sendgrid';

export interface ParseFailure {
  ok: false;
  reason: string;
}
export interface ParseSuccess {
  ok: true;
  parsed: ParsedInboundEmail;
}
export type ParseResult = ParseSuccess | ParseFailure;

export function parseInbound(
  raw: unknown,
  provider: InboundProvider,
): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'payload not an object' };
  }
  if (provider === 'resend') return parseResend(raw as Record<string, unknown>);
  if (provider === 'sendgrid') return parseSendgrid(raw as Record<string, unknown>);
  return { ok: false, reason: `unknown provider ${String(provider)}` };
}

/**
 * Resend inbound webhook shape (based on docs at time of writing):
 *
 * {
 *   "type": "inbound.email.received",
 *   "created_at": "...",
 *   "data": {
 *     "email_id": "…",
 *     "from": { "email": "...", "name": "..." },
 *     "to": ["reply+token@reply.getyn.com"],
 *     "subject": "...",
 *     "html": "...",
 *     "text": "...",
 *     "headers": { "in-reply-to": "...", "references": "..." }
 *   }
 * }
 *
 * We accept partial payloads — anything missing lands as null / empty
 * so the InboundEmail row is still persisted for debugging.
 */
function parseResend(raw: Record<string, unknown>): ParseResult {
  const data = (raw['data'] ?? raw) as Record<string, unknown>;
  const from = (data['from'] ?? {}) as Record<string, unknown>;
  const to = data['to'];
  const toAddress = Array.isArray(to) ? String(to[0] ?? '') : String(to ?? '');
  if (!toAddress) return { ok: false, reason: 'missing to address' };

  const fromAddress = String(from['email'] ?? data['from_email'] ?? '');
  if (!fromAddress) return { ok: false, reason: 'missing from address' };

  const headers = (data['headers'] ?? {}) as Record<string, unknown>;
  const inReplyToRaw = headers['in-reply-to'] ?? headers['In-Reply-To'];
  const referencesRaw = headers['references'] ?? headers['References'];

  return {
    ok: true,
    parsed: {
      messageId: (data['email_id'] as string) ?? (data['id'] as string) ?? null,
      fromAddress: fromAddress.toLowerCase(),
      fromName: (from['name'] as string) || null,
      toAddress: toAddress.toLowerCase(),
      subject: (data['subject'] as string) ?? '',
      bodyHtml: (data['html'] as string) ?? '',
      bodyText: (data['text'] as string) ?? '',
      inReplyTo: typeof inReplyToRaw === 'string' ? inReplyToRaw : null,
      referencesHeader:
        typeof referencesRaw === 'string'
          ? referencesRaw.split(/\s+/).filter(Boolean)
          : [],
    },
  };
}

/**
 * SendGrid Inbound Parse comes in as multipart/form-data. Our webhook
 * route pre-parses it into a plain object before calling us. Shape:
 *
 *   from: "Name <email@x.com>" | "email@x.com"
 *   to: "reply+token@reply.getyn.com"
 *   subject, html, text, headers, ...
 *
 * The From header can carry a display name — split it here.
 */
function parseSendgrid(raw: Record<string, unknown>): ParseResult {
  const fromRaw = String(raw['from'] ?? '');
  const { email: fromAddress, name: fromName } = splitAddressLine(fromRaw);
  if (!fromAddress) return { ok: false, reason: 'missing from address' };
  const toAddress = String(raw['to'] ?? '').toLowerCase();
  if (!toAddress) return { ok: false, reason: 'missing to address' };

  const rawHeaders = String(raw['headers'] ?? '');
  const headers = parseHeaderBlock(rawHeaders);

  return {
    ok: true,
    parsed: {
      messageId: headers.get('message-id') ?? null,
      fromAddress: fromAddress.toLowerCase(),
      fromName,
      toAddress,
      subject: String(raw['subject'] ?? ''),
      bodyHtml: String(raw['html'] ?? ''),
      bodyText: String(raw['text'] ?? ''),
      inReplyTo: headers.get('in-reply-to') ?? null,
      referencesHeader: (headers.get('references') ?? '')
        .split(/\s+/)
        .filter(Boolean),
    },
  };
}

/**
 * Parse `Name <email>` or bare `email` into components. Handles the
 * common cases; doesn't try to be a full RFC 5322 parser.
 */
function splitAddressLine(line: string): { email: string; name: string | null } {
  const m = /^\s*(?:"?([^"]*?)"?\s*)?<([^>]+)>\s*$/.exec(line);
  if (m) {
    return { email: (m[2] ?? '').trim(), name: (m[1] ?? '').trim() || null };
  }
  return { email: line.trim(), name: null };
}

function parseHeaderBlock(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key && value) out.set(key, value);
  }
  return out;
}
