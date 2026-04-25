import { describe, expect, it } from 'vitest';

import { scanCampaignContent } from './content-scanner';

/**
 * Content scanner tests — pure unit tests over the pre-send heuristics
 * that gate `campaign.schedule` / `campaign.sendNow`. Every rule the
 * scanner applies has at least one positive case and one negative case.
 */

const baseInput = {
  fromEmail: 'team@mail.acme.dev',
  renderedHtml: null,
};

describe('scanCampaignContent — subject', () => {
  it('errors on empty subject', () => {
    const r = scanCampaignContent({ ...baseInput, subject: '' });
    expect(r.hasErrors).toBe(true);
    expect(r.issues.find((i) => i.message.includes('empty'))).toBeDefined();
  });

  it('errors on subject over 200 chars', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'a'.repeat(201),
    });
    expect(r.hasErrors).toBe(true);
  });

  it('warns on mostly-uppercase subject', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'BUY NOW OR REGRET FOREVER',
    });
    expect(r.hasWarnings).toBe(true);
    expect(
      r.issues.find((i) => i.message.toLowerCase().includes('uppercase')),
    ).toBeDefined();
  });

  it('does not warn on mixed-case subject of similar length', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Our spring sale starts tomorrow',
    });
    expect(r.issues.find((i) => i.message.includes('uppercase'))).toBeUndefined();
  });

  it('warns on three or more exclamation marks', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Big news! Open now! Limited time!',
    });
    expect(r.hasWarnings).toBe(true);
    expect(
      r.issues.find((i) => i.message.includes('exclamation')),
    ).toBeDefined();
  });

  it('does not warn at one exclamation mark', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Hello there!',
    });
    expect(
      r.issues.find((i) => i.message.includes('exclamation')),
    ).toBeUndefined();
  });

  it('flags the "click here" spam phrase', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Click here for our newsletter',
    });
    expect(r.hasWarnings).toBe(true);
  });

  it('flags the $$$ spam phrase', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: '$$$ savings inside',
    });
    expect(r.hasWarnings).toBe(true);
  });
});

describe('scanCampaignContent — A/B variants', () => {
  const ab = {
    enabled: true as const,
    variants: [
      { id: 'A' as const, subject: 'Variant A subject' },
      { id: 'B' as const, subject: '' }, // empty
    ] as [
      { id: 'A'; subject: string },
      { id: 'B'; subject: string },
    ],
    testPercent: 20,
    winnerMetric: 'open_rate' as const,
    winnerDecisionAfterMinutes: 240,
    status: 'pending' as const,
    winnerVariantId: null,
    winnerDecidedAt: null,
    minSendsPerVariant: 100,
  };

  it('checks every variant, not just the active subject', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Ignored when abTest is set',
      abTest: ab,
    });
    expect(r.hasErrors).toBe(true);
    // Specifically: variant B is empty.
    expect(
      r.issues.find((i) =>
        i.message.toLowerCase().includes('variant b'),
      ),
    ).toBeDefined();
  });
});

describe('scanCampaignContent — body', () => {
  it('errors when renderedHtml has < 20 visible chars', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Hello',
      renderedHtml: '<html><body>hi</body></html>',
    });
    expect(r.hasErrors).toBe(true);
    expect(
      r.issues.find((i) => i.message.includes('text content')),
    ).toBeDefined();
  });

  it('warns on heavy image-to-text ratio', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Hello',
      renderedHtml:
        '<html><body>Short text {{unsubscribeUrl}}<img src="a"/><img src="b"/><img src="c"/></body></html>',
    });
    expect(r.hasWarnings).toBe(true);
    expect(r.issues.find((i) => i.message.includes('mostly images'))).toBeDefined();
  });

  it('errors when body lacks an unsubscribe link', () => {
    const longBody =
      'Hello there. This is a normal-length email body with some text content but no unsubscribe link or merge tag.';
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Hello',
      renderedHtml: `<html><body>${longBody}</body></html>`,
    });
    expect(r.hasErrors).toBe(true);
    expect(
      r.issues.find((i) => i.message.toLowerCase().includes('unsubscribe')),
    ).toBeDefined();
  });

  it('accepts {{unsubscribeUrl}} as the unsubscribe link', () => {
    const longBody =
      'Hello there. This is a normal-length email body with some text content. {{unsubscribeUrl}}';
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Hello',
      renderedHtml: `<html><body>${longBody}</body></html>`,
    });
    expect(
      r.issues.find((i) => i.message.includes('Missing unsubscribe link')),
    ).toBeUndefined();
  });

  it('accepts a literal /u/ URL as the unsubscribe link', () => {
    const longBody =
      'Hello there. This is a normal-length email body with some text content. <a href="https://example.com/u/abc">click</a>';
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Hello',
      renderedHtml: `<html><body>${longBody}</body></html>`,
    });
    expect(
      r.issues.find((i) => i.message.includes('Missing unsubscribe link')),
    ).toBeUndefined();
  });
});

describe('scanCampaignContent — fromEmail', () => {
  it('errors on a malformed from address', () => {
    const r = scanCampaignContent({
      ...baseInput,
      subject: 'Hello',
      fromEmail: 'not-an-email',
    });
    expect(r.hasErrors).toBe(true);
  });
});
