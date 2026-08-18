import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  AutomationStatus,
  EnrollmentStatus,
  PlanMetric,
  Role,
  prisma,
  withTenant,
} from '@getyn/db';

import { assertWithinLimit } from '@/server/billing/assert-limit';
import { enqueueWhatsappAgentEnroll } from '@/server/queues';
import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * WhatsApp Agent — mirror of email-agent.ts. Configuration + Kanban
 * board data source. Excludes email-only fields (CC, replyInboundDomain,
 * replyToDisplayName). Initial-touch message is a Meta-approved template;
 * follow-ups + replies are free-form text sent inside the 24h window.
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

const outboundScheduleSchema = z.object({
  followUpDays: z.array(z.number().int().min(1).max(365)).max(60),
  maxFollowUps: z.number().int().min(0).max(100).default(3),
});

const upsertInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  persona: z.string().trim().min(1).max(4_000),
  goal: z.string().trim().min(1).max(4_000),
  knowledgeUrls: z.array(z.string().url()).max(20).default([]),
  phoneNumberId: z.string().min(1),
  initialTemplateId: z.string().min(1).nullable(),
  signature: z.string().trim().max(2_000).default(''),
  outboundSchedule: outboundScheduleSchema,
  stopKeywords: z.string().trim().max(2_000)
    .default('stop,unsubscribe,do not message me,remove me'),
  coolingPeriodDays: z.number().int().min(0).max(365).default(30),
});

export const whatsappAgentRouter = createTRPCRouter({
  // Lightweight count for sidebar badges — refetched every 30s on
  // every page, so keep this a pure count().
  activeCount: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const total = await prisma.whatsAppAgent.count({
      where: { tenantId, status: 'ACTIVE' },
    });
    return { total };
  }),

  list: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.whatsAppAgent.findMany({
        where: { tenantId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          status: true,
          goal: true,
          persona: true,
          phoneNumberId: true,
          initialTemplateId: true,
          createdAt: true,
          updatedAt: true,
          phoneNumber: { select: { phoneNumber: true } },
          _count: { select: { enrollments: true } },
        },
      });
      return {
        items: rows.map((r) => ({ ...r, pendingApprovals: 0 })),
      };
    });
  }),

  get: tenantProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const row = await tx.whatsAppAgent.findFirst({
        where: { id: input.id, tenantId },
        include: {
          phoneNumber: { select: { id: true, phoneNumber: true, verifiedName: true } },
          initialTemplate: { select: { id: true, name: true, language: true, status: true } },
          _count: { select: { enrollments: true } },
        },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    });
  }),

  upsert: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(upsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        // Validate sender phone belongs to this tenant.
        const phone = await tx.whatsAppPhoneNumber.findFirst({
          where: { id: input.phoneNumberId, tenantId },
          select: { id: true },
        });
        if (!phone) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Phone number not found for this tenant.',
          });
        }
        if (input.initialTemplateId) {
          const tpl = await tx.whatsAppTemplate.findFirst({
            where: { id: input.initialTemplateId, tenantId, status: 'APPROVED' },
            select: { id: true },
          });
          if (!tpl) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Initial template must be an APPROVED WhatsApp template for this tenant.',
            });
          }
        }

        if (input.id) {
          const existing = await tx.whatsAppAgent.findFirst({
            where: { id: input.id, tenantId },
            select: { id: true },
          });
          if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
          await tx.whatsAppAgent.update({
            where: { id: existing.id },
            data: {
              name: input.name,
              persona: input.persona,
              goal: input.goal,
              knowledgeUrls: input.knowledgeUrls,
              phoneNumberId: input.phoneNumberId,
              initialTemplateId: input.initialTemplateId,
              signature: input.signature || null,
              outboundSchedule: input.outboundSchedule as object,
              stopKeywords: input.stopKeywords,
              coolingPeriodDays: input.coolingPeriodDays,
            },
          });
          return { id: existing.id };
        }
        const created = await tx.whatsAppAgent.create({
          data: {
            tenantId,
            name: input.name,
            status: AutomationStatus.DRAFT,
            persona: input.persona,
            goal: input.goal,
            knowledgeUrls: input.knowledgeUrls,
            phoneNumberId: input.phoneNumberId,
            initialTemplateId: input.initialTemplateId,
            signature: input.signature || null,
            outboundSchedule: input.outboundSchedule as object,
            stopKeywords: input.stopKeywords,
            coolingPeriodDays: input.coolingPeriodDays,
            createdByUserId: ctx.user.id,
          },
          select: { id: true },
        });
        return created;
      });
    }),

  activate: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await prisma.whatsAppAgent.findFirst({
        where: { id: input.id, tenantId },
        select: { id: true, initialTemplateId: true },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!row.initialTemplateId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Pick an APPROVED initial template before activating.',
        });
      }
      await prisma.whatsAppAgent.update({
        where: { id: row.id },
        data: { status: AutomationStatus.ACTIVE },
      });
      return { ok: true as const };
    }),

  pause: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const result = await prisma.whatsAppAgent.updateMany({
        where: { id: input.id, tenantId, status: AutomationStatus.ACTIVE },
        data: { status: AutomationStatus.PAUSED },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Agent is not active.' });
      }
      return { ok: true as const };
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await prisma.whatsAppAgent.findFirst({
        where: { id: input.id, tenantId },
        select: { status: true },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      if (row.status === AutomationStatus.ACTIVE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pause the agent before deleting.' });
      }
      await prisma.whatsAppAgent.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),

  // Wizard dropdowns
  phoneOptions: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.whatsAppPhoneNumber.findMany({
        where: { tenantId },
        select: { id: true, phoneNumber: true, verifiedName: true, displayPhoneNumberStatus: true },
        orderBy: { phoneNumber: 'asc' },
      });
      return rows;
    });
  }),

  templateOptions: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.whatsAppTemplate.findMany({
        where: { tenantId, status: 'APPROVED', deletedAt: null },
        select: { id: true, name: true, language: true, category: true },
        orderBy: { name: 'asc' },
      });
      return rows;
    });
  }),

  segmentOptions: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const segments = await tx.segment.findMany({
        where: { tenantId },
        select: { id: true, name: true, cachedCount: true },
        orderBy: { name: 'asc' },
      });
      return segments;
    });
  }),

  // ==== Kanban ====
  board: tenantProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const [rows, agent, inboundCounts] = await Promise.all([
      prisma.whatsAppAgentEnrollment.findMany({
        where: { tenantId, whatsappAgentId: input.id },
        select: {
          id: true,
          conversationStatus: true,
          status: true,
          currentStep: true,
          lastSentAt: true,
          lastInboundAt: true,
          cooldownUntil: true,
          suggestedReplyHint: true,
          tags: true,
          contact: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } },
          messages: {
            select: { id: true, direction: true, createdAt: true, bodyText: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { enrolledAt: 'desc' },
      }),
      prisma.whatsAppAgent.findFirst({
        where: { id: input.id, tenantId },
        select: { outboundSchedule: true },
      }),
      prisma.whatsAppAgentMessage.groupBy({
        by: ['enrollmentId'],
        where: { tenantId, enrollment: { whatsappAgentId: input.id }, direction: 'INBOUND' },
        _count: { _all: true },
      }),
    ]);
    const inboundByEnrollment = new Map<string, number>();
    for (const g of inboundCounts) inboundByEnrollment.set(g.enrollmentId, g._count._all);
    const rowsWithCounts = rows.map((r) => ({
      ...r,
      // Board consumers use `email` for search; alias phone into that
      // slot too so the shared card can search either. Keep both.
      contact: {
        ...r.contact,
        email: r.contact.phone ?? r.contact.email,
      },
      messages: r.messages.map((m) => ({ ...m, subject: '' })),
      inboundCount: inboundByEnrollment.get(r.id) ?? 0,
    }));
    const maxFollowUps = Number(
      (agent?.outboundSchedule as { maxFollowUps?: number } | null)?.maxFollowUps ?? 3,
    );
    const byLane = {
      ACTIVE_CONVERSATION: [] as typeof rowsWithCounts,
      REVIEW_RESPONSE: [] as typeof rowsWithCounts,
      COOLING_PERIOD: [] as typeof rowsWithCounts,
      INACTIVE: [] as typeof rowsWithCounts,
    };
    for (const r of rowsWithCounts) byLane[r.conversationStatus].push(r);
    return { lanes: byLane, maxFollowUps };
  }),

  thread: tenantProcedure
    .input(z.object({ enrollmentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const enrollment = await prisma.whatsAppAgentEnrollment.findFirst({
        where: { id: input.enrollmentId, tenantId },
        include: {
          contact: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } },
          messages: {
            select: {
              id: true, direction: true, bodyText: true,
              status: true, sentAt: true, createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
          whatsappAgent: {
            select: {
              name: true,
              phoneNumber: { select: { phoneNumber: true, verifiedName: true } },
            },
          },
        },
      });
      if (!enrollment) throw new TRPCError({ code: 'NOT_FOUND' });
      // Shape to match the Email Agent thread schema the shared drawer expects.
      return {
        ...enrollment,
        contact: { ...enrollment.contact, email: enrollment.contact.phone ?? enrollment.contact.email },
        messages: enrollment.messages.map((m) => ({
          ...m,
          subject: '',
          bodyHtml: `<p>${(m.bodyText ?? '').replace(/</g, '&lt;')}</p>`,
          inboundClassification: null as null,
        })),
        emailAgent: {
          name: enrollment.whatsappAgent.name,
          fromName: enrollment.whatsappAgent.phoneNumber.verifiedName,
          fromEmail: enrollment.whatsappAgent.phoneNumber.phoneNumber,
        },
      };
    }),

  enrollByPhone: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        whatsappAgentId: z.string().min(1),
        phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 (e.g. +14155551234)'),
        firstName: z.string().trim().max(80).optional(),
        lastName: z.string().trim().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const agent = await tx.whatsAppAgent.findFirst({
          where: { id: input.whatsappAgentId, tenantId },
          select: { id: true, initialTemplateId: true },
        });
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
        if (!agent.initialTemplateId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Configure an APPROVED initial template before sending a test.',
          });
        }
        let contact = await tx.contact.findFirst({
          where: { tenantId, phone: input.phone },
          select: { id: true },
        });
        if (!contact) {
          contact = await tx.contact.create({
            data: {
              tenantId,
              phone: input.phone,
              firstName: input.firstName || null,
              lastName: input.lastName || null,
            },
            select: { id: true },
          });
        }
        const existing = await tx.whatsAppAgentEnrollment.findFirst({
          where: {
            tenantId,
            whatsappAgentId: input.whatsappAgentId,
            contactId: contact.id,
            status: EnrollmentStatus.ACTIVE,
          },
          select: { id: true },
        });
        if (existing) {
          return { ok: true as const, enrollmentId: existing.id, alreadyEnrolled: true };
        }
        const now = new Date();
        const created = await tx.whatsAppAgentEnrollment.create({
          data: {
            tenantId,
            whatsappAgentId: input.whatsappAgentId,
            contactId: contact.id,
            status: EnrollmentStatus.ACTIVE,
            currentStep: 0,
            nextActionAt: now,
            enrolledAt: now,
          },
          select: { id: true },
        });
        try {
          await enqueueWhatsappAgentEnroll({
            enrollmentId: created.id,
            tenantId,
            isTest: true,
          });
        } catch (err) {
          console.warn('[whatsapp-agent.enrollByPhone] enqueue failed', err);
        }
        return { ok: true as const, enrollmentId: created.id, alreadyEnrolled: false };
      });
    }),

  enrollFromSegment: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        whatsappAgentId: z.string().min(1),
        segmentId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { compileSegmentRules } = await import('@getyn/db');
      const { segmentRulesSchema } = await import('@getyn/types');
      return withTenant(tenantId, async (tx) => {
        const agent = await tx.whatsAppAgent.findFirst({
          where: { id: input.whatsappAgentId, tenantId },
          select: { id: true, status: true, initialTemplateId: true },
        });
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
        if (agent.status !== AutomationStatus.ACTIVE) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Activate the agent before enrolling.' });
        }
        if (!agent.initialTemplateId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Configure an approved initial template first.' });
        }
        const segment = await tx.segment.findFirst({
          where: { id: input.segmentId, tenantId },
          select: { rules: true },
        });
        if (!segment) throw new TRPCError({ code: 'NOT_FOUND' });
        const rules = segmentRulesSchema.safeParse(segment.rules);
        if (!rules.success) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Segment rules are malformed.' });
        }
        const customFields = await tx.customField.findMany({
          where: { tenantId },
          select: { id: true, key: true, type: true },
        });
        const where = compileSegmentRules(rules.data, { customFields, now: new Date() });

        const BATCH = 50_000;
        let cursor: string | undefined;
        const allIds: string[] = [];
        for (let more = true; more; ) {
          const rows: { id: string }[] = await tx.contact.findMany({
            where: {
              AND: [
                { tenantId, deletedAt: null, phone: { not: null }, whatsappStatus: 'SUBSCRIBED' },
                where,
              ],
            },
            select: { id: true },
            take: BATCH,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });
          allIds.push(...rows.map((r) => r.id));
          more = rows.length === BATCH;
          if (more) cursor = rows[rows.length - 1]!.id;
        }
        if (allIds.length === 0) return { enrolled: 0, skipped: 0 };

        await assertWithinLimit(
          tenantId,
          PlanMetric.AUTOMATION_ENROLLMENTS_PER_MONTH,
          allIds.length,
        );

        const existing = await tx.whatsAppAgentEnrollment.findMany({
          where: {
            tenantId,
            whatsappAgentId: input.whatsappAgentId,
            contactId: { in: allIds },
            status: EnrollmentStatus.ACTIVE,
          },
          select: { contactId: true },
        });
        const activeSet = new Set(existing.map((r) => r.contactId));
        const eligible = allIds.filter((id) => !activeSet.has(id));
        if (eligible.length === 0) return { enrolled: 0, skipped: allIds.length };

        const now = new Date();
        await tx.whatsAppAgentEnrollment.createMany({
          data: eligible.map((contactId) => ({
            tenantId,
            whatsappAgentId: input.whatsappAgentId,
            contactId,
            status: EnrollmentStatus.ACTIVE,
            currentStep: 0,
            nextActionAt: now,
            enrolledAt: now,
          })),
          skipDuplicates: true,
        });
        return { enrolled: eligible.length, skipped: allIds.length - eligible.length };
      });
    }),

  deleteEnrollment: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ enrollmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const result = await prisma.whatsAppAgentEnrollment.deleteMany({
        where: { id: input.enrollmentId, tenantId },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),

  coolCard: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ enrollmentId: z.string().min(1), days: z.number().int().min(1).max(365) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const until = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);
      const result = await prisma.whatsAppAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: { conversationStatus: 'COOLING_PERIOD', cooldownUntil: until, nextActionAt: null },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const, cooldownUntil: until };
    }),

  moveCard: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        enrollmentId: z.string().min(1),
        to: z.enum(['ACTIVE_CONVERSATION', 'REVIEW_RESPONSE', 'COOLING_PERIOD', 'INACTIVE']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const result = await prisma.whatsAppAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: {
          conversationStatus: input.to,
          suggestedReplyHint: input.to === 'REVIEW_RESPONSE' ? undefined : null,
        },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),

  setTags: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        enrollmentId: z.string().min(1),
        tags: z
          .array(z.string().trim().min(1).max(40))
          .max(8)
          .transform((arr) => {
            const seen = new Set<string>();
            const out: string[] = [];
            for (const t of arr) {
              const k = t.toLowerCase();
              if (seen.has(k)) continue;
              seen.add(k);
              out.push(t);
            }
            return out;
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const result = await prisma.whatsAppAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: { tags: input.tags },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { tags: input.tags };
    }),

  submitSuggestedReply: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        enrollmentId: z.string().min(1),
        hint: z.string().trim().min(1).max(4_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const updated = await prisma.whatsAppAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: {
          suggestedReplyHint: input.hint,
          conversationStatus: 'ACTIVE_CONVERSATION',
          nextActionAt: new Date(),
        },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),
});
