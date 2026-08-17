import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  AutomationStatus,
  EnrollmentStatus,
  KnowledgeSourceKind,
  PlanMetric,
  Role,
  prisma,
  withTenant,
} from '@getyn/db';

import { assertWithinLimit } from '@/server/billing/assert-limit';
import { enqueueEmailAgentEnroll, enqueueEmailAgentIngest } from '@/server/queues';
import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Phase 8 M4 — /t/[slug]/automation/agents tRPC.
 *
 * Configuration surface for the Email Agent. The engine (M5) reads
 * these rows to know how to enroll, draft, and follow up.
 *
 * Activation is guarded on missing required fields (from-email is
 * validated against verified SendingDomains — we don't want the
 * agent shipping mail from an unverified sender).
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

const outboundScheduleSchema = z.object({
  initialDelayHours: z.number().int().min(0).max(24 * 14).default(0),
  followUpDays: z.array(z.number().int().min(1).max(365)).max(60),
  // Phase 9 bump: some campaigns need up to 50 follow-ups (e.g. cadence
  // of 2/week for 6 months).
  maxFollowUps: z.number().int().min(0).max(100).default(3),
  stopOnReply: z.boolean().default(true),
});

const toneSchema = z.enum([
  'PROFESSIONAL',
  'FRIENDLY',
  'CASUAL',
  'PLAYFUL',
  'AUTHORITATIVE',
  'EMPATHETIC',
]);

const upsertInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(4_000),
  tone: toneSchema.default('PROFESSIONAL'),
  systemInstructions: z.string().trim().max(20_000).default(''),
  outboundSchedule: outboundScheduleSchema,
  targetSegmentId: z.string().min(1).nullable(),
  autoEnrollNewContacts: z.boolean().default(false),
  signature: z.string().trim().max(2_000).default(''),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.string().trim().email(),
  stopKeywords: z
    .string()
    .trim()
    .max(2_000)
    .default('do not email me,unsubscribe,stop emailing,remove me'),
  coolingPeriodDays: z.number().int().min(0).max(365).default(30),
  replyInboundDomain: z
    .string()
    .trim()
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, 'Must be a bare domain like reply.yourbrand.com')
    .or(z.literal(''))
    .default(''),
  replyToDisplayName: z.string().trim().max(120).default(''),
});

const knowledgeSourceInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('URL'),
    sourceUrl: z.string().url(),
    rawTitle: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal('TEXT'),
    rawTitle: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(50_000),
  }),
]);

export const emailAgentRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.emailAgent.findMany({
        where: { tenantId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          status: true,
          goal: true,
          tone: true,
          fromName: true,
          fromEmail: true,
          targetSegmentId: true,
          autoEnrollNewContacts: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              enrollments: true,
              knowledgeSources: true,
            },
          },
        },
      });
      // Also count pending approvals per agent so the list badge can
      // render without another round-trip. Uses the partial index on
      // (tenantId, status) added in M0.
      const pendingCounts = await tx.emailAgentMessage.groupBy({
        by: ['enrollmentId'],
        where: {
          tenantId,
          status: 'DRAFT_AWAITING_APPROVAL',
        },
        _count: { _all: true },
      });
      const enrollmentToPending = new Map(
        pendingCounts.map((r) => [r.enrollmentId, r._count._all]),
      );
      // Aggregate per agent through their enrollments.
      const perAgentPending = new Map<string, number>();
      for (const agent of rows) {
        const enrollmentIds = await tx.emailAgentEnrollment.findMany({
          where: { emailAgentId: agent.id, tenantId },
          select: { id: true },
        });
        let count = 0;
        for (const e of enrollmentIds) {
          count += enrollmentToPending.get(e.id) ?? 0;
        }
        perAgentPending.set(agent.id, count);
      }
      return {
        items: rows.map((r) => ({
          ...r,
          pendingApprovals: perAgentPending.get(r.id) ?? 0,
        })),
      };
    });
  }),

  get: tenantProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const row = await tx.emailAgent.findFirst({
        where: { id: input.id, tenantId },
        include: {
          knowledgeSources: { orderBy: { createdAt: 'asc' } },
          targetSegment: { select: { id: true, name: true } },
          _count: { select: { enrollments: true } },
        },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    });
  }),

  /**
   * Upsert (create when id absent). Kept as one operation because
   * the wizard writes the whole config atomically on Save. Draft
   * status by default — separate `activate` call flips it live.
   */
  upsert: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(upsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        // Sender email must live on a verified SendingDomain.
        await assertFromEmailAllowed(tx, tenantId, input.fromEmail);

        if (input.id) {
          const existing = await tx.emailAgent.findFirst({
            where: { id: input.id, tenantId },
            select: { id: true, status: true, targetSegmentId: true },
          });
          if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
          // Segment change on an ACTIVE agent — refuse without a
          // confirm flag. UI drives the flag when the user OK's the
          // reset-enrollment dialog.
          if (
            existing.status === AutomationStatus.ACTIVE &&
            existing.targetSegmentId !== input.targetSegmentId
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Pause the agent before changing its target segment — existing enrollments would still be running against the old audience.',
            });
          }
          await tx.emailAgent.update({
            where: { id: existing.id },
            data: {
              name: input.name,
              goal: input.goal,
              tone: input.tone,
              systemInstructions: input.systemInstructions,
              outboundSchedule: input.outboundSchedule as object,
              targetSegmentId: input.targetSegmentId,
              autoEnrollNewContacts: input.autoEnrollNewContacts,
              signature: input.signature,
              fromName: input.fromName,
              fromEmail: input.fromEmail,
              stopKeywords: input.stopKeywords,
              coolingPeriodDays: input.coolingPeriodDays,
              replyInboundDomain: input.replyInboundDomain || null,
              replyToDisplayName: input.replyToDisplayName || null,
            },
          });
          return { id: existing.id };
        }
        const created = await tx.emailAgent.create({
          data: {
            tenantId,
            name: input.name,
            status: AutomationStatus.DRAFT,
            goal: input.goal,
            tone: input.tone,
            systemInstructions: input.systemInstructions,
            outboundSchedule: input.outboundSchedule as object,
            targetSegmentId: input.targetSegmentId,
            autoEnrollNewContacts: input.autoEnrollNewContacts,
            signature: input.signature,
            fromName: input.fromName,
            fromEmail: input.fromEmail,
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
      return withTenant(tenantId, async (tx) => {
        const row = await tx.emailAgent.findFirst({
          where: { id: input.id, tenantId },
          include: {
            _count: { select: { knowledgeSources: true } },
          },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        if (row._count.knowledgeSources === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Add at least one knowledge source (URL, file, or text) before activating — the agent uses these to write replies.',
          });
        }
        await assertFromEmailAllowed(tx, tenantId, row.fromEmail);
        await tx.emailAgent.update({
          where: { id: row.id },
          data: { status: AutomationStatus.ACTIVE },
        });
        return { ok: true as const };
      });
    }),

  pause: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const result = await tx.emailAgent.updateMany({
          where: { id: input.id, tenantId, status: AutomationStatus.ACTIVE },
          data: { status: AutomationStatus.PAUSED },
        });
        if (result.count === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Agent is not active.',
          });
        }
        return { ok: true as const };
      });
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.emailAgent.findFirst({
          where: { id: input.id, tenantId },
          select: { status: true },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        if (row.status === AutomationStatus.ACTIVE) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Pause the agent before deleting.',
          });
        }
        await tx.emailAgent.delete({ where: { id: input.id } });
        return { ok: true as const };
      });
    }),

  // ---------------------------------------------------------------
  // Knowledge sources
  // ---------------------------------------------------------------

  addKnowledgeSource: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        emailAgentId: z.string().min(1),
        source: knowledgeSourceInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const agent = await tx.emailAgent.findFirst({
          where: { id: input.emailAgentId, tenantId },
          select: { id: true },
        });
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });

        // Persist the row immediately. Extraction + summary land
        // async via the M6 ingest worker; we stash a placeholder
        // summary so the row is functional (the M5 engine falls
        // back gracefully on empty summaries).
        const data =
          input.source.kind === 'URL'
            ? {
                tenantId,
                emailAgentId: agent.id,
                kind: KnowledgeSourceKind.URL,
                sourceUrl: input.source.sourceUrl,
                rawTitle:
                  input.source.rawTitle ?? deriveTitleFromUrl(input.source.sourceUrl),
                extractedText: '',
                summary: '(URL — extracting…)',
                metadata: { ingestPending: true } as object,
              }
            : {
                tenantId,
                emailAgentId: agent.id,
                kind: KnowledgeSourceKind.TEXT,
                sourceUrl: null,
                rawTitle: input.source.rawTitle,
                extractedText: input.source.text,
                summary: summarizeInline(input.source.text),
                metadata: {} as object,
              };
        const created = await tx.emailAgentKnowledgeSource.create({
          data,
          select: { id: true },
        });
        // Phase 8 M6 — kick off async extraction for URL sources.
        // TEXT sources are already populated, so no ingest needed.
        // FILE kind stubs to a placeholder inside the worker until
        // file uploads land.
        if (input.source.kind === 'URL') {
          void enqueueEmailAgentIngest({
            knowledgeSourceId: created.id,
            tenantId,
          }).catch((err) => {
            console.error('[emailAgent.addKnowledgeSource] ingest enqueue failed', err);
          });
        }
        return created;
      });
    }),

  /**
   * Re-run ingestion on an existing knowledge source. URL sources
   * re-fetch + re-summarize; TEXT sources re-summarize their stored
   * text (useful after the operator edits the text via a delete +
   * re-add). Flips the row into a "pending" visual state client-side
   * via metadata.ingestPending.
   */
  refreshKnowledgeSource: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.emailAgentKnowledgeSource.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, kind: true },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        await tx.emailAgentKnowledgeSource.update({
          where: { id: row.id },
          data: {
            summary: '(Extracting…)',
            metadata: { ingestPending: true } as object,
          },
        });
        void enqueueEmailAgentIngest({
          knowledgeSourceId: row.id,
          tenantId,
        }).catch((err) => {
          console.error('[emailAgent.refreshKnowledgeSource] enqueue failed', err);
        });
        return { ok: true as const };
      });
    }),

  removeKnowledgeSource: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.emailAgentKnowledgeSource.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        await tx.emailAgentKnowledgeSource.delete({ where: { id: row.id } });
        return { ok: true as const };
      });
    }),

  // ---------------------------------------------------------------
  // Options for the wizard dropdowns.
  // ---------------------------------------------------------------

  fromEmailOptions: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const domains = await tx.sendingDomain.findMany({
        where: { tenantId, status: 'VERIFIED' },
        select: { domain: true },
        orderBy: { domain: 'asc' },
      });
      return domains.map((d) => d.domain);
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

  /**
   * Manually enroll one or more contacts into an ACTIVE agent.
   * Filters already-active enrollments. Counts each new enrollment
   * against no dedicated metric — enrollments are cheap; the
   * agent-reply cap catches AI cost. Fires the initial-draft job
   * immediately so testing doesn't wait for the follow-up tick.
   */
  enroll: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        emailAgentId: z.string().min(1),
        contactIds: z.array(z.string().min(1)).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const agent = await tx.emailAgent.findFirst({
          where: { id: input.emailAgentId, tenantId },
          select: { id: true, status: true, _count: { select: { knowledgeSources: true } } },
        });
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
        if (agent.status !== AutomationStatus.ACTIVE) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Activate the agent before enrolling contacts.',
          });
        }
        if (agent._count.knowledgeSources === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Add at least one knowledge source before enrolling.',
          });
        }

        // Rough gate: use the same plan metric as automation
        // enrollments. Separate metric can land later if we need
        // distinct pricing.
        await assertWithinLimit(
          tenantId,
          PlanMetric.AUTOMATION_ENROLLMENTS_PER_MONTH,
          input.contactIds.length,
        );

        const existing = await tx.emailAgentEnrollment.findMany({
          where: {
            tenantId,
            emailAgentId: input.emailAgentId,
            contactId: { in: input.contactIds },
            status: EnrollmentStatus.ACTIVE,
          },
          select: { contactId: true },
        });
        const activeSet = new Set(existing.map((r) => r.contactId));
        const eligible = input.contactIds.filter((id) => !activeSet.has(id));
        if (eligible.length === 0) {
          return { enrolled: 0, skipped: input.contactIds.length };
        }
        const now = new Date();
        await tx.emailAgentEnrollment.createMany({
          data: eligible.map((contactId) => ({
            tenantId,
            emailAgentId: input.emailAgentId,
            contactId,
            status: EnrollmentStatus.ACTIVE,
            currentStep: 0,
            nextActionAt: now,
            enrolledAt: now,
          })),
          skipDuplicates: true,
        });

        // Fire the initial-draft jobs. Fire-and-forget: the follow-up
        // tick will pick them up next cycle even if enqueue fails.
        void (async () => {
          const rows = await prisma.emailAgentEnrollment.findMany({
            where: {
              tenantId,
              emailAgentId: input.emailAgentId,
              contactId: { in: eligible },
              status: EnrollmentStatus.ACTIVE,
            },
            select: { id: true },
          });
          for (const r of rows) {
            void enqueueEmailAgentEnroll({ enrollmentId: r.id, tenantId }).catch(
              (err) => console.error('[emailAgent.enroll] enqueue failed', err),
            );
          }
        })();

        return {
          enrolled: eligible.length,
          skipped: input.contactIds.length - eligible.length,
        };
      });
    }),

  // =====================================================================
  // Phase 9 — Kanban board
  // =====================================================================
  board: tenantProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const [rows, agent, inboundCounts] = await Promise.all([
        prisma.emailAgentEnrollment.findMany({
          where: { tenantId, emailAgentId: input.id },
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
            contact: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
            messages: {
              select: {
                id: true,
                direction: true,
                subject: true,
                createdAt: true,
                bodyText: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { enrolledAt: 'desc' },
        }),
        prisma.emailAgent.findFirst({
          where: { id: input.id, tenantId },
          select: { outboundSchedule: true },
        }),
        // Explicit inbound counts — deriving from total-messages was
        // wrong because DRAFT_AWAITING_APPROVAL rows and status side-
        // effects inflate the total, making cards show a phantom
        // "1 reply" badge when no real reply exists.
        prisma.emailAgentMessage.groupBy({
          by: ['enrollmentId'],
          where: {
            tenantId,
            enrollment: { emailAgentId: input.id },
            direction: 'INBOUND',
          },
          _count: { _all: true },
        }),
      ]);
      const inboundByEnrollment = new Map<string, number>();
      for (const g of inboundCounts) {
        inboundByEnrollment.set(g.enrollmentId, g._count._all);
      }
      const rowsWithCounts = rows.map((r) => ({
        ...r,
        inboundCount: inboundByEnrollment.get(r.id) ?? 0,
      }));
      const maxFollowUps = Number(
        (agent?.outboundSchedule as { maxFollowUps?: number } | null)
          ?.maxFollowUps ?? 3,
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
      const enrollment = await prisma.emailAgentEnrollment.findFirst({
        where: { id: input.enrollmentId, tenantId },
        include: {
          contact: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          messages: {
            select: {
              id: true,
              direction: true,
              subject: true,
              bodyHtml: true,
              bodyText: true,
              status: true,
              inboundClassification: true,
              sentAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
          emailAgent: { select: { name: true, fromEmail: true, fromName: true } },
        },
      });
      if (!enrollment) throw new TRPCError({ code: 'NOT_FOUND' });
      return enrollment;
    }),

  /**
   * Phase 9 — "Test agent" on the Kanban board. Given any email
   * address, upsert a Contact + enroll into the agent so the initial
   * send fires on the next follow-up tick and the enrollment shows
   * up as a live card in Active Conversation. Fully real, not a
   * simulation — the recipient will get an actual email and any
   * reply will route through the standard inbound webhook.
   */
  enrollByEmail: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        emailAgentId: z.string().min(1),
        email: z.string().trim().email(),
        firstName: z.string().trim().max(80).optional(),
        lastName: z.string().trim().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const agent = await tx.emailAgent.findFirst({
          where: { id: input.emailAgentId, tenantId },
          select: {
            id: true,
            status: true,
            _count: { select: { knowledgeSources: true } },
          },
        });
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
        // Phase 9 — Test agent works from any status (DRAFT / PAUSED /
        // ACTIVE) so operators can iterate on goal + KB before rolling
        // out to a real segment. Only knowledge sources are required —
        // the Sonnet draft needs at least one to produce useful copy.
        if (agent._count.knowledgeSources === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Add at least one knowledge source before sending a test.',
          });
        }
        const email = input.email.toLowerCase();
        // No compound unique on (tenantId, email) — do findFirst then
        // conditional create so re-clicks are idempotent.
        let contact = await tx.contact.findFirst({
          where: { tenantId, email },
          select: { id: true },
        });
        if (!contact) {
          contact = await tx.contact.create({
            data: {
              tenantId,
              email,
              firstName: input.firstName || null,
              lastName: input.lastName || null,
            },
            select: { id: true },
          });
        }
        // Bail cleanly if this contact already has an ACTIVE
        // enrollment on this agent — the Test button should be
        // safe to re-click without silently doubling up.
        const existing = await tx.emailAgentEnrollment.findFirst({
          where: {
            tenantId,
            emailAgentId: input.emailAgentId,
            contactId: contact.id,
            status: EnrollmentStatus.ACTIVE,
          },
          select: { id: true },
        });
        if (existing) {
          return {
            ok: true as const,
            enrollmentId: existing.id,
            alreadyEnrolled: true,
          };
        }
        const now = new Date();
        const created = await tx.emailAgentEnrollment.create({
          data: {
            tenantId,
            emailAgentId: input.emailAgentId,
            contactId: contact.id,
            status: EnrollmentStatus.ACTIVE,
            currentStep: 0,
            nextActionAt: now,
            enrolledAt: now,
          },
          select: { id: true },
        });
        // Enqueue the initial-send directly with isTest=true so it
        // fires regardless of agent.status. Otherwise a paused-agent
        // test would sit stuck in the tick queue waiting for the
        // whole cohort to reactivate.
        try {
          await enqueueEmailAgentEnroll({
            enrollmentId: created.id,
            tenantId,
            isTest: true,
          });
        } catch (err) {
          console.warn(
            '[email-agent.enrollByEmail] enqueue failed; tick will retry once agent is ACTIVE',
            err,
          );
        }
        return {
          ok: true as const,
          enrollmentId: created.id,
          alreadyEnrolled: false,
        };
      });
    }),

  /**
   * Phase 9 — Bulk-enroll every contact currently matching a segment
   * into an already-active agent. Mirrors drip's enrollFromSegment.
   * Cursor-paginated so a 20k segment doesn't OOM the API.
   */
  enrollFromSegment: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        emailAgentId: z.string().min(1),
        segmentId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { compileSegmentRules } = await import('@getyn/db');
      const { segmentRulesSchema } = await import('@getyn/types');
      return withTenant(tenantId, async (tx) => {
        const agent = await tx.emailAgent.findFirst({
          where: { id: input.emailAgentId, tenantId },
          select: {
            id: true,
            status: true,
            _count: { select: { knowledgeSources: true } },
          },
        });
        if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
        if (agent.status !== AutomationStatus.ACTIVE) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Activate the agent before enrolling contacts.',
          });
        }
        if (agent._count.knowledgeSources === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Add at least one knowledge source before enrolling.',
          });
        }
        const segment = await tx.segment.findFirst({
          where: { id: input.segmentId, tenantId },
          select: { rules: true },
        });
        if (!segment) throw new TRPCError({ code: 'NOT_FOUND' });
        const rules = segmentRulesSchema.safeParse(segment.rules);
        if (!rules.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Segment rules are malformed.',
          });
        }
        const customFields = await tx.customField.findMany({
          where: { tenantId },
          select: { id: true, key: true, type: true },
        });
        const where = compileSegmentRules(rules.data, {
          customFields,
          now: new Date(),
        });

        // Cursor paginate to avoid an OOM on huge segments.
        const BATCH = 50_000;
        let cursor: string | undefined;
        const allIds: string[] = [];
        for (let more = true; more; ) {
          const rows: { id: string }[] = await tx.contact.findMany({
            where: { AND: [{ tenantId, deletedAt: null }, where] },
            select: { id: true },
            take: BATCH,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });
          allIds.push(...rows.map((r) => r.id));
          more = rows.length === BATCH;
          if (more) cursor = rows[rows.length - 1]!.id;
        }
        if (allIds.length === 0) return { enrolled: 0, skipped: 0 };

        // Plan cap first.
        await assertWithinLimit(
          tenantId,
          PlanMetric.AUTOMATION_ENROLLMENTS_PER_MONTH,
          allIds.length,
        );

        const existing = await tx.emailAgentEnrollment.findMany({
          where: {
            tenantId,
            emailAgentId: input.emailAgentId,
            contactId: { in: allIds },
            status: EnrollmentStatus.ACTIVE,
          },
          select: { contactId: true },
        });
        const activeSet = new Set(existing.map((r) => r.contactId));
        const eligible = allIds.filter((id) => !activeSet.has(id));
        if (eligible.length === 0) {
          return { enrolled: 0, skipped: allIds.length };
        }
        const now = new Date();
        await tx.emailAgentEnrollment.createMany({
          data: eligible.map((contactId) => ({
            tenantId,
            emailAgentId: input.emailAgentId,
            contactId,
            status: EnrollmentStatus.ACTIVE,
            currentStep: 0,
            nextActionAt: now,
            enrolledAt: now,
          })),
          skipDuplicates: true,
        });
        // The 60s follow-up tick will pick these up and send the initial
        // draft under the global admin sendRatePerSecond throttle
        // (configured at /admin/integrations/sending-servers).
        return {
          enrolled: eligible.length,
          skipped: allIds.length - eligible.length,
        };
      });
    }),

  /**
   * Delete an enrollment + all its messages. Used by the Kanban's
   * per-card delete action so operators can wipe test enrollments
   * (or genuine junk) and re-enroll the same contact cleanly.
   */
  deleteEnrollment: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ enrollmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      // Cascade delete on the FK removes messages automatically.
      const result = await prisma.emailAgentEnrollment.deleteMany({
        where: { id: input.enrollmentId, tenantId },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),

  coolCard: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        enrollmentId: z.string().min(1),
        days: z.number().int().min(1).max(365),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const until = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);
      const result = await prisma.emailAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: {
          conversationStatus: 'COOLING_PERIOD',
          cooldownUntil: until,
          // Freeze the sequence — the cooling-wake cron re-sets
          // nextActionAt when it flips the card back to ACTIVE.
          nextActionAt: null,
        },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const, cooldownUntil: until };
    }),

  moveCard: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        enrollmentId: z.string().min(1),
        to: z.enum([
          'ACTIVE_CONVERSATION',
          'REVIEW_RESPONSE',
          'COOLING_PERIOD',
          'INACTIVE',
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const result = await prisma.emailAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: {
          conversationStatus: input.to,
          // Clear the suggested-reply hint when leaving REVIEW_RESPONSE
          // so it doesn't bleed into future outbound drafts.
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
        // Replace-all semantics — simplest client story. Tag strings
        // are trimmed, deduped case-insensitively, capped at 8 per
        // card to keep the card UI legible.
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
      const result = await prisma.emailAgentEnrollment.updateMany({
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
        // Optional one-shot CC (comma-separated addresses). Each
        // address is basic-shape validated; the worker splits + trims
        // before passing to Resend. Cleared after send so subsequent
        // follow-ups don't repeatedly bother the CC'd party.
        cc: z
          .string()
          .trim()
          .max(500)
          .optional()
          .transform((v) => (v && v.length > 0 ? v : null))
          .refine(
            (v) =>
              !v ||
              v
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
            'One or more CC addresses look invalid',
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      // Stash the hint (and one-shot CC) on the enrollment; flip the
      // card back to ACTIVE_CONVERSATION. The follow-up tick picks
      // up the hint on the next pass, weaves it into the Sonnet
      // prompt, and clears both hint + CC after send.
      const updated = await prisma.emailAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: {
          suggestedReplyHint: input.hint,
          suggestedReplyCc: input.cc ?? null,
          conversationStatus: 'ACTIVE_CONVERSATION',
          nextActionAt: new Date(), // wake immediately
        },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      // The email-agent follow-up cron ticks every minute and picks up
      // enrollments with nextActionAt<=now, so no direct enqueue needed.
      return { ok: true as const };
    }),
});

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

async function assertFromEmailAllowed(
  tx: Parameters<typeof withTenant>[1] extends (tx: infer T) => unknown ? T : never,
  tenantId: string,
  fromEmail: string,
): Promise<void> {
  const at = fromEmail.lastIndexOf('@');
  if (at === -1) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid from-email.' });
  }
  const domain = fromEmail.slice(at + 1).toLowerCase();
  const verified = await tx.sendingDomain.findFirst({
    where: { tenantId, domain, status: 'VERIFIED' },
    select: { id: true },
  });
  if (!verified) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Domain "${domain}" isn't a verified sending domain. Add it under Settings → Sending domains first.`,
    });
  }
}

function deriveTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 200);
  } catch {
    return url.slice(0, 200);
  }
}

function summarizeInline(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 240) return trimmed;
  return `${trimmed.slice(0, 237)}…`;
}
