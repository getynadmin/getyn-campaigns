import { TRPCError } from '@trpc/server';

import {
  CampaignStatus,
  CampaignType,
  PlanMetric,
  Role,
  withTenant,
} from '@getyn/db';
import {
  smsCampaignCancelSchema,
  smsCampaignCreateSchema,
  smsCampaignDeleteSchema,
  smsCampaignScheduleSchema,
  smsCampaignSendNowSchema,
  smsCampaignUpdateSchema,
} from '@getyn/types';

import { assertTenantActive } from '@/server/billing/assert-active';
import { assertWithinLimit } from '@/server/billing/assert-limit';
import { estimateSmsSegments } from '@/server/integrations/twilio';
import { enqueuePrepareSmsCampaign } from '@/server/queues';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * SMS campaign router. 1:1 with Campaign(type=SMS). Mirrors the
 * WhatsApp router's lifecycle: DRAFT → SCHEDULED | SENDING → SENT.
 * Twilio is the only provider today; adding Telnyx later is a row
 * in Plan.sms-provider + a new dispatch branch in the worker.
 */
export const smsCampaignsRouter = createTRPCRouter({
  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(smsCampaignCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;
      return withTenant(tenantId, async (tx) => {
        const segment = await tx.segment.findFirst({
          where: { id: input.segmentId, tenantId },
          select: { id: true },
        });
        if (!segment) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Segment not found.',
          });
        }
        const { segments: perMessageSegments } = estimateSmsSegments(
          input.body,
        );
        const campaign = await tx.campaign.create({
          data: {
            tenantId,
            type: CampaignType.SMS,
            name: input.name,
            segmentId: input.segmentId,
            status: CampaignStatus.DRAFT,
            createdByUserId: userId,
            smsCampaign: {
              create: {
                body: input.body,
                fromNumber: input.fromNumber || null,
                segmentsPerMessage: perMessageSegments,
              },
            },
          },
          include: { smsCampaign: true },
        });
        return campaign;
      });
    }),

  get: tenantProcedure
    .input(smsCampaignCancelSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.SMS },
          include: { smsCampaign: true, segment: true },
        });
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        return row;
      });
    }),

  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(smsCampaignUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.campaign.findFirst({
          where: {
            id: input.id,
            tenantId,
            type: CampaignType.SMS,
            status: CampaignStatus.DRAFT,
          },
          include: { smsCampaign: true },
        });
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Draft SMS campaign not found.',
          });
        }
        const newBody = input.body ?? row.smsCampaign?.body ?? '';
        const perMessageSegments = estimateSmsSegments(newBody).segments;
        await tx.campaign.update({
          where: { id: row.id },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.segmentId ? { segmentId: input.segmentId } : {}),
            smsCampaign: {
              update: {
                ...(input.body !== undefined
                  ? { body: input.body, segmentsPerMessage: perMessageSegments }
                  : {}),
                ...(input.fromNumber !== undefined
                  ? { fromNumber: input.fromNumber || null }
                  : {}),
              },
            },
          },
        });
        return { ok: true as const };
      });
    }),

  sendNow: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(smsCampaignSendNowSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      await assertTenantActive(tenantId);
      const row = await withTenant(tenantId, async (tx) =>
        tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.SMS },
          include: { smsCampaign: true, segment: true },
        }),
      );
      if (!row || !row.smsCampaign) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (row.status !== CampaignStatus.DRAFT) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Campaign is not in DRAFT state.',
        });
      }
      // Gating: estimate = per-message segments × cached contact count
      // (fresh count would require re-running segment rules; cheap
      // overestimate is fine — worker rechecks per-contact on dispatch).
      const estRecipients = row.segment?.cachedCount ?? 0;
      const totalSegments =
        row.smsCampaign.segmentsPerMessage * Math.max(estRecipients, 1);
      await assertWithinLimit(
        tenantId,
        PlanMetric.SMS_SEGMENTS_PER_MONTH,
        totalSegments,
      );
      await withTenant(tenantId, async (tx) => {
        await tx.campaign.update({
          where: { id: row.id },
          data: { status: CampaignStatus.SENDING, sentAt: new Date() },
        });
      });
      await enqueuePrepareSmsCampaign({ campaignId: row.id, tenantId });
      return { ok: true as const };
    }),

  schedule: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(smsCampaignScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const when = new Date(input.scheduledAt);
      if (when.getTime() <= Date.now()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'scheduledAt must be in the future.',
        });
      }
      await withTenant(tenantId, async (tx) => {
        const row = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.SMS },
        });
        if (!row || row.status !== CampaignStatus.DRAFT) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only DRAFT campaigns can be scheduled.',
          });
        }
        await tx.campaign.update({
          where: { id: row.id },
          data: { status: CampaignStatus.SCHEDULED, scheduledAt: when },
        });
      });
      await enqueuePrepareSmsCampaign(
        { campaignId: input.id, tenantId },
        { delayMs: Math.max(0, when.getTime() - Date.now()) },
      );
      return { ok: true as const };
    }),

  cancel: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(smsCampaignCancelSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.SMS },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        if (
          row.status !== CampaignStatus.DRAFT &&
          row.status !== CampaignStatus.SCHEDULED
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Can only cancel DRAFT or SCHEDULED campaigns.',
          });
        }
        await tx.campaign.update({
          where: { id: row.id },
          data: { status: CampaignStatus.CANCELED },
        });
        return { ok: true as const };
      });
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(smsCampaignDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.campaign.findFirst({
          where: { id: input.id, tenantId, type: CampaignType.SMS },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        if (row.status === CampaignStatus.SENDING) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot delete a campaign that is currently sending.',
          });
        }
        await tx.campaign.delete({ where: { id: row.id } });
        return { ok: true as const };
      });
    }),
});
