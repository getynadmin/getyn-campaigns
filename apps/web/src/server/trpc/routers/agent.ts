import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  AgentChannel,
  AgentConversationStatus,
  PlanMetric,
  Role,
  prisma,
  withTenant,
} from '@getyn/db';
import {
  cuidSchema,
  isBrandProfileComplete,
} from '@getyn/types';

import { renderEmailPlanHtml } from '@/server/agent/email-plan-renderer';
import { emitAgentEvent } from '@/server/analytics/agent-events';
import { assertTenantActive } from '@/server/billing/assert-active';
import { assertWithinLimit } from '@/server/billing/assert-limit';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Phase 7 M2 — agent conversation lifecycle.
 *
 * Streaming lives at /api/agent/[conversationId]/stream — this router
 * handles everything else: starting a new conversation (after brand
 * profile + plan-limit checks), reading conversation history for the
 * chat UI, listing recent conversations for the resume page, and
 * abandoning the current one.
 *
 * Only OWNER / ADMIN / EDITOR can start conversations. VIEWER can't
 * spend agent credits.
 */

const channelSchema = z.nativeEnum(AgentChannel);

export const agentRouter = createTRPCRouter({
  /**
   * Start a new ACTIVE conversation. Pre-checks:
   *   - tenant is in writable state (not READ_ONLY / SUSPENDED / PURGING)
   *   - brand profile is complete (agent reads it on every turn)
   *   - plan limit for the new metric (+1 conversation) is not exceeded
   *
   * Returns the conversation id; the chat UI navigates to it.
   */
  startConversation: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        channel: channelSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      await assertTenantActive(tenantId);
      await assertWithinLimit(
        tenantId,
        PlanMetric.AI_AGENT_CONVERSATIONS_PER_MONTH,
        1,
      );

      const profile = await withTenant(tenantId, (tx) =>
        tx.tenantBrandProfile.findUnique({ where: { tenantId } }),
      );
      const isComplete = profile
        ? isBrandProfileComplete({
            brandName: profile.brandName,
            brandDescription: profile.brandDescription,
            primaryColor: profile.primaryColor,
          })
        : false;
      if (!isComplete) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Set up your brand profile first — the agent needs your brand name, description, and primary color before it can run.',
        });
      }

      const convo = await withTenant(tenantId, (tx) =>
        tx.agentConversation.create({
          data: {
            tenantId,
            createdByUserId: userId,
            channel: input.channel,
            status: AgentConversationStatus.ACTIVE,
          },
          select: { id: true },
        }),
      );
      emitAgentEvent('agent.conversation.started', {
        conversationId: convo.id,
        tenantId,
        userId,
        channel: input.channel,
      });
      return { conversationId: convo.id };
    }),

  /**
   * Single-conversation fetch — header + message history + producedCampaignId.
   * The chat UI loads this on mount and after the stream completes
   * to render any newly-persisted messages.
   */
  getConversation: tenantProcedure
    .input(z.object({ id: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const convo = await withTenant(tenantId, (tx) =>
        tx.agentConversation.findFirst({
          where: { id: input.id, tenantId },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
              take: 200,
            },
          },
        }),
      );
      if (!convo) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Conversation not found.',
        });
      }
      return convo;
    }),

  /**
   * Recent conversations for the resume page. Default: last 50.
   * Filters: status + channel.
   */
  listConversations: tenantProcedure
    .input(
      z
        .object({
          status: z.nativeEnum(AgentConversationStatus).optional(),
          channel: channelSchema.optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const rows = await withTenant(tenantId, (tx) =>
        tx.agentConversation.findMany({
          where: {
            tenantId,
            ...(input.status ? { status: input.status } : {}),
            ...(input.channel ? { channel: input.channel } : {}),
          },
          orderBy: { lastMessageAt: 'desc' },
          take: input.limit,
          select: {
            id: true,
            channel: true,
            status: true,
            goal: true,
            title: true,
            producedCampaignId: true,
            lastMessageAt: true,
            createdAt: true,
            tokensUsed: true,
            costCents: true,
          },
        }),
      );
      return rows;
    }),

  /**
   * Phase 7 M5 — render the current design plan as preview HTML.
   * Used by the email channel's right-pane preview. WhatsApp does
   * its own phone-frame render client-side from the conversation
   * state.
   */
  renderEmailPreview: tenantProcedure
    .input(z.object({ conversationId: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const convo = await withTenant(tenantId, (tx) =>
        tx.agentConversation.findFirst({
          where: { id: input.conversationId, tenantId },
          select: { channel: true, conversationState: true },
        }),
      );
      if (!convo || convo.channel !== AgentChannel.EMAIL) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Email conversation not found.',
        });
      }
      const state = (convo.conversationState as Record<string, unknown>) ?? {};
      const plan = (state.designPlan as
        | Array<{ slug: string; content: Record<string, unknown> }>
        | undefined) ?? [];
      const brand = await withTenant(tenantId, (tx) =>
        tx.tenantBrandProfile.findUnique({ where: { tenantId } }),
      );
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { postalAddress: true },
      });
      const html = await renderEmailPlanHtml({
        plan,
        brand,
        postalAddress: tenant?.postalAddress ?? null,
      });
      return { html, blockCount: plan.length };
    }),

  /**
   * Mark conversation ABANDONED. Idempotent. Tenant can resume new
   * ones; the agent will skip ABANDONED rows when counting against
   * the plan limit (see assert-limit).
   */
  abandonConversation: tenantProcedure
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;
      let channelEmitted: 'EMAIL' | 'WHATSAPP' | null = null;
      await withTenant(tenantId, async (tx) => {
        const convo = await tx.agentConversation.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, status: true, channel: true },
        });
        if (!convo) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Conversation not found.',
          });
        }
        if (convo.status === AgentConversationStatus.COMPLETED_DRAFT_CREATED) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              "This conversation already produced a draft — abandoning it won't take it back.",
          });
        }
        if (convo.status === AgentConversationStatus.ABANDONED) return;
        await tx.agentConversation.update({
          where: { id: input.id },
          data: { status: AgentConversationStatus.ABANDONED },
        });
        channelEmitted = convo.channel;
      });
      if (channelEmitted) {
        emitAgentEvent('agent.conversation.abandoned', {
          conversationId: input.id,
          tenantId,
          userId,
          channel: channelEmitted,
        });
      }
      return { ok: true as const };
    }),
});
