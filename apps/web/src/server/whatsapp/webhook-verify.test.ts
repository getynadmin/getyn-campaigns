/**
 * Phase 4 M9 / M12 — Meta webhook signature verification.
 */
import {
  signMetaWebhook,
  verifyMetaWebhookSignature,
} from './webhook-verify';
import { describe, expect, it } from 'vitest';

const SECRET = 'super-secret-app-secret';
const BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

describe('verifyMetaWebhookSignature', () => {
  it('accepts a correctly-signed body', () => {
    const sig = signMetaWebhook(SECRET, BODY);
    expect(verifyMetaWebhookSignature(SECRET, BODY, sig)).toBe(true);
  });

  it('accepts header without the sha256= prefix', () => {
    const sig = signMetaWebhook(SECRET, BODY);
    const bare = sig.replace(/^sha256=/, '');
    expect(verifyMetaWebhookSignature(SECRET, BODY, bare)).toBe(true);
  });

  it('rejects when the body is altered by one byte', () => {
    const sig = signMetaWebhook(SECRET, BODY);
    expect(verifyMetaWebhookSignature(SECRET, BODY + ' ', sig)).toBe(false);
  });

  it('rejects when the secret is wrong', () => {
    const sig = signMetaWebhook(SECRET, BODY);
    expect(verifyMetaWebhookSignature('different-secret', BODY, sig)).toBe(false);
  });

  it('rejects empty / null / undefined headers', () => {
    expect(verifyMetaWebhookSignature(SECRET, BODY, null)).toBe(false);
    expect(verifyMetaWebhookSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyMetaWebhookSignature(SECRET, BODY, '')).toBe(false);
  });

  it('rejects malformed hex without throwing', () => {
    expect(
      verifyMetaWebhookSignature(SECRET, BODY, 'sha256=zzz-not-hex'),
    ).toBe(false);
  });

  it('rejects when secret is empty string', () => {
    const sig = signMetaWebhook(SECRET, BODY);
    expect(verifyMetaWebhookSignature('', BODY, sig)).toBe(false);
  });

  it('verifies large bodies (boundary check)', () => {
    const big = 'x'.repeat(50_000);
    const sig = signMetaWebhook(SECRET, big);
    expect(verifyMetaWebhookSignature(SECRET, big, sig)).toBe(true);
  });
});
