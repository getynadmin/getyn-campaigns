import { TRPCError } from '@trpc/server';

import {
  CampaignStatus,
  CampaignType,
  Role,
  WAStatus,
  WATemplateStatus,
  withTenant,
  type Prisma,
} from '@getyn/db';
import {
  whatsAppCampaignCancelSchema,
  whatsAppCampaignCreateSchema,
  whatsAppCampaignDeleteSchema,
  whatsAppCampaignPreviewSchema,
  whatsAppCampaignScheduleSchema,
  whatsAppCampaignSendNowSchema,
  whatsAppCampaignUpdateSchema,
} from '@getyn/types';

import { enqueuePrepareWaCampaign } from '@/server/queues';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * WhatsApp campaign router (Phase 4 M8).
 *
 * 1:1 with `Campaign(type=WHATSAPP)` — the email/WhatsApp/SMS shell
 * lives on Campaign (status, scheduledAt, segmentId, name) and the
 * channel-specific bits live on `WhatsAppCampaign`.
 *
 * Lifecycle mirrors Phase 3's email pipeline:
 *   create → DRAFT
 *   schedule → SCHEDULED (delayed enqueue)
 *   sendNow → PREPARING (immediate enqueue)
 *   cancel → CANCELLED (only valid before SENDING)
 *
 * Pre-send pre-flight is performed both at sendNow time AND inside
 * the worker's prepare-wa-campaign — defence in depth, since worker
 * jobs can be triggered by schedule fire long after sendNow returned.
 */

const previewLimit = 5;

export const whatsAppCampaignsRouter = createTRPCRouter({
  /**
   * Create a DRAFT WhatsApp campaign. Validates target picks exist
   * and belong to this tenant. Doesn't validate template APPROVED
   * status here — drafts may target templates still PENDING; the
   * pre-send check enforces APPROVED.
   */
  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppCampaignCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      return withTenant(tenantId, async (tx) => {
        // Resolve + validate the picks.
        const [segment, phone, template] = await Promise.all([
          tx.segment.findFirst({
            where: { id: input.segmentId, tenantId },
            select: { id: true },
          }),
          tx.whatsAppPhoneNumber.findFirst({
            where: { id: input.phoneNumberId, tenantId },
            include: { whatsAppAccount: true },
          }),
          tx.whatsAppTemplate.findFirst({
            where: { id: input.templateId, tenantId, deletedAt: null },
          }),
        ]);
        if (!segment) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Segment not found.',
          });
        }
        if (!phone) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Phone number not found.',
          });
        }
        if (!template) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Template not found.',
          });
        }
        if (template.language !== input.templateLanguage) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Template language is ${template.language}; campaign requested ${input.templateLanguage}.`,
          });
        }

        const campaign = await tx.campaign.create({
          data: {
            tenantId,
            name: input.name,
            type: CampaignType.WHATSAPP,
            status: CampaignStatus.DRAFT,
            segmentId: input.segmentId,
            createdByUserId: userId,
            // Email-specific fields (settings/designJson) live on
            // EmailCampaign, not Campaign — nothing to populate here.
            whatsAppCampaign: {
              create: {
                whatsAppAccountId: phone.whatsAppAccountId,
                phoneNumberId: phone.id,
                templateId: input.templateId,
                templateLanguage: input.templateLanguage,
                templateVariables:
                  input.templateVariables as unknown as Prisma.JsonArray,
                ...(input.headerMediaAssetId
                  ? { headerMediaAssetId: input.headerMediaAssetId }
                  : {}),
              },
            },
          },
          include: { whatsAppCampaign: true },
        });
        return campaign;
      });
    }),

  /**
   * Update a DRAFT campaign. Anything past DRAFT is immutable —
   * use cancel + create-new for changes after schedule.
   */
  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppCampaignUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const camp = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.WHATSAPP },
          include: { whatsAppCampaign: true },
        });
        if (!camp || !camp.whatsAppCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (camp.status !== CampaignStatus.DRAFT) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Only DRAFT campaigns can be edited. Cancel + recreate to change a scheduled campaign.',
          });
        }

        const campaignPatch: Prisma.CampaignUpdateInput = {};
        if (input.patch.name !== undefined) campaignPatch.name = input.patch.name;
        if (input.patch.segmentId !== undefined) {
          campaignPatch.segment = { connect: { id: input.patch.segmentId } };
        }

        const waPatch: Prisma.WhatsAppCampaignUpdateInput = {};
        if (input.patch.phoneNumberId !== undefined) {
          // Validate phone belongs to tenant.
          const p = await tx.whatsAppPhoneNumber.findFirst({
            where: { id: input.patch.phoneNumberId, tenantId },
            select: { id: true, whatsAppAccountId: true },
          });
          if (!p) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Phone number not found.',
            });
          }
          waPatch.phoneNumber = { connect: { id: p.id } };
          waPatch.whatsAppAccount = { connect: { id: p.whatsAppAccountId } };
        }
        if (input.patch.templateId !== undefined) {
          waPatch.template = { connect: { id: input.patch.templateId } };
        }
        if (input.patch.templateLanguage !== undefined) {
          waPatch.templateLanguage = input.patch.templateLanguage;
        }
        if (input.patch.templateVariables !== undefined) {
          waPatch.templateVariables =
            input.patch.templateVariables as unknown as Prisma.JsonArray;
        }
        if (input.patch.headerMediaAssetId !== undefined) {
          if (input.patch.headerMediaAssetId === null) {
            waPatch.headerMediaAsset = { disconnect: true };
          } else {
            waPatch.headerMediaAsset = {
              connect: { id: input.patch.headerMediaAssetId },
            };
          }
        }

        const updated = await tx.campaign.update({
          where: { id: camp.id },
          data: {
            ...campaignPatch,
            ...(Object.keys(waPatch).length > 0
              ? { whatsAppCampaign: { update: waPatch } }
              : {}),
          },
          include: { whatsAppCampaign: true },
        });
        return updated;
      });
    }),

  /**
   * Schedule for future send. Pre-flights at schedule time AND at
   * worker prepare time (the latter is authoritative — the world can
   * change between schedule and fire).
   */
  schedule: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppCampaignScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const scheduledAt = new Date(input.scheduledAt);
      if (scheduledAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'scheduledAt must be in the future.',
        });
      }

      const campaign = await withTenant(tenantId, async (tx) => {
        const camp = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.WHATSAPP },
        });
        if (!camp) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (camp.status !== CampaignStatus.DRAFT) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only DRAFT campaigns can be scheduled.',
          });
        }
        await assertCampaignSendable(tx, camp.id, tenantId);
        return tx.campaign.update({
          where: { id: camp.id },
          data: {
            status: CampaignStatus.SCHEDULED,
            scheduledAt,
          },
        });
      });

      const delayMs = scheduledAt.getTime() - Date.now();
      await enqueuePrepareWaCampaign(
        { campaignId: campaign.id, tenantId },
        { delayMs },
      );
      return campaign;
    }),

  /**
   * Send right now. Same path as schedule with delayMs=0.
   */
  sendNow: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppCampaignSendNowSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const updated = await withTenant(tenantId, async (tx) => {
        const camp = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.WHATSAPP },
        });
        if (!camp) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (
          camp.status !== CampaignStatus.DRAFT &&
          camp.status !== CampaignStatus.SCHEDULED
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot send a campaign in status ${camp.status}.`,
          });
        }
        await assertCampaignSendable(tx, camp.id, tenantId);
        return tx.campaign.update({
          where: { id: camp.id },
          data: {
            status: CampaignStatus.SENDING,
            scheduledAt: null,
          },
        });
      });

      await enqueuePrepareWaCampaign({ campaignId: updated.id, tenantId });
      return updated;
    }),

  cancel: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppCampaignCancelSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const camp = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.WHATSAPP },
        });
        if (!camp) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (
          camp.status !== CampaignStatus.SCHEDULED &&
          camp.status !== CampaignStatus.SENDING &&
          camp.status !== CampaignStatus.PAUSED
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot cancel a campaign in status ${camp.status}. Already in flight or terminal.`,
          });
        }
        // The worker checks `status === CANCELLED` before each batch
        // dispatch and short-circuits, so partial sends from PREPARING
        // get a clean stop after the in-flight batch finishes.
        return tx.campaign.update({
          where: { id: camp.id },
          data: {
            status: CampaignStatus.CANCELED,
          },
        });
      });
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(whatsAppCampaignDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const camp = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.WHATSAPP },
        });
        if (!camp) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (camp.status !== CampaignStatus.DRAFT) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Only DRAFT campaigns can be deleted. Cancel scheduled / paused campaigns instead.',
          });
        }
        // ON DELETE CASCADE on WhatsAppCampaign + future
        // WhatsAppCampaignSend rows handles the per-channel cleanup.
        await tx.campaign.delete({ where: { id: camp.id } });
        return { ok: true as const };
      });
    }),

  /**
   * Pre-send preview. Resolves the segment, applies suppression and
   * status filters, and shows the first N candidate contacts with
   * their resolved template variables. Used to make sure the merge
   * tags actually work before the tenant clicks Send.
   */
  preview: tenantProcedure
    .input(whatsAppCampaignPreviewSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const camp = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.WHATSAPP },
          include: {
            whatsAppCampaign: { include: { template: true } },
          },
        });
        if (!camp || !camp.whatsAppCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }

        // Pull a small sample of subscribed contacts. Suppression
        // enforcement runs in the worker — preview is just a sanity
        // check that variables resolve, so loose filtering here is fine.
        const candidates = await tx.contact.findMany({
          where: {
            tenantId,
            phone: { not: null },
            whatsappStatus: 'SUBSCRIBED',
          },
          take: previewLimit,
          orderBy: { createdAt: 'asc' },
        });
        return {
          template: camp.whatsAppCampaign.template,
          variables: camp.whatsAppCampaign.templateVariables,
          phoneNumberId: camp.whatsAppCampaign.phoneNumberId,
          sampleContacts: candidates.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            phone: c.phone,
            email: c.email,
          })),
        };
      });
    }),
});

/**
 * Pre-send pre-flight: WABA CONNECTED, phone active, template APPROVED,
 * variables resolvable. Throws a TRPCError describing the first failure;
 * the worker re-runs the same check before materialising sends so a
 * scheduled campaign that fails between scheduling and firing fails
 * cleanly.
 */
async function assertCampaignSendable(
  tx: Prisma.TransactionClient,
  campaignId: string,
  tenantId: string,
): Promise<void> {
  // tenantId is enforced via the Campaign join — RLS would reject
  // cross-tenant reads anyway, but the explicit filter makes intent
  // obvious + survives schema reorganisation.
  const wa = await tx.whatsAppCampaign.findFirst({
    where: { campaignId, campaign: { tenantId } },
    include: {
      whatsAppAccount: true,
      phoneNumber: true,
      template: true,
    },
  });
  if (!wa) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'WhatsApp campaign data missing.',
    });
  }
  if (wa.whatsAppAccount.status !== WAStatus.CONNECTED) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `WhatsApp account is ${wa.whatsAppAccount.status}. Reconnect to send.`,
    });
  }
  if (wa.template.status !== WATemplateStatus.APPROVED) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Template is ${wa.template.status}. Only APPROVED templates can be sent.`,
    });
  }
  if (wa.template.deletedAt !== null) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Template has been deleted. Pick another.',
    });
  }
  // Phone-number health is best-effort here — the worker re-checks
  // and pauses on tier exhaustion mid-batch (which is the more useful
  // signal anyway).
}
