import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { decrypt, type EncryptedField } from '@getyn/crypto';
import {
  ContactEventType,
  Role,
  WAConversationStatus,
  WAMessageDirection,
  WAMessageType,
  WASendStatus,
  WAStatus,
  withTenant,
  type Prisma,
} from '@getyn/db';
import { MetaApiError, sendTemplateMessage } from '@getyn/whatsapp';

// Phase 4 M10 — inbox tRPC.
//
// Read surface:
//   listConversations  — paginated, filterable
//   getConversation    — one conversation with metadata
//   listMessages       — thread, paginated infinite-scroll up
//   getServiceWindow   — derived from lastInboundAt
//
// Write surface:
//   markAsRead         — zero unreadCount
//   assign             — assignedToUserId (any tenant member)
//   close / reopen     — status flip
//   sendTextReply      — free-form within service window (text only,
//                        media uploads land in M9.5 / asset pipeline)
//   sendTemplateReply  — APPROVED template outside service window
//
// Permissions: every tenant member can read + write to inbox. CLOSE
// is OWNER/ADMIN only (matches the rest of the WhatsApp surface for
// destructive-ish actions).

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

const idSchema = z.object({ id: z.string().min(1).max(64) });

const conversationListInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(25),
  filter: z
    .enum(['all', 'unread', 'mine', 'open', 'closed'])
    .default('all'),
  search: z.string().trim().min(1).max(120).optional(),
});

const messagesListInputSchema = z.object({
  conversationId: z.string().min(1).max(64),
  cursor: z.string().min(1).optional(),
  /** "older" pages backwards in time; "newer" used by the realtime gap-fill. */
  direction: z.enum(['older', 'newer']).default('older'),
  limit: z.number().int().min(1).max(100).default(50),
});

const sendTextSchema = z.object({
  conversationId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(4096),
  replyToMessageId: z.string().min(1).max(64).optional(),
});

const sendTemplateReplySchema = z.object({
  conversationId: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
  templateLanguage: z.string().min(2).max(10),
  bodyParams: z.array(z.string().max(1024)).max(10).default([]),
});

const assignSchema = z.object({
  conversationId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64).nullable(),
});

export const whatsAppInboxRouter = createTRPCRouter({
  listConversations: tenantProcedure
    .input(conversationListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;
      return withTenant(tenantId, async (tx) => {
        const where: Prisma.WhatsAppConversationWhereInput = {
          tenantId,
          ...(input.filter === 'unread' ? { unreadCount: { gt: 0 } } : {}),
          ...(input.filter === 'mine' ? { assignedToUserId: userId } : {}),
          ...(input.filter === 'open'
            ? { status: WAConversationStatus.OPEN }
            : {}),
          ...(input.filter === 'closed'
            ? { status: WAConversationStatus.CLOSED }
            : {}),
          ...(input.search
            ? {
                OR: [
                  { contactPhone: { contains: input.search } },
                  {
                    contact: {
                      is: {
                        OR: [
                          { firstName: { contains: input.search, mode: 'insensitive' } },
                          { lastName: { contains: input.search, mode: 'insensitive' } },
                        ],
                      },
                    },
                  },
                ],
              }
            : {}),
        };
        const rows = await tx.whatsAppConversation.findMany({
          where,
          include: {
            contact: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            assignedTo: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        });
        let nextCursor: string | null = null;
        if (rows.length > input.limit) {
          const next = rows.pop();
          nextCursor = next?.id ?? null;
        }
        return { items: rows, nextCursor };
      });
    }),

  getConversation: tenantProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const conv = await withTenant(tenantId, (tx) =>
        tx.whatsAppConversation.findFirst({
          where: { id: input.id, tenantId },
          include: {
            contact: true,
            assignedTo: { select: { id: true, name: true, email: true } },
            phoneNumber: true,
          },
        }),
      );
      if (!conv) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found.' });
      }
      return conv;
    }),

  listMessages: tenantProcedure
    .input(messagesListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const conv = await tx.whatsAppConversation.findFirst({
          where: { id: input.conversationId, tenantId },
          select: { id: true },
        });
        if (!conv) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Conversation not found.',
          });
        }

        // "older" returns DESC + reverses on the client, so newest-
        // first paging is natural; "newer" returns ASC for realtime
        // catch-up.
        const order: Prisma.SortOrder =
          input.direction === 'older' ? 'desc' : 'asc';

        const rows = await tx.whatsAppMessage.findMany({
          where: { tenantId, conversationId: input.conversationId },
          include: {
            sentBy: { select: { id: true, name: true } },
            mediaAsset: true,
          },
          orderBy: { createdAt: order },
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        });
        let nextCursor: string | null = null;
        if (rows.length > input.limit) {
          const next = rows.pop();
          nextCursor = next?.id ?? null;
        }
        return { items: rows, nextCursor };
      });
    }),

  markAsRead: tenantProcedure
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, (tx) =>
        tx.whatsAppConversation.update({
          where: { id: input.id },
          data: { unreadCount: 0 },
        }),
      );
    }),

  assign: tenantProcedure
    .input(assignSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      // Validate the assignee belongs to this tenant if non-null.
      if (input.userId) {
        const m = await withTenant(tenantId, (tx) =>
          tx.membership.findUnique({
            where: { userId_tenantId: { userId: input.userId!, tenantId } },
            select: { userId: true },
          }),
        );
        if (!m) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'User is not a member of this workspace.',
          });
        }
      }
      return withTenant(tenantId, (tx) =>
        tx.whatsAppConversation.update({
          where: { id: input.conversationId },
          data: { assignedToUserId: input.userId },
        }),
      );
    }),

  close: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, (tx) =>
        tx.whatsAppConversation.update({
          where: { id: input.id },
          data: { status: WAConversationStatus.CLOSED },
        }),
      );
    }),

  reopen: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, (tx) =>
        tx.whatsAppConversation.update({
          where: { id: input.id },
          data: { status: WAConversationStatus.OPEN },
        }),
      );
    }),

  /**
   * Free-form text reply within the 24h service window. Outside the
   * window callers must use `sendTemplateReply`.
   */
  sendTextReply: tenantProcedure
    .input(sendTextSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      const conv = await withTenant(tenantId, (tx) =>
        tx.whatsAppConversation.findFirst({
          where: { id: input.conversationId, tenantId },
          include: {
            phoneNumber: { include: { whatsAppAccount: true } },
          },
        }),
      );
      if (!conv) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (
        !conv.serviceWindowExpiresAt ||
        conv.serviceWindowExpiresAt < new Date()
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Service window is closed. Send a template message instead.',
        });
      }
      if (
        conv.phoneNumber.whatsAppAccount.status !== WAStatus.CONNECTED
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'WhatsApp account is not connected.',
        });
      }

      const accessToken = decrypt(
        conv.phoneNumber.whatsAppAccount
          .accessTokenEncrypted as unknown as EncryptedField,
        tenantId,
      );

      // Send via the Meta /{phoneNumberId}/messages endpoint with
      // type=text. We reuse sendTemplateMessage's underlying helper
      // by calling Meta directly — keep helpers tight; if reply
      // volume grows we'll lift this into @getyn/whatsapp.
      const toBare = conv.contactPhone.replace(/^\+/, '');
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(conv.phoneNumber.phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toBare,
            type: 'text',
            text: { body: input.body },
            ...(input.replyToMessageId
              ? { context: { message_id: input.replyToMessageId } }
              : {}),
          }),
        },
      );
      if (!resp.ok) {
        const text = await resp.text();
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Meta rejected the reply: ${text.slice(0, 300)}`,
        });
      }
      const json = (await resp.json()) as {
        messages: Array<{ id: string }>;
      };
      const metaMessageId = json.messages[0]?.id ?? null;
      const now = new Date();

      return withTenant(tenantId, async (tx) => {
        const msg = await tx.whatsAppMessage.create({
          data: {
            tenantId,
            conversationId: conv.id,
            direction: WAMessageDirection.OUTBOUND,
            metaMessageId,
            type: WAMessageType.TEXT,
            body: input.body,
            replyToMessageId: input.replyToMessageId ?? null,
            status: WASendStatus.SENT,
            sentAt: now,
            sentByUserId: userId,
            metadata: {} as Prisma.JsonObject,
          },
        });
        // Outbound replies do NOT extend serviceWindowExpiresAt.
        await tx.whatsAppConversation.update({
          where: { id: conv.id },
          data: {
            lastOutboundAt: now,
            lastMessageAt: now,
            lastMessagePreview: input.body.slice(0, 120),
          },
        });
        if (conv.contactId) {
          await tx.contactEvent.create({
            data: {
              tenantId,
              contactId: conv.contactId,
              type: ContactEventType.WHATSAPP_SENT,
              metadata: { conversationId: conv.id } as Prisma.JsonObject,
            },
          });
        }
        return msg;
      });
    }),

  sendTemplateReply: tenantProcedure
    .input(sendTemplateReplySchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      const conv = await withTenant(tenantId, (tx) =>
        tx.whatsAppConversation.findFirst({
          where: { id: input.conversationId, tenantId },
          include: {
            phoneNumber: { include: { whatsAppAccount: true } },
          },
        }),
      );
      if (!conv) throw new TRPCError({ code: 'NOT_FOUND' });
      if (conv.phoneNumber.whatsAppAccount.status !== WAStatus.CONNECTED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'WhatsApp account is not connected.',
        });
      }

      const tpl = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.findFirst({
          where: { id: input.templateId, tenantId, deletedAt: null },
        }),
      );
      if (!tpl) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
      }
      if (tpl.status !== 'APPROVED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only APPROVED templates can be sent.',
        });
      }

      const accessToken = decrypt(
        conv.phoneNumber.whatsAppAccount
          .accessTokenEncrypted as unknown as EncryptedField,
        tenantId,
      );

      let resp;
      try {
        resp = await sendTemplateMessage(
          conv.phoneNumber.phoneNumberId,
          accessToken,
          {
            to: conv.contactPhone,
            templateName: tpl.name,
            templateLanguage: input.templateLanguage,
            bodyParams: input.bodyParams,
          },
        );
      } catch (err) {
        if (err instanceof MetaApiError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Meta rejected the template send: ${err.message}`,
            cause: err,
          });
        }
        throw err;
      }
      const metaMessageId = resp.messages[0]?.id ?? null;
      const now = new Date();

      return withTenant(tenantId, async (tx) => {
        const msg = await tx.whatsAppMessage.create({
          data: {
            tenantId,
            conversationId: conv.id,
            direction: WAMessageDirection.OUTBOUND,
            metaMessageId,
            type: WAMessageType.TEMPLATE,
            templateId: tpl.id,
            templateVariables: input.bodyParams as unknown as Prisma.JsonArray,
            status: WASendStatus.SENT,
            sentAt: now,
            sentByUserId: userId,
            metadata: {} as Prisma.JsonObject,
          },
        });
        await tx.whatsAppConversation.update({
          where: { id: conv.id },
          data: {
            lastOutboundAt: now,
            lastMessageAt: now,
            lastMessagePreview: `Template: ${tpl.name}`,
          },
        });
        return msg;
      });
    }),
});
