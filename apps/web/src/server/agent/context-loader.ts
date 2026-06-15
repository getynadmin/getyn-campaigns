/**
 * Phase 7 M2 — agent context loader.
 *
 * Pulls everything the system prompt needs to know about the tenant
 * + workspace at conversation start. Loaded once per turn so changes
 * (a newly verified sending domain, a new segment) flow through
 * without restarting the conversation.
 *
 * Returns a `BrandContext` blob (used to render the system prompt)
 * and an `initialState` map (seeded into the runtime's accumulated
 * state on first call, restored from `AgentConversation.conversationState`
 * on resume).
 */
import { prisma, withTenant } from '@getyn/db';
import type { AgentChannel, Prisma } from '@getyn/db';

export interface BrandContext {
  tenantName: string;
  appName: string;
  brand: {
    name: string;
    description: string;
    tagline: string | null;
    industry: string | null;
    targetAudience: string | null;
    primaryColor: string;
    secondaryColor: string | null;
    accentColor: string | null;
    voiceTone: string;
    writingStyle: string | null;
    dosAndDonts: string | null;
    signatureBlock: string | null;
    unsubscribeFooterCustom: string | null;
    socialLinks: Array<{ platform: string; url: string }>;
  } | null;
  segments: Array<{ id: string; name: string; contactCount: number }>;
  // Email block library (slug + name + description only — full Unlayer
  // JSON is heavy and is only loaded when the composer runs).
  emailBlocks: Array<{
    slug: string;
    name: string;
    description: string;
    category: string;
  }>;
  /** WhatsApp-only: connected phone numbers + approved template count. */
  whatsApp?: {
    phoneNumbers: Array<{
      id: string;
      phoneNumber: string;
      verifiedName: string;
    }>;
    approvedTemplateCount: number;
    accountConnected: boolean;
  };
}

export async function loadAgentContext(args: {
  tenantId: string;
  channel: AgentChannel;
}): Promise<BrandContext> {
  const [tenant, profile, segments, blocks, whatsAppCtx] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { name: true },
    }),
    withTenant(args.tenantId, (tx) =>
      tx.tenantBrandProfile.findUnique({
        where: { tenantId: args.tenantId },
      }),
    ),
    withTenant(args.tenantId, (tx) =>
      tx.segment.findMany({
        where: { tenantId: args.tenantId },
        select: {
          id: true,
          name: true,
          // approximate count via cached field if present; for M2 we
          // compute lazily — segment compilation is expensive, the
          // agent only needs the name to pick from.
        },
        orderBy: { updatedAt: 'desc' },
        take: 25,
      }),
    ),
    args.channel === 'EMAIL'
      ? prisma.emailBlockTemplate.findMany({
          select: {
            slug: true,
            name: true,
            description: true,
            category: true,
          },
          orderBy: { slug: 'asc' },
        })
      : Promise.resolve([] as never[]),
    args.channel === 'WHATSAPP'
      ? loadWhatsAppContext(args.tenantId)
      : Promise.resolve(undefined),
  ]);

  return {
    tenantName: tenant?.name ?? 'your workspace',
    appName: 'Getyn Campaigns',
    brand: profile
      ? {
          name: profile.brandName,
          description: profile.brandDescription,
          tagline: profile.brandTagline,
          industry: profile.industry,
          targetAudience: profile.targetAudience,
          primaryColor: profile.primaryColor,
          secondaryColor: profile.secondaryColor,
          accentColor: profile.accentColor,
          voiceTone: profile.voiceTone,
          writingStyle: profile.writingStyle,
          dosAndDonts: profile.dosAndDonts,
          signatureBlock: profile.signatureBlock,
          unsubscribeFooterCustom: profile.unsubscribeFooterCustom,
          socialLinks:
            (profile.socialLinks as Prisma.JsonArray | null)?.map((l) => {
              const obj = (l ?? {}) as { platform?: string; url?: string };
              return {
                platform: obj.platform ?? '',
                url: obj.url ?? '',
              };
            }) ?? [],
        }
      : null,
    segments: segments.map((s) => ({
      id: s.id,
      name: s.name,
      contactCount: 0,
    })),
    emailBlocks: blocks.map((b) => ({
      slug: b.slug,
      name: b.name,
      description: b.description,
      category: b.category,
    })),
    whatsApp: whatsAppCtx,
  };
}

/**
 * Phase 7 M4 — WhatsApp-specific context. Loaded only when the
 * conversation channel is WHATSAPP. Tells the system prompt about
 * connected phone numbers + the size of the approved-template
 * library so the agent knows whether to pick or draft.
 */
async function loadWhatsAppContext(
  tenantId: string,
): Promise<BrandContext['whatsApp']> {
  const [account, phones, approvedCount] = await Promise.all([
    prisma.whatsAppAccount.findUnique({
      where: { tenantId },
      select: { id: true },
    }),
    withTenant(tenantId, (tx) =>
      tx.whatsAppPhoneNumber.findMany({
        where: { tenantId },
        select: {
          id: true,
          phoneNumber: true,
          verifiedName: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
    ),
    withTenant(tenantId, (tx) =>
      tx.whatsAppTemplate.count({
        where: {
          tenantId,
          status: 'APPROVED',
          deletedAt: null,
        },
      }),
    ),
  ]);
  return {
    phoneNumbers: phones.map((p) => ({
      id: p.id,
      phoneNumber: p.phoneNumber,
      verifiedName: p.verifiedName,
    })),
    approvedTemplateCount: approvedCount,
    accountConnected: account !== null,
  };
}

/**
 * Render the system prompt from the loaded context + channel.
 * Keep this small in M2 — agent-specific guidance lands with the
 * email/WA toolsets in M3/M4.
 */
export function renderSystemPrompt(args: {
  channel: AgentChannel;
  context: BrandContext;
}): string {
  const c = args.context;
  const lines: string[] = [];

  if (c.brand) {
    lines.push(
      `You are a campaign creation assistant for ${c.brand.name}, ` +
        `${c.brand.industry ? `a ${c.brand.industry} business` : 'a business'}.`,
      ``,
      `About this brand: ${c.brand.description}`,
    );
    if (c.brand.targetAudience) {
      lines.push(`Target audience: ${c.brand.targetAudience}`);
    }
    lines.push(`Voice: ${c.brand.voiceTone}`);
    if (c.brand.writingStyle) {
      lines.push(`Writing style: ${c.brand.writingStyle}`);
    }
    if (c.brand.dosAndDonts) {
      lines.push(`Dos and don'ts: ${c.brand.dosAndDonts}`);
    }
    lines.push(
      `Brand colors: primary ${c.brand.primaryColor}` +
        (c.brand.accentColor ? `, accent ${c.brand.accentColor}` : ''),
    );
  } else {
    lines.push(
      `You are a campaign creation assistant for ${c.tenantName}. ` +
        `The user hasn't completed their brand profile yet — keep your ` +
        `output neutral and politely ask them to fill it in for better results.`,
    );
  }

  lines.push(
    ``,
    `Channel: ${args.channel}`,
    ``,
    `Your job is to have a brief, focused conversation to understand what ` +
      `campaign the user wants, then assemble it using the tools available. ` +
      `Ask only what you need. Don't be chatty.`,
    ``,
    `# Guardrails`,
    ``,
    `- Stay in scope: you author email + WhatsApp campaign drafts. You can` +
      ` NOT send anything yourself (the user does that in the editor), look` +
      ` up real-time data, hit external APIs outside your tools, predict` +
      ` deliverability or open rates, or change tenant settings (billing,` +
      ` integrations, brand profile).`,
    `- No misleading copy: never invent product features, claim percentage` +
      ` discounts you don't have, fake testimonials, or imply urgency that` +
      ` isn't real ("Last chance!" only if the user told you it actually is).`,
    `- CAN-SPAM: every email design plan MUST end with a footer block` +
      ` (\`footer_minimal\` or \`footer_social\`). The composer auto-appends` +
      ` one if you forget, but include it explicitly. The composer also` +
      ` auto-injects the tenant's physical address + unsubscribe link;` +
      ` you don't need to add those to your content map.`,
    `- WhatsApp policy: Marketing-category templates are strictly` +
      ` opt-in. Don't draft Marketing templates that read like Utility` +
      ` (transactional) — Meta will reject them.`,
    `- Brand colors: only use the brand's primary / accent colors in your` +
      ` content. Don't introduce arbitrary hex codes; the composer enforces` +
      ` brand defaults for global styling.`,
  );

  if (args.channel === 'EMAIL') {
    lines.push(
      ``,
      `# Email-specific guidance`,
      ``,
      `Workflow:`,
      `  1. Call set_goal once when you understand the campaign's purpose.`,
      `  2. Call set_audience with one of the segment ids below.`,
      `  3. Call set_subject_line with a subject + optional preheader.`,
      `  4. Call propose_design_plan with an ordered list of blocks.`,
      `  5. Iterate with update_block_content / add_block / remove_block / reorder_blocks` +
        ` based on user feedback.`,
      `  6. Call finalize_draft once the user is happy. This hands off to the` +
        ` visual editor; don't try to finish all polish in chat.`,
      ``,
      `When you need an image but the user hasn't given you a URL, call` +
        ` request_image — the UI prompts them; you'll get the asset back.`,
      ``,
      `Every block has a slug + a content map filling in {{placeholders}}.` +
        ` The composer auto-fills brand defaults (logo, address, unsubscribe URL,` +
        ` brand_name, primary_color) so you don't have to repeat them in every block.`,
      ``,
      `# Available email blocks`,
      ``,
    );
    for (const b of c.emailBlocks) {
      lines.push(`  - ${b.slug} (${b.category}) — ${b.name}: ${b.description}`);
    }
  } else {
    // WHATSAPP
    const wa = c.whatsApp;
    lines.push(
      ``,
      `# WhatsApp-specific guidance`,
      ``,
      `Workflow:`,
      `  1. Call set_goal once you understand the campaign's purpose.`,
      `  2. Call set_audience with one of the segment ids below.`,
      `  3. Pick a template:`,
      `       - Use list_approved_templates to see what's already APPROVED.`,
      `       - pick_existing_template if one fits.`,
      `       - draft_new_template if nothing fits — this CREATES a new`,
      `         DRAFT template that the user reviews + submits to Meta.`,
      `         The campaign will sit in DRAFT until Meta approves it.`,
      `  4. Call set_template_variables to fill {{1}}, {{2}}, ... (only`,
      `     if the template has variables).`,
      `  5. Call set_phone_number with one of the numbers below`,
      `     (auto-pick if only one is listed).`,
      `  6. Call finalize_draft once everything's set.`,
      ``,
      `Variables are either literal strings ("Welcome to Acme") or`,
      `contact merge tags ("contact.firstName" / "contact.email") that`,
      `get resolved per-recipient at dispatch time.`,
    );

    if (wa) {
      if (!wa.accountConnected) {
        lines.push(
          ``,
          `WARNING: this workspace has NO connected WhatsApp account.` +
            ` Stop and ask the user to connect one in Settings → Channels` +
            ` before doing anything else.`,
        );
      }
      lines.push(``, `# Connected phone numbers`, ``);
      if (wa.phoneNumbers.length === 0) {
        lines.push(
          `  (none — the user needs to add one in Settings → Channels)`,
        );
      } else {
        for (const p of wa.phoneNumbers) {
          lines.push(
            `  - ${p.phoneNumber} "${p.verifiedName}" (id: ${p.id})`,
          );
        }
      }
      lines.push(
        ``,
        `Approved templates in library: ${wa.approvedTemplateCount}` +
          (wa.approvedTemplateCount === 0
            ? ` — you'll need to draft a new one.`
            : ` (call list_approved_templates to see them).`),
      );
    }
  }

  if (c.segments.length > 0) {
    lines.push(``, `# Available audience segments`, ``);
    for (const s of c.segments) {
      lines.push(`  - ${s.name} (id: ${s.id})`);
    }
  } else {
    lines.push(
      ``,
      `# Available audience segments`,
      ``,
      `(none yet — ask the user to create one in Contacts → Segments before finalizing)`,
    );
  }

  return lines.join('\n');
}
