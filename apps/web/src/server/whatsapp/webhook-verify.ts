/**
 * Meta webhook signature verification (Phase 4 M9 / M12).
 *
 * Extracted into its own helper so unit tests can hit it directly
 * without faking the full Next.js Request lifecycle.
 *
 * Meta's contract:
 *   X-Hub-Signature-256: sha256=<hex digest>
 *   digest = HMAC-SHA256(appSecret, raw-request-body)
 */
import { createHmac, timingSafeEqual } from 'crypto';

export function verifyMetaWebhookSignature(
  appSecret: string,
  rawBody: string,
  header: string | null | undefined,
): boolean {
  if (!header || !appSecret) return false;
  const provided = header.startsWith('sha256=')
    ? header.slice('sha256='.length)
    : header;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Compute Meta's signed-content hex digest. Used by tests to forge a
 * valid signature; runtime callers should never need this.
 */
export function signMetaWebhook(appSecret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
