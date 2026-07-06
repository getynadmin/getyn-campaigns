/**
 * Phase 8 M8 — inbound-email provider adapter.
 *
 * The parser normalizes Resend + SendGrid webhook payloads into a
 * common shape. Both adapters are pure functions — this covers the
 * happy path + robustness on malformed / missing fields.
 */
import { describe, expect, it } from 'vitest';

import { parseInbound } from '@/server/inbound/parse-payload';

describe('parseInbound — Resend adapter', () => {
  it('parses a well-formed inbound event', () => {
    const raw = {
      type: 'inbound.email.received',
      created_at: '2026-01-01T00:00:00Z',
      data: {
        email_id: 'inbound_abc123',
        from: { email: 'Jane@Example.com', name: 'Jane Doe' },
        to: ['reply+cAAA.BBB@reply.getyn.com'],
        subject: 'Re: Welcome!',
        html: '<p>Thanks — sounds good.</p>',
        text: 'Thanks — sounds good.',
        headers: {
          'in-reply-to': '<orig-msg-id@resend>',
          references: '<a@x> <b@x>',
        },
      },
    };
    const result = parseInbound(raw, 'resend');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.messageId).toBe('inbound_abc123');
    expect(result.parsed.fromAddress).toBe('jane@example.com');
    expect(result.parsed.fromName).toBe('Jane Doe');
    expect(result.parsed.toAddress).toBe('reply+caaa.bbb@reply.getyn.com');
    expect(result.parsed.subject).toBe('Re: Welcome!');
    expect(result.parsed.bodyText).toBe('Thanks — sounds good.');
    expect(result.parsed.inReplyTo).toBe('<orig-msg-id@resend>');
    expect(result.parsed.referencesHeader).toEqual(['<a@x>', '<b@x>']);
  });

  it('fails when the to address is missing', () => {
    const raw = { data: { from: { email: 'x@y.com' } } };
    const result = parseInbound(raw, 'resend');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/to address/);
  });

  it('fails when the from address is missing', () => {
    const raw = { data: { to: ['reply+cX@getyn.com'] } };
    const result = parseInbound(raw, 'resend');
    expect(result.ok).toBe(false);
  });

  it('handles missing subject/body gracefully by leaving them empty', () => {
    const raw = {
      data: {
        from: { email: 'sender@example.com' },
        to: ['reply+cAAA@reply.getyn.com'],
      },
    };
    const result = parseInbound(raw, 'resend');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.subject).toBe('');
    expect(result.parsed.bodyHtml).toBe('');
    expect(result.parsed.bodyText).toBe('');
    expect(result.parsed.referencesHeader).toEqual([]);
  });

  it('lowercases the to and from addresses for stable matching', () => {
    const raw = {
      data: {
        from: { email: 'MIXED@Case.COM' },
        to: ['REPLY+cUpper@Reply.Getyn.Com'],
      },
    };
    const result = parseInbound(raw, 'resend');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.fromAddress).toBe('mixed@case.com');
    expect(result.parsed.toAddress).toBe('reply+cupper@reply.getyn.com');
  });
});

describe('parseInbound — SendGrid adapter', () => {
  it('parses a display-name From line', () => {
    const raw = {
      from: '"Jane Doe" <jane@example.com>',
      to: 'reply+cX@reply.getyn.com',
      subject: 'Re: Welcome!',
      html: '<p>Yes</p>',
      text: 'Yes',
      headers: 'In-Reply-To: <orig@example.com>\r\nReferences: <a@x> <b@x>\r\nMessage-ID: <sg-inbound-123@sg>',
    };
    const result = parseInbound(raw, 'sendgrid');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.fromAddress).toBe('jane@example.com');
    expect(result.parsed.fromName).toBe('Jane Doe');
    expect(result.parsed.inReplyTo).toBe('<orig@example.com>');
    expect(result.parsed.referencesHeader).toEqual(['<a@x>', '<b@x>']);
    expect(result.parsed.messageId).toBe('<sg-inbound-123@sg>');
  });

  it('parses a bare-email From line', () => {
    const raw = {
      from: 'bare@example.com',
      to: 'reply+cX@reply.getyn.com',
      subject: 'x',
      html: '',
      text: '',
      headers: '',
    };
    const result = parseInbound(raw, 'sendgrid');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.fromAddress).toBe('bare@example.com');
    expect(result.parsed.fromName).toBeNull();
  });

  it('fails when to is missing', () => {
    const raw = { from: 'x@y.com', subject: 's', text: 't', headers: '' };
    const result = parseInbound(raw, 'sendgrid');
    expect(result.ok).toBe(false);
  });
});

describe('parseInbound — invariants', () => {
  it('rejects non-object payloads', () => {
    const result = parseInbound(null, 'resend');
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown provider', () => {
    const result = parseInbound({}, 'mailgun' as unknown as 'resend');
    expect(result.ok).toBe(false);
  });
});
