/**
 * Phase 7 M3 — composer unit tests.
 *
 * Focused on the composer's logic: token substitution, brand-default
 * merging, footer enforcement, validation. Mocks the EmailBlockTemplate
 * lookup with inline fixtures so the suite stays self-contained.
 *
 * The "every seeded block renders against Unlayer" check happens at
 * M8 smoke-test time against the real database — we can't load
 * Unlayer in a Node test environment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@getyn/db', () => ({
  EmailBlockCategory: {
    HERO: 'HERO',
    CONTENT: 'CONTENT',
    MEDIA: 'MEDIA',
    CTA: 'CTA',
    FOOTER: 'FOOTER',
    DIVIDER: 'DIVIDER',
    SOCIAL: 'SOCIAL',
  },
  prisma: {
    emailBlockTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/server/auth/auth0', () => ({
  appBaseUrl: () => 'https://campaigns.getyn.com',
}));

import { prisma } from '@getyn/db';

import {
  composeUnlayerJson,
  ComposerError,
} from './email-composer';

const mockFindMany = prisma.emailBlockTemplate.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockFindUnique = prisma.emailBlockTemplate
  .findUnique as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

const BRAND = {
  brandName: 'Acme Inc',
  brandDescription: 'We sell widgets.',
  primaryColor: '#7c3aed',
  accentColor: '#22c55e',
  logoUrl: 'https://example.com/logo.png',
  // unused-but-required by the TenantBrandProfile type
  id: 'b1',
  tenantId: 't1',
  brandTagline: null,
  secondaryColor: null,
  logoAssetId: null,
  voiceTone: 'FRIENDLY' as const,
  writingStyle: null,
  industry: null,
  targetAudience: null,
  dosAndDonts: null,
  signatureBlock: null,
  socialLinks: [],
  unsubscribeFooterCustom: null,
  completedAt: new Date(),
  updatedByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const CTX = {
  tenantId: 't1',
  tenantSlug: 'acme',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: BRAND as any,
  postalAddress: '123 Main St, Springfield',
};

const HERO_TEMPLATE = {
  slug: 'hero_text_only',
  category: 'HERO',
  unlayerDesignJsonTemplate: {
    cells: [1],
    columns: [
      {
        contents: [
          {
            type: 'heading',
            values: { headingType: 'h1', text: '{{heading}}' },
          },
          { type: 'text', values: { text: '{{body}}' } },
        ],
      },
    ],
  },
};

const FOOTER_TEMPLATE = {
  slug: 'footer_minimal',
  category: 'FOOTER',
  unlayerDesignJsonTemplate: {
    cells: [1],
    columns: [
      {
        contents: [
          { type: 'text', values: { text: '{{brand_name}} · {{address}}' } },
          {
            type: 'text',
            values: { text: '<a href="{{unsubscribe_url}}">Unsubscribe</a>' },
          },
        ],
      },
    ],
  },
};

describe('composeUnlayerJson', () => {
  it('substitutes tokens from the content map', async () => {
    mockFindUnique.mockResolvedValueOnce({ category: 'HERO' });
    mockFindMany.mockResolvedValueOnce([HERO_TEMPLATE, FOOTER_TEMPLATE]);
    const result = await composeUnlayerJson({
      plan: [
        {
          slug: 'hero_text_only',
          content: { heading: 'Welcome!', body: 'Glad to have you.' },
        },
      ],
      ctx: CTX,
    });
    const json = JSON.stringify(result.designJson);
    expect(json).toContain('Welcome!');
    expect(json).toContain('Glad to have you.');
    expect(json).not.toMatch(/\{\{heading\}\}/);
  });

  it('falls back to brand defaults for unspecified keys', async () => {
    mockFindUnique.mockResolvedValueOnce({ category: 'FOOTER' });
    mockFindMany.mockResolvedValueOnce([FOOTER_TEMPLATE]);
    const result = await composeUnlayerJson({
      plan: [
        // No content for brand_name / address — brand defaults fill in.
        { slug: 'footer_minimal', content: {} },
      ],
      ctx: CTX,
    });
    const json = JSON.stringify(result.designJson);
    expect(json).toContain('Acme Inc');
    expect(json).toContain('123 Main St, Springfield');
  });

  it('auto-appends footer_minimal when the plan does not end with a footer', async () => {
    // First lookup: last block category (HERO, not FOOTER).
    mockFindUnique.mockResolvedValueOnce({ category: 'HERO' });
    mockFindMany.mockResolvedValueOnce([HERO_TEMPLATE, FOOTER_TEMPLATE]);
    const result = await composeUnlayerJson({
      plan: [
        {
          slug: 'hero_text_only',
          content: { heading: 'Hi', body: 'There' },
        },
      ],
      ctx: CTX,
    });
    expect(result.resolvedSlugs).toEqual(['hero_text_only', 'footer_minimal']);
    expect(
      result.warnings.some((w) => w.includes('Auto-appended footer_minimal')),
    ).toBe(true);
  });

  it('does NOT auto-append when the plan already ends with a footer', async () => {
    mockFindUnique.mockResolvedValueOnce({ category: 'FOOTER' });
    mockFindMany.mockResolvedValueOnce([HERO_TEMPLATE, FOOTER_TEMPLATE]);
    const result = await composeUnlayerJson({
      plan: [
        { slug: 'hero_text_only', content: { heading: 'h', body: 'b' } },
        { slug: 'footer_minimal', content: {} },
      ],
      ctx: CTX,
    });
    expect(result.resolvedSlugs).toEqual(['hero_text_only', 'footer_minimal']);
    expect(
      result.warnings.some((w) => w.includes('Auto-appended')),
    ).toBe(false);
  });

  it('throws on an unknown slug', async () => {
    mockFindUnique.mockResolvedValueOnce({ category: 'HERO' });
    mockFindMany.mockResolvedValueOnce([HERO_TEMPLATE, FOOTER_TEMPLATE]);
    await expect(
      composeUnlayerJson({
        plan: [
          {
            slug: 'this_block_does_not_exist',
            content: {},
          },
        ],
        ctx: CTX,
      }),
    ).rejects.toBeInstanceOf(ComposerError);
  });

  it('throws when the agent leaves required tokens unfilled', async () => {
    mockFindUnique.mockResolvedValueOnce({ category: 'HERO' });
    mockFindMany.mockResolvedValueOnce([HERO_TEMPLATE, FOOTER_TEMPLATE]);
    // Heading + body intentionally missing.
    await expect(
      composeUnlayerJson({
        plan: [{ slug: 'hero_text_only', content: {} }],
        ctx: CTX,
      }),
    ).rejects.toThrow(/fill.*placeholders/i);
  });

  it("doesn't count {{contact.unsubscribeToken}} as unresolved", async () => {
    // The composer's brand defaults inject {{contact.unsubscribeToken}}
    // into the footer's unsubscribe URL — that's a runtime token the
    // worker substitutes per-recipient, not a composer concern.
    mockFindUnique.mockResolvedValueOnce({ category: 'FOOTER' });
    mockFindMany.mockResolvedValueOnce([FOOTER_TEMPLATE]);
    const result = await composeUnlayerJson({
      plan: [{ slug: 'footer_minimal', content: {} }],
      ctx: CTX,
    });
    expect(result).toBeDefined();
    expect(JSON.stringify(result.designJson)).toContain('{{contact.unsubscribeToken}}');
  });

  it('produces the Unlayer document shape (body, rows, schemaVersion, counters)', async () => {
    mockFindUnique.mockResolvedValueOnce({ category: 'HERO' });
    mockFindMany.mockResolvedValueOnce([HERO_TEMPLATE, FOOTER_TEMPLATE]);
    const result = await composeUnlayerJson({
      plan: [
        { slug: 'hero_text_only', content: { heading: 'h', body: 'b' } },
      ],
      ctx: CTX,
    });
    const dj = result.designJson;
    expect(dj).toHaveProperty('body');
    expect(dj).toHaveProperty('schemaVersion');
    expect(dj).toHaveProperty('counters');
    const body = (dj as { body: { rows: unknown[] } }).body;
    // hero + auto-appended footer
    expect(body.rows.length).toBe(2);
  });

  it('fails fast on an empty plan', async () => {
    await expect(
      composeUnlayerJson({ plan: [], ctx: CTX }),
    ).rejects.toBeInstanceOf(ComposerError);
  });
});
