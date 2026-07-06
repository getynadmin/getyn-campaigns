/**
 * Phase 8 M8 — reply-routing token codec.
 *
 * Fixture secret used across the file; the codec doesn't touch env
 * except through the callsite so we pass explicitly.
 */
import { describe, expect, it } from 'vitest';

import {
  buildReplyToAddress,
  decodeReplyToken,
  encodeReplyToken,
  extractTokenFromAddress,
} from '@getyn/crypto';

const SECRET = 'test-secret-32-bytes-of-random-material-abcd';

describe('encodeReplyToken / decodeReplyToken', () => {
  it('round-trips a campaign token', () => {
    const payload = {
      id: 'clabc1234567890abcdef1234',
      tenantId: 'cltenant1234567890abcdef',
    };
    const token = encodeReplyToken('c', payload, SECRET);
    const decoded = decodeReplyToken(token, SECRET);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return; // narrow for TS
    expect(decoded.token.kind).toBe('c');
    expect(decoded.token.payload).toEqual(payload);
  });

  it('round-trips an agent token', () => {
    const payload = {
      id: 'clenroll1234567890abcdefg',
      tenantId: 'cltenantxyz1234567890abcd',
    };
    const token = encodeReplyToken('a', payload, SECRET);
    const decoded = decodeReplyToken(token, SECRET);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.token.kind).toBe('a');
  });

  it('round-trips an automation token with nodeId', () => {
    const payload = {
      id: 'clautoenroll1234567890abc',
      tenantId: 'cltenant000011112222aaaa',
      nodeId: 'email-node-3',
    };
    const token = encodeReplyToken('w', payload, SECRET);
    const decoded = decodeReplyToken(token, SECRET);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.token.payload.nodeId).toBe('email-node-3');
  });

  it('rejects a tampered payload', () => {
    const token = encodeReplyToken(
      'c',
      { id: 'aaa', tenantId: 'bbb' },
      SECRET,
    );
    // Swap the first payload byte for another b64url char — signature
    // no longer covers the mutated payload.
    const dot = token.lastIndexOf('.');
    const [kind, rest] = [token[0]!, token.slice(1, dot)];
    const sig = token.slice(dot);
    const mutated = `${kind}${rest[0] === 'A' ? 'B' : 'A'}${rest.slice(1)}${sig}`;
    const decoded = decodeReplyToken(mutated, SECRET);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('bad_signature');
  });

  it('rejects a token signed with a different secret', () => {
    const token = encodeReplyToken(
      'c',
      { id: 'aaa', tenantId: 'bbb' },
      SECRET,
    );
    const decoded = decodeReplyToken(token, 'wrong-secret-of-different-material');
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('bad_signature');
  });

  it('rejects a token with an unknown kind byte', () => {
    // Manually construct a token with an invalid prefix.
    const token = encodeReplyToken('c', { id: 'x', tenantId: 'y' }, SECRET);
    const swapped = `z${token.slice(1)}`;
    const decoded = decodeReplyToken(swapped, SECRET);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('bad_kind');
  });

  it('rejects malformed tokens (missing signature separator)', () => {
    const decoded = decodeReplyToken('cAAAAA', SECRET);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('malformed');
  });

  it('rejects when secret is empty', () => {
    const token = encodeReplyToken('c', { id: 'a', tenantId: 'b' }, SECRET);
    const decoded = decodeReplyToken(token, '');
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('missing_secret');
  });

  it('throws on encode with empty secret', () => {
    expect(() => encodeReplyToken('c', { id: 'a', tenantId: 'b' }, '')).toThrow();
  });

  it('signature covers the kind byte — a valid campaign token cannot be re-cast as an agent token', () => {
    const payload = { id: 'aaa', tenantId: 'bbb' };
    const campaignToken = encodeReplyToken('c', payload, SECRET);
    // Swap the kind byte only.
    const spoofed = `a${campaignToken.slice(1)}`;
    const decoded = decodeReplyToken(spoofed, SECRET);
    expect(decoded.ok).toBe(false);
  });
});

describe('buildReplyToAddress', () => {
  it('returns null when secret is missing', () => {
    const addr = buildReplyToAddress(
      'c',
      { id: 'a', tenantId: 'b' },
      { secret: null, inboundDomain: 'reply.getyn.com' },
    );
    expect(addr).toBeNull();
  });

  it('returns null when inbound domain is missing', () => {
    const addr = buildReplyToAddress(
      'c',
      { id: 'a', tenantId: 'b' },
      { secret: SECRET, inboundDomain: null },
    );
    expect(addr).toBeNull();
  });

  it('produces a routable +token address', () => {
    const addr = buildReplyToAddress(
      'c',
      { id: 'a', tenantId: 'b' },
      { secret: SECRET, inboundDomain: 'reply.getyn.com' },
    );
    expect(addr).toMatch(/^reply\+c.+@reply\.getyn\.com$/);
  });
});

describe('extractTokenFromAddress', () => {
  it('extracts the token from a reply+ address', () => {
    const t = extractTokenFromAddress('reply+cAAAA.BBBB@reply.getyn.com');
    expect(t).toBe('cAAAA.BBBB');
  });

  it('is case-insensitive on the local part prefix', () => {
    const t = extractTokenFromAddress('Reply+cX.Y@reply.getyn.com');
    expect(t).toBe('cX.Y');
  });

  it('returns null when the local part does not start with reply+', () => {
    const t = extractTokenFromAddress('marketing+foo@getyn.com');
    expect(t).toBeNull();
  });

  it('returns null on non-string input', () => {
    const t = extractTokenFromAddress(undefined as unknown as string);
    expect(t).toBeNull();
  });
});
