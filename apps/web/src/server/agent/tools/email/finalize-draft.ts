/**
 * Phase 7 M3 — finalize_draft tool.
 *
 * The agent calls this when it's collected enough info to ship a
 * DRAFT campaign. We validate the accumulated state, compose
 * Unlayer JSON via the email-composer, then create the Campaign +
 * EmailCampaign rows. The agent's job ends here; the UI redirects
 * to the existing Unlayer editor so the user reviews + tweaks.
 *
 * Required state slots: subjectLine, audience, designPlan (≥1
 * block). Auto-injected by the composer: footer block, brand
 * colors, unsubscribe URL.
 *
 * Sending domain: we pick the tenant's most recently VERIFIED
 * sending domain. If they don't have one, we throw a friendly
 * "set up a domain first" error — the agent surfaces this to the
 * user as a prompt.
 */
import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import {
  AgentConversationStatus,
  CampaignStatus,
  CampaignType,
  Prisma,
  prisma,
  withTenant,
} from '@getyn/db';

import { checkBrandFidelity } from '../../brand-fidelity';
import { composeUnlayerJson } from '../../email-composer';
import { readEmailState } from './state';

export const finalizeDraftTool = defineTool({
  name: 'finalize_draft',
  description:
    "Hand off to the visual editor. Call this once subject, audience, and at least one block are set. The user will review + tweak in the editor — your job is to get them to a strong starting point, not a finished campaign.",
  inputSchema: z.object({
    campaignName: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe(
        'A short internal name for the campaign (used in the campaigns list, not visible to recipients).',
      ),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    campaignId: z.string(),
    redirectTo: z.string(),
    warnings: z.array(z.string()),
  }),
  async handler(input, ctx) {
    const state = readEmailState(ctx.state);
    if (!state.subjectLine) {
      throw new Error(
        'Set the subject line first by calling set_subject_line.',
      );
    }
    if (!state.audience) {
      throw new Error('Pick an audience first by calling set_audience.');
    }
    if (!state.designPlan || state.designPlan.length === 0) {
      throw new Error(
        'Propose a design plan first by calling propose_design_plan.',
      );
    }

    // Look up the tenant's verified sending domain + brand profile +
    // postal address + slug in one batch.
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { id: true, slug: true, postalAddress: true, name: true },
    });
    if (!tenant) {
      throw new Error('Workspace not found.');
    }

    const brand = await withTenant(ctx.tenantId, (tx) =>
      tx.tenantBrandProfile.findUnique({ where: { tenantId: ctx.tenantId } }),
    );
    if (!brand) {
      throw new Error(
        'Brand profile missing. Complete it in Settings → Brand and try again.',
      );
    }

    const sendingDomain = await withTenant(ctx.tenantId, (tx) =>
      tx.sendingDomain.findFirst({
        where: { tenantId: ctx.tenantId, status: 'VERIFIED' },
        orderBy: { verifiedAt: 'desc' },
        select: { id: true, domain: true },
      }),
    );
    if (!sendingDomain) {
      throw new Error(
        'No verified sending domain on this workspace. Add and verify one in Settings → Sending domains, then resume this conversation.',
      );
    }

    if (!tenant.postalAddress) {
      throw new Error(
        'Tenant postal address missing. Set it in Settings → Workspace; CAN-SPAM requires a physical address in every campaign.',
      );
    }

    // Compose Unlayer JSON.
    let composed;
    try {
      composed = await composeUnlayerJson({
        plan: state.designPlan.map((b) => ({
          slug: b.slug,
          content: b.content,
        })),
        ctx: {
          tenantId: ctx.tenantId,
          tenantSlug: tenant.slug,
          brand,
          postalAddress: tenant.postalAddress,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Compose failed.';
      throw new Error(
        `Couldn't compose the design — ${message} Try simpler content for each block.`,
      );
    }

    // Phase 7 M6 — brand fidelity check. Don't block, just warn.
    const fidelity = checkBrandFidelity({
      designJson: composed.designJson,
      brand,
    });
    if (!fidelity.ok) {
      composed.warnings.push(
        `Off-brand colors detected: ${fidelity.offBrandColors.join(', ')}. Review in the editor.`,
      );
    }
    if (!fidelity.primaryUsed) {
      composed.warnings.push(
        "The brand's primary color isn't used anywhere in the design — consider adding a CTA or accent in that color.",
      );
    }

    // Derive fromEmail from the verified domain (noreply@domain by
    // default — user can change in the editor).
    const fromEmail = `noreply@${sendingDomain.domain}`;
    const fromName = brand.brandName;
    const preheader = state.subjectLine.preheader ?? null;

    // Create Campaign + EmailCampaign atomically.
    const campaignId = await withTenant(ctx.tenantId, async (tx) => {
      const created = await tx.campaign.create({
        data: {
          tenantId: ctx.tenantId,
          type: CampaignType.EMAIL,
          status: CampaignStatus.DRAFT,
          name: input.campaignName,
          segmentId: state.audience!.segmentId,
          createdByUserId: ctx.userId,
          timezone: 'UTC',
          emailCampaign: {
            create: {
              subject: state.subjectLine!.subject,
              previewText: preheader,
              fromName,
              fromEmail,
              replyTo: null,
              sendingDomainId: sendingDomain.id,
              designJson: composed.designJson as Prisma.InputJsonValue,
              abTest: Prisma.DbNull,
              templateId: null,
            },
          },
        },
        select: { id: true },
      });
      return created.id;
    });

    // Link the conversation → campaign and flip status.
    await prisma.agentConversation.update({
      where: { id: ctx.conversationId },
      data: {
        status: AgentConversationStatus.COMPLETED_DRAFT_CREATED,
        producedCampaignId: campaignId,
      },
    });

    return {
      ok: true as const,
      campaignId,
      redirectTo: `/t/${tenant.slug}/campaigns/${campaignId}/design`,
      warnings: composed.warnings,
    };
  },
});
