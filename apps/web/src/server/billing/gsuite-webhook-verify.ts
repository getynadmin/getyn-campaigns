/**
 * Phase 5 M4 — G-Suite webhook signature verification.
 *
 * Mirrors the Resend + Meta receivers. HMAC-SHA256 over the raw body
 * with GSUITE_WEBHOOK_SECRET. Header name follows the kickoff
 * contract assumption (`X-GSuite-Signature`); if the real G-Suite
 * team picks a different name, only this file changes.
 *
 * Constant-time compare prevents timing oracles.
 */
import { createHmac, timingSafeEqual } from 'crypto';

const HEADER_NAME = 'x-gsuite-signature';

export function verifyGsuiteWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  // Header format expected: `sha256=<hex>`. Accept the bare hex too.
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const GSUITE_SIGNATURE_HEADER = HEADER_NAME;
