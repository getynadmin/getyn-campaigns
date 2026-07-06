import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  EmailAgentMessageStatus,
  EnrollmentStatus,
  Role,
  withTenant,
} from '@getyn/db';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Phase 8 M5 — Approval Inbox tRPC.
 *
 * The engine writes DRAFT_AWAITING_APPROVAL rows on inbound replies.
 * Operators triage them here — approve/edit/reject/exit — and the
 * agent continues or halts based on the choice.
 *
 * Every mutation touches at most a small handful of rows; the queue
 * is designed for humans clicking through, not batch operations.
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

export const emailAgentInboxRouter = createTRPCRouter({
  /**
   * List pending drafts, newest first. Includes the enrollment +
   * agent + contact info so the client can render each row without a
   * follow-up query.
   *
   * Backed by the partial index
   * `EmailAgentMessage_approval_inbox_idx` — the filter here matches
   * that predicate exactly.
   */
  list: tenantProcedure
    .input(
      z.object({
        cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        emailAgentId: z.string().min(1).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const rows = await tx.emailAgentMessage.findMany({
          where: {
            tenantId,
            status: EmailAgentMessageStatus.DRAFT_AWAITING_APPROVAL,
            ...(input.emailAgentId
              ? { enrollment: { emailAgentId: input.emailAgentId } }
              : {}),
          },
          include: {
            enrollment: {
              select: {
                id: true,
                emailAgent: {
                  select: { id: true, name: true, tone: true, fromEmail: true, signature: true },
                },
                contact: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

  /**
   * Full detail: draft + the most recent inbound message it's
   * replying to. Used by the side panel.
   */
  get: tenantProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const message = await tx.emailAgentMessage.findFirst({
        where: { id: input.id, tenantId },
        include: {
          enrollment: {
            select: {
              id: true,
              currentStep: true,
              lastInboundAt: true,
              emailAgent: {
                select: { id: true, name: true, tone: true, goal: true, fromEmail: true, signature: true },
              },
              contact: {
                select: { id: true, email: true, firstName: true, lastName: true },
              },
            },
          },
        },
      });
      if (!message) throw new TRPCError({ code: 'NOT_FOUND' });
      const thread = await tx.emailAgentMessage.findMany({
        where: { enrollmentId: message.enrollmentId, tenantId },
        select: {
          id: true,
          direction: true,
          subject: true,
          bodyText: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      return { message, thread };
    });
  }),

  /**
   * Approve as-is: flip status → SENT, dispatch via Resend, resume
   * the enrollment. If Resend fails we surface the error so the
   * operator can retry.
   */
  approve: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const message = await loadDraftForApproval(tx, tenantId, input.id);
        await sendDraftInline(message, ctx.user.id, tx);
        return { ok: true as const };
      });
    }),

  /**
   * Edit before sending. Same as approve, but with the edited
   * subject + body. Body accepted as plain text; HTML rendered by
   * the same paragraph-wrap helper the engine uses.
   */
  editAndSend: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        subject: z.string().trim().min(1).max(500),
        bodyText: z.string().trim().min(1).max(50_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const message = await loadDraftForApproval(tx, tenantId, input.id);
        await sendDraftInline(
          { ...message, subject: input.subject, bodyText: input.bodyText, bodyHtml: textToHtml(input.bodyText) },
          ctx.user.id,
          tx,
        );
        return { ok: true as const };
      });
    }),

  /**
   * Reject: keep the enrollment paused (agent stays quiet on this
   * thread until the next inbound). Records reason for audit.
   */
  reject: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const message = await tx.emailAgentMessage.findFirst({
          where: {
            id: input.id,
            tenantId,
            status: EmailAgentMessageStatus.DRAFT_AWAITING_APPROVAL,
          },
          select: { id: true },
        });
        if (!message) throw new TRPCError({ code: 'NOT_FOUND' });
        await tx.emailAgentMessage.update({
          where: { id: message.id },
          data: {
            status: EmailAgentMessageStatus.REJECTED,
            rejectionReason: input.reason ?? null,
            approvedByUserId: ctx.user.id,
            approvedAt: new Date(),
          },
        });
        return { ok: true as const };
      });
    }),

  /**
   * Exit the whole enrollment. Marks the draft as REJECTED and the
   * enrollment as EXITED. Reached by "Exit" button + X shortcut.
   */
  exit: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const message = await tx.emailAgentMessage.findFirst({
          where: {
            id: input.id,
            tenantId,
            status: EmailAgentMessageStatus.DRAFT_AWAITING_APPROVAL,
          },
          select: { id: true, enrollmentId: true },
        });
        if (!message) throw new TRPCError({ code: 'NOT_FOUND' });
        await tx.$transaction([
          tx.emailAgentMessage.update({
            where: { id: message.id },
            data: {
              status: EmailAgentMessageStatus.REJECTED,
              rejectionReason: 'operator_exit',
              approvedByUserId: ctx.user.id,
              approvedAt: new Date(),
            },
          }),
          tx.emailAgentEnrollment.update({
            where: { id: message.enrollmentId },
            data: {
              status: EnrollmentStatus.EXITED,
              exitReason: 'operator_exit',
              completedAt: new Date(),
              nextActionAt: null,
            },
          }),
        ]);
        return { ok: true as const };
      });
    }),

  /**
   * Total pending count — for the sidebar badge.
   */
  pendingCount: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const total = await tx.emailAgentMessage.count({
        where: {
          tenantId,
          status: EmailAgentMessageStatus.DRAFT_AWAITING_APPROVAL,
        },
      });
      return { total };
    });
  }),
});

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

type DraftShape = {
  id: string;
  tenantId: string;
  enrollmentId: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  enrollment: {
    id: string;
    emailAgent: {
      id: string;
      fromName: string;
      fromEmail: string;
      signature: string;
    };
    contact: { email: string | null };
  };
};

async function loadDraftForApproval(
  tx: Parameters<typeof withTenant>[1] extends (tx: infer T) => unknown ? T : never,
  tenantId: string,
  id: string,
): Promise<DraftShape> {
  const message = await tx.emailAgentMessage.findFirst({
    where: {
      id,
      tenantId,
      status: EmailAgentMessageStatus.DRAFT_AWAITING_APPROVAL,
    },
    include: {
      enrollment: {
        select: {
          id: true,
          emailAgent: {
            select: { id: true, fromName: true, fromEmail: true, signature: true },
          },
          contact: { select: { email: true } },
        },
      },
    },
  });
  if (!message) throw new TRPCError({ code: 'NOT_FOUND' });
  return message as unknown as DraftShape;
}

async function sendDraftInline(
  draft: DraftShape,
  approvedByUserId: string,
  tx: Parameters<typeof withTenant>[1] extends (tx: infer T) => unknown ? T : never,
): Promise<void> {
  const { Resend } = await import('resend');
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'RESEND_API_KEY not configured — cannot send.',
    });
  }
  if (!draft.enrollment.contact.email) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Contact has no email address.',
    });
  }
  const resend = new Resend(apiKey);
  const { buildReplyToAddress } = await import('@getyn/crypto');
  const replyTo = buildReplyToAddress(
    'a',
    { id: draft.enrollmentId, tenantId: draft.tenantId },
    {
      secret: process.env.REPLY_ROUTING_SECRET ?? null,
      inboundDomain: process.env.REPLY_INBOUND_DOMAIN ?? null,
    },
  );
  const finalBodyText =
    draft.bodyText +
    (draft.enrollment.emailAgent.signature ? `\n\n${draft.enrollment.emailAgent.signature}` : '');
  const finalBodyHtml = textToHtml(finalBodyText);
  const result = await resend.emails.send({
    from: `${draft.enrollment.emailAgent.fromName} <${draft.enrollment.emailAgent.fromEmail}>`,
    to: draft.enrollment.contact.email,
    subject: draft.subject,
    html: finalBodyHtml,
    text: finalBodyText,
    replyTo: replyTo ?? undefined,
    headers: {
      'X-Getyn-EmailAgent-Id': draft.enrollment.emailAgent.id,
      'X-Getyn-Enrollment-Id': draft.enrollmentId,
    },
  });

  const messageId = result.data?.id ?? null;
  await tx.$transaction([
    tx.emailAgentMessage.update({
      where: { id: draft.id },
      data: {
        subject: draft.subject,
        bodyText: finalBodyText,
        bodyHtml: finalBodyHtml,
        status: EmailAgentMessageStatus.SENT,
        messageId,
        sentAt: new Date(),
        approvedByUserId,
        approvedAt: new Date(),
      },
    }),
    tx.emailAgentEnrollment.update({
      where: { id: draft.enrollmentId },
      data: {
        status: EnrollmentStatus.ACTIVE,
        lastSentAt: new Date(),
        // Leave nextActionAt null — the enrollment is now waiting on
        // a customer reply; the follow-up tick's stopOnReply logic
        // was already handled by the paused state.
        nextActionAt: null,
      },
    }),
  ]);
}

// Duplicated to avoid dragging the worker helper into the web bundle.
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
