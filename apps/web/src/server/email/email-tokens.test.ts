import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signEmailToken, verifyEmailToken } from '@getyn/db';

/**
 * Round-trip tests for the unsubscribe + web-view tokens. EMAIL_TOKEN_SECRET
 * is set just for this suite so the test runs deterministically without
 * depending on .env.local.
 */

let originalSecret: string | undefined;
beforeAll(() => {
  originalSecret = process.env.EMAIL_TOKEN_SECRET;
  process.env.EMAIL_TOKEN_SECRET =
    'test-secret-test-secret-test-secret-1234'; // 40 chars
});
afterAll(() => {
  process.env.EMAIL_TOKEN_SECRET = originalSecret;
});

describe('email-tokens — signing + verifying', () => {
  it('round-trips an unsubscribe token', () => {
    const token = signEmailToken({
      campaignSendId: 'send-123',
      tenantId: 'tenant-456',
      kind: 'unsubscribe',
    });
    const v = verifyEmailToken(token);
    expect(v.campaignSendId).toBe('send-123');
    expect(v.tenantId).toBe('tenant-456');
    expect(v.kind).toBe('unsubscribe');
  });

  it('round-trips a webview token', () => {
    const token = signEmailToken({
      campaignSendId: 'send-789',
      tenantId: 'tenant-456',
      kind: 'webview',
    });
    const v = verifyEmailToken(token);
    expect(v.kind).toBe('webview');
  });

  it('rejects a tampered payload (different campaignSendId encoded)', () => {
    // Sign tokens for two different sends. Take A's payload + B's sig
    // (or vice versa) — the signatures should not match.
    const tokenA = signEmailToken({
      campaignSendId: 'send-A',
      tenantId: 'tenant-1',
      kind: 'unsubscribe',
    });
    const tokenB = signEmailToken({
      campaignSendId: 'send-B',
      tenantId: 'tenant-1',
      kind: 'unsubscribe',
    });
    const [payloadA] = tokenA.split('.');
    const [, sigB] = tokenB.split('.');
    expect(() => verifyEmailToken(`${payloadA}.${sigB}`)).toThrow();
  });

  it('rejects a tampered signature', () => {
    const token = signEmailToken({
      campaignSendId: 'send-123',
      tenantId: 'tenant-456',
      kind: 'unsubscribe',
    });
    const [payload, sig] = token.split('.');
    const tamperedSig = (sig ?? '').replace(/^(.)/, (c) =>
      c === 'A' ? 'B' : 'A',
    );
    expect(() =>
      verifyEmailToken(`${payload}.${tamperedSig}`),
    ).toThrow();
  });

  it('rejects expired tokens', () => {
    // ttlSeconds = -1 → already expired at sign time.
    const token = signEmailToken({
      campaignSendId: 'send-123',
      tenantId: 'tenant-456',
      kind: 'unsubscribe',
      ttlSeconds: -1,
    });
    expect(() => verifyEmailToken(token)).toThrow(/expired/i);
  });

  it('rejects malformed tokens missing the separator', () => {
    expect(() => verifyEmailToken('garbage-no-dot')).toThrow();
  });

  it('rejects an empty token', () => {
    expect(() => verifyEmailToken('')).toThrow();
  });

  it('produces different tokens for different sends', () => {
    const a = signEmailToken({
      campaignSendId: 'send-A',
      tenantId: 'tenant-1',
      kind: 'unsubscribe',
    });
    const b = signEmailToken({
      campaignSendId: 'send-B',
      tenantId: 'tenant-1',
      kind: 'unsubscribe',
    });
    expect(a).not.toBe(b);
  });

  it('produces different tokens for different kinds', () => {
    const u = signEmailToken({
      campaignSendId: 'send-1',
      tenantId: 'tenant-1',
      kind: 'unsubscribe',
    });
    const v = signEmailToken({
      campaignSendId: 'send-1',
      tenantId: 'tenant-1',
      kind: 'webview',
    });
    expect(u).not.toBe(v);
  });

  it('verified token includes expSeconds in the future', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signEmailToken({
      campaignSendId: 'send-1',
      tenantId: 'tenant-1',
      kind: 'unsubscribe',
    });
    const v = verifyEmailToken(token);
    expect(v.expSeconds).toBeGreaterThan(before);
  });
});
