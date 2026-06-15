/**
 * Phase 7 M3 — design plan → Unlayer JSON composer.
 *
 * The agent proposes a design plan: an ordered list of {slug, content}
 * entries. The composer:
 *
 *   1. Loads each EmailBlockTemplate by slug.
 *   2. Deep-substitutes `{{placeholder}}` tokens in the template JSON
 *      with content the agent provided (text, image URLs, hrefs).
 *      Brand-derived defaults (logo, colors, address, unsubscribe
 *      URL) are filled in from the tenant context if the agent
 *      didn't override them.
 *   3. Wraps each substituted block into Unlayer's row/column
 *      structure with fresh ids + counters.
 *   4. Ensures a footer block is present (auto-appends footer_minimal
 *      if the agent didn't include one — CAN-SPAM requires the
 *      unsubscribe link + physical address).
 *   5. Validates that no `{{token}}` slots remain unsubstituted.
 *
 * The result is a valid Unlayer designJson the existing editor
 * (apps/web/src/components/email-builder/) can load and the user
 * can refine before sending.
 */
import { randomUUID } from 'crypto';

import { EmailBlockCategory, prisma } from '@getyn/db';
import type { TenantBrandProfile } from '@getyn/db';

import { appBaseUrl } from '@/server/auth/auth0';

const UNLAYER_SCHEMA_VERSION = 16;

// Default footer slug auto-appended when the agent forgets one.
const DEFAULT_FOOTER_SLUG = 'footer_minimal';

export interface PlanBlock {
  slug: string;
  content: Record<string, unknown>;
}

export interface ComposeContext {
  tenantId: string;
  tenantSlug: string;
  brand: TenantBrandProfile;
  /** Used to compose the unsubscribe + web-view URLs. Pulled from
   *  tenant settings (Phase 3). */
  postalAddress: string;
}

export interface ComposeResult {
  /** Final Unlayer document, ready to write to EmailCampaign.designJson. */
  designJson: Record<string, unknown>;
  /** Block slugs in order, including the auto-appended footer. */
  resolvedSlugs: string[];
  /** Warnings the UI can surface (missing image, fallback used, etc.). */
  warnings: string[];
}

export class ComposerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unknown_slug'
      | 'unresolved_token'
      | 'no_blocks'
      | 'invalid_template',
  ) {
    super(message);
    this.name = 'ComposerError';
  }
}

export async function composeUnlayerJson(args: {
  plan: PlanBlock[];
  ctx: ComposeContext;
}): Promise<ComposeResult> {
  if (args.plan.length === 0) {
    throw new ComposerError(
      'Design plan is empty — at least one block is required.',
      'no_blocks',
    );
  }

  const warnings: string[] = [];

  // Always ensure a footer block lands last. If the plan doesn't
  // include one already we append the minimal footer.
  const hasFooter = await planEndsWithFooter(args.plan);
  const finalPlan = hasFooter
    ? args.plan.slice()
    : [
        ...args.plan,
        { slug: DEFAULT_FOOTER_SLUG, content: {} } satisfies PlanBlock,
      ];
  if (!hasFooter) {
    warnings.push(
      `Auto-appended ${DEFAULT_FOOTER_SLUG} so the design satisfies CAN-SPAM.`,
    );
  }

  // Single batched lookup of all referenced templates.
  const slugs = Array.from(new Set(finalPlan.map((b) => b.slug)));
  const templates = await prisma.emailBlockTemplate.findMany({
    where: { slug: { in: slugs } },
  });
  const bySlug = new Map(templates.map((t) => [t.slug, t]));
  for (const slug of slugs) {
    if (!bySlug.has(slug)) {
      throw new ComposerError(`Unknown block template: ${slug}`, 'unknown_slug');
    }
  }

  // Build Unlayer rows from substituted block JSON.
  const rows: Record<string, unknown>[] = [];
  const counters = { u_row: 0, u_column: 0, u_content_text: 0, u_content_heading: 0, u_content_image: 0, u_content_button: 0, u_content_divider: 0, u_content_social: 0 };

  for (const entry of finalPlan) {
    const tmpl = bySlug.get(entry.slug);
    if (!tmpl) continue; // already errored above; defensive
    const merged = mergeContentWithBrandDefaults(entry, args.ctx);
    const rawTemplate = tmpl.unlayerDesignJsonTemplate as Record<
      string,
      unknown
    >;
    if (!rawTemplate || typeof rawTemplate !== 'object') {
      throw new ComposerError(
        `Block ${entry.slug} has malformed template JSON.`,
        'invalid_template',
      );
    }
    // Deep clone and substitute. We clone via JSON round-trip — the
    // templates are pure JSON.
    const substituted = substituteTokens(rawTemplate, merged, warnings);
    rows.push(toUnlayerRow(substituted, counters));
  }

  // Verify nothing is left unsubstituted across the assembled doc.
  const unresolved = findUnresolvedTokens(rows);
  if (unresolved.length > 0) {
    throw new ComposerError(
      `Couldn't compose the design — these placeholders weren't filled: ${unresolved.slice(0, 6).join(', ')}.`,
      'unresolved_token',
    );
  }

  const designJson = {
    counters,
    body: {
      id: makeId(),
      rows,
      values: {
        textColor: '#000000',
        backgroundColor: '#ffffff',
        backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat' },
        contentWidth: '600px',
        contentAlign: 'center',
        fontFamily: { label: 'Arial', value: 'arial,helvetica,sans-serif' },
        // Inject brand primary as a CSS-color hint for the editor's
        // global accent colour.
        linkStyle: {
          body: true,
          linkColor: args.ctx.brand.primaryColor,
        },
      },
    },
    schemaVersion: UNLAYER_SCHEMA_VERSION,
  };

  return {
    designJson,
    resolvedSlugs: finalPlan.map((b) => b.slug),
    warnings,
  };
}

// ----------------------------------------------------------------------------
// Substitution + brand defaults
// ----------------------------------------------------------------------------

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function substituteTokens(
  node: unknown,
  content: Record<string, unknown>,
  warnings: string[],
): unknown {
  if (typeof node === 'string') {
    return node.replace(TOKEN_RE, (match, key: string) => {
      if (key in content) {
        const v = content[key];
        return v == null ? '' : String(v);
      }
      // Unfilled token — leave it for the validator to catch later.
      warnings.push(`Token {{${key}}} had no value provided.`);
      return match;
    });
  }
  if (Array.isArray(node)) {
    return node.map((child) => substituteTokens(child, content, warnings));
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = substituteTokens(v, content, warnings);
    }
    return out;
  }
  return node;
}

function mergeContentWithBrandDefaults(
  entry: PlanBlock,
  ctx: ComposeContext,
): Record<string, unknown> {
  const baseUrl = appBaseUrl();
  // Defaults the agent can rely on existing for every block — keeps
  // it from having to spell out the unsubscribe URL every time.
  const brandDefaults: Record<string, unknown> = {
    brand_name: ctx.brand.brandName,
    logo_url: ctx.brand.logoUrl ?? '',
    address: ctx.postalAddress,
    unsubscribe_url: `${baseUrl}/u/{{contact.unsubscribeToken}}`,
    webview_url: `${baseUrl}/v/{{campaign.webviewToken}}`,
    primary_color: ctx.brand.primaryColor,
    accent_color: ctx.brand.accentColor ?? ctx.brand.primaryColor,
  };
  // Agent-provided content wins. We only fall back to brand defaults
  // for keys the agent didn't set, so the agent can override the
  // logo on a specific block without nuking the brand fallback for
  // other blocks.
  return { ...brandDefaults, ...entry.content };
}

// ----------------------------------------------------------------------------
// Unlayer row scaffolding
// ----------------------------------------------------------------------------

interface UnlayerCounters {
  u_row: number;
  u_column: number;
  u_content_text: number;
  u_content_heading: number;
  u_content_image: number;
  u_content_button: number;
  u_content_divider: number;
  u_content_social: number;
}

function toUnlayerRow(
  blockJson: unknown,
  counters: UnlayerCounters,
): Record<string, unknown> {
  // Seeded templates have shape: { cells: [n,…], columns: [{contents:[…]},…] }
  // Wrap into an Unlayer row with ids + default values.
  if (!blockJson || typeof blockJson !== 'object') {
    return makeBlankRow(counters);
  }
  const obj = blockJson as Record<string, unknown>;
  const cells = (obj.cells as number[] | undefined) ?? [1];
  const rawColumns = (obj.columns as Array<Record<string, unknown>> | undefined) ?? [
    { contents: [] },
  ];

  counters.u_row += 1;
  const rowId = makeId();
  const columns = rawColumns.map((col) => {
    counters.u_column += 1;
    const colId = makeId();
    const contents = (col.contents as unknown[] | undefined) ?? [];
    return {
      id: colId,
      contents: contents.map((c) => decorateContent(c, counters)),
      values: {
        backgroundColor: '',
        padding: '0px',
        border: {},
        _meta: { htmlID: '', htmlClassNames: 'u_column' },
      },
    };
  });

  return {
    id: rowId,
    cells,
    columns,
    values: {
      displayCondition: null,
      columns: false,
      backgroundColor: '',
      columnsBackgroundColor: '',
      backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat' },
      padding: '0px',
      hideDesktop: false,
      hideMobile: false,
      noStackMobile: false,
      _meta: { htmlID: '', htmlClassNames: 'u_row' },
    },
  };
}

function decorateContent(
  content: unknown,
  counters: UnlayerCounters,
): Record<string, unknown> {
  if (!content || typeof content !== 'object') return makeBlankText(counters);
  const obj = { ...(content as Record<string, unknown>) };
  const type = (obj.type as string) ?? 'text';
  // Generate a fresh id + bump the right counter.
  const counterKey =
    type === 'heading'
      ? 'u_content_heading'
      : type === 'image'
        ? 'u_content_image'
        : type === 'button'
          ? 'u_content_button'
          : type === 'divider'
            ? 'u_content_divider'
            : type === 'social'
              ? 'u_content_social'
              : 'u_content_text';
  counters[counterKey as keyof UnlayerCounters] += 1;
  obj.id = makeId();
  // Ensure `values` exists; the seeded templates already do, but be
  // defensive.
  if (!obj.values) obj.values = {};
  return obj;
}

function makeBlankRow(counters: UnlayerCounters): Record<string, unknown> {
  counters.u_row += 1;
  return {
    id: makeId(),
    cells: [1],
    columns: [
      {
        id: makeId(),
        contents: [],
        values: { _meta: { htmlClassNames: 'u_column' } },
      },
    ],
    values: { _meta: { htmlClassNames: 'u_row' } },
  };
}

function makeBlankText(counters: UnlayerCounters): Record<string, unknown> {
  counters.u_content_text += 1;
  return {
    id: makeId(),
    type: 'text',
    values: { text: '<p></p>' },
  };
}

function makeId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

// ----------------------------------------------------------------------------
// Validation helpers
// ----------------------------------------------------------------------------

async function planEndsWithFooter(plan: PlanBlock[]): Promise<boolean> {
  if (plan.length === 0) return false;
  const last = plan[plan.length - 1];
  if (!last) return false;
  const tmpl = await prisma.emailBlockTemplate.findUnique({
    where: { slug: last.slug },
    select: { category: true },
  });
  return tmpl?.category === EmailBlockCategory.FOOTER;
}

function findUnresolvedTokens(rows: Record<string, unknown>[]): string[] {
  const found = new Set<string>();
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      // Brand-default unsubscribe URLs intentionally carry a nested
      // {{contact.unsubscribeToken}} that the worker substitutes per-
      // recipient at send time — those are NOT unresolved tokens, so
      // we accept "."-containing keys as a marker for "the worker
      // resolves this".
      let m: RegExpExecArray | null;
      const re = new RegExp(TOKEN_RE);
      while ((m = re.exec(n)) !== null) {
        const key = m[1];
        if (key && !key.includes('.')) found.add(key);
      }
    } else if (Array.isArray(n)) {
      n.forEach(walk);
    } else if (n && typeof n === 'object') {
      Object.values(n as Record<string, unknown>).forEach(walk);
    }
  };
  rows.forEach(walk);
  return Array.from(found);
}
