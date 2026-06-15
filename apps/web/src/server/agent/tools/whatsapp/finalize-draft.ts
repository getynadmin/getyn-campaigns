/**
 * Phase 7 M4 — WhatsApp finalize_draft.
 *
 * Same handoff pattern as the email finalizer (M3): validate state,
 * create Campaign + WhatsAppCampaign atomically, flip the conversation
 * to COMPLETED_DRAFT_CREATED, return redirectTo for the chat UI.
 *
 * Key differences from email:
 *   - No design composer — campaigns send a single template message.
 *   - If the template is still DRAFT or PENDING Meta approval, the
 *     campaign sits in DRAFT and the existing campaigns wizard / UI
 *     shows a banner "Sending will start automatically once Meta
 *     approves." (Existing dispatch worker already refuses to send
 *     non-APPROVED templates.)
 */
import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import {
  AgentConversationStatus,
  CampaignStatus,
  CampaignType,
  WATemplateStatus,
  prisma,
  withTenant,
} from '@getyn/db';
import type { Prisma } from '@getyn/db';

import { readWaState } from './state';

export const finalizeWhatsAppDraftTool = defineTool({
  name: 'finalize_draft',
  description:
    "Hand off to the campaign review screen. Call once you've picked / drafted a template, set variables, picked an audience + phone number. The user reviews in the existing WhatsApp wizard before sending; if the template is still PENDING Meta approval the campaign waits and sends automatically once approved.",
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
    awaitingMetaApproval: z.boolean(),
  }),
  async handler(input, ctx) {
    const state = readWaState(ctx.state);
    if (!state.audience) {
      throw new Error('Pick an audience first by calling set_audience.');
    }
    if (!state.template) {
      throw new Error(
        'Pick or draft a template first (pick_existing_template / draft_new_template).',
      );
    }
    if (!state.phoneNumber) {
      throw new Error('Pick a phone number first by calling set_phone_number.');
    }
    // templateVariables only required if the template HAS variables.
    if (state.template.variableCount > 0) {
      const provided = state.templateVariables?.length ?? 0;
      if (provided !== state.template.variableCount) {
        throw new Error(
          `Fill in the ${state.template.variableCount} template variable${
            state.template.variableCount === 1 ? '' : 's'
          } first (set_template_variables).`,
        );
      }
    }

    // Confirm the template still exists + grab the current status
    // (it may have flipped APPROVED ↔ PENDING since the agent picked
    // it — Meta updates are async).
    const tmpl = await prisma.whatsAppTemplate.findFirst({
      where: {
        id: state.template.templateId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        whatsAppAccountId: true,
        language: true,
        status: true,
        name: true,
      },
    });
    if (!tmpl) {
      throw new Error(
        'Selected template no longer exists. Pick a different one and retry finalize_draft.',
      );
    }
    if (tmpl.status === WATemplateStatus.REJECTED) {
      throw new Error(
        `Template ${tmpl.name} was REJECTED by Meta. Pick another template or draft a new one.`,
      );
    }

    // Look up tenant slug for the redirect.
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { slug: true, postalAddress: true },
    });
    if (!tenant) throw new Error('Workspace not found.');

    const variables = state.templateVariables ?? [];

    const campaignId = await withTenant(ctx.tenantId, async (tx) => {
      const created = await tx.campaign.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.campaignName,
          type: CampaignType.WHATSAPP,
          status: CampaignStatus.DRAFT,
          segmentId: state.audience!.segmentId,
          createdByUserId: ctx.userId,
          timezone: 'UTC',
          whatsAppCampaign: {
            create: {
              whatsAppAccountId: tmpl.whatsAppAccountId,
              phoneNumberId: state.phoneNumber!.phoneNumberId,
              templateId: tmpl.id,
              templateLanguage: tmpl.language,
              templateVariables:
                variables as unknown as Prisma.JsonArray,
            },
          },
        },
        select: { id: true },
      });
      return created.id;
    });

    await prisma.agentConversation.update({
      where: { id: ctx.conversationId },
      data: {
        status: AgentConversationStatus.COMPLETED_DRAFT_CREATED,
        producedCampaignId: campaignId,
      },
    });

    const awaitingMetaApproval = tmpl.status !== WATemplateStatus.APPROVED;

    return {
      ok: true as const,
      campaignId,
      redirectTo: `/t/${tenant.slug}/campaigns/${campaignId}/whatsapp`,
      awaitingMetaApproval,
    };
  },
});
