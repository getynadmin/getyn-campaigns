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
}

export async function loadAgentContext(args: {
  tenantId: string;
  channel: AgentChannel;
}): Promise<BrandContext> {
  const [tenant, profile, segments, blocks] = await Promise.all([
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
      `Ask only what you need. Don't be chatty. Don't promise anything you ` +
      `can't deliver in the Campaigns product (no analytics dashboards, no ` +
      `social posting, no API calls outside the tools below).`,
    ``,
    `When you have enough information, signal completion by calling ` +
      `\`finalize_draft\`. (Not yet available in M2 — for now, after ` +
      `calling set_goal, just respond with a short summary and let the ` +
      `turn end.)`,
  );

  if (c.segments.length > 0) {
    lines.push(``, `Available audience segments:`);
    for (const s of c.segments) {
      lines.push(`  - ${s.name} (id: ${s.id})`);
    }
  }

  return lines.join('\n');
}
