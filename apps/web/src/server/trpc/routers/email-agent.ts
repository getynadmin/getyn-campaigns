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
import {
  enqueueEmailAgentEnroll,
  enqueueEmailAgentImmediateFollowUp,
  enqueueEmailAgentIngest,
} from '@/server/queues';
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
  // Lightweight count for sidebar badges — refetched every 30s on
  // every page, so keep this a pure count(). Filters to ACTIVE
  // (paused/draft/archived agents are not "running").
  activeCount: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const total = await prisma.emailAgent.count({
      where: { tenantId, status: 'ACTIVE' },
    });
    return { total };
  }),

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
      // Server-side per-lane pagination. The UI shows the first ~10
      // cards per lane and scrolls; loading all 18k+ enrollments to
      // render 40 visible ones was pinning the page for seconds.
      // 50 per lane leaves headroom to scroll a bit without a
      // round-trip, at 200 rows total instead of 18k+.
      const PER_LANE = 50;
      const LANES = [
        'ACTIVE_CONVERSATION',
        'REVIEW_RESPONSE',
        'COOLING_PERIOD',
        'INACTIVE',
      ] as const;
      const selectShape = {
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
          orderBy: { createdAt: 'desc' as const },
          take: 1,
        },
      };
      // Non-Inactive lanes only show live enrollments — anything
      // EXITED (unsubscribed, bounced, stop-keyword) or COMPLETED
      // (max follow-ups reached) is terminal and belongs in Inactive
      // regardless of what conversationStatus it was left in. Without
      // this, the Active Conversation count silently included dead
      // rows and diverged from the operator's mental model.
      const laneWhere = (lane: typeof LANES[number]) => ({
        tenantId,
        emailAgentId: input.id,
        conversationStatus: lane,
        ...(lane === 'INACTIVE'
          ? {}
          : {
              status: { notIn: [EnrollmentStatus.EXITED, EnrollmentStatus.COMPLETED] },
              // Enrollments whose contact has no email can never send.
              // Hide them from Active/Review/Cooling — the exit handler
              // moves them to Inactive on the next sweep. Filtering
              // here keeps the count honest even before the sweep runs.
              contact: { email: { not: null } },
            }),
      });
      const laneQueries = LANES.map((lane) =>
        prisma.emailAgentEnrollment.findMany({
          where: laneWhere(lane),
          select: selectShape,
          // Latest activity first — an operator hint submit, an
          // inbound reply, or a fresh send all bump lastActivityAt,
          // so the freshest card floats to the top of each lane.
          orderBy: { lastActivityAt: 'desc' },
          take: PER_LANE,
        }),
      );
      const countQueries = LANES.map((lane) =>
        prisma.emailAgentEnrollment.count({ where: laneWhere(lane) }),
      );
      const [laneRows, laneTotals, agent] = await Promise.all([
        Promise.all(laneQueries),
        Promise.all(countQueries),
        prisma.emailAgent.findFirst({
          where: { id: input.id, tenantId },
          select: { outboundSchedule: true },
        }),
      ]);
      // Only fetch inbound counts for enrollments we're actually
      // returning — dropping the "scan every INBOUND row for the
      // agent" pattern that was fine at 100 enrollments and painful
      // at 18k.
      const visibleIds = laneRows.flat().map((r) => r.id);
      const inboundCounts = visibleIds.length
        ? await prisma.emailAgentMessage.groupBy({
            by: ['enrollmentId'],
            where: {
              tenantId,
              enrollmentId: { in: visibleIds },
              direction: 'INBOUND',
            },
            _count: { _all: true },
          })
        : [];
      const inboundByEnrollment = new Map<string, number>();
      for (const g of inboundCounts) {
        inboundByEnrollment.set(g.enrollmentId, g._count._all);
      }
      const maxFollowUps = Number(
        (agent?.outboundSchedule as { maxFollowUps?: number } | null)
          ?.maxFollowUps ?? 3,
      );
      const attachCount = <T extends { id: string }>(r: T) => ({
        ...r,
        inboundCount: inboundByEnrollment.get(r.id) ?? 0,
      });
      const byLane = {
        ACTIVE_CONVERSATION: laneRows[0]!.map(attachCount),
        REVIEW_RESPONSE: laneRows[1]!.map(attachCount),
        COOLING_PERIOD: laneRows[2]!.map(attachCount),
        INACTIVE: laneRows[3]!.map(attachCount),
      };
      const laneCounts = {
        ACTIVE_CONVERSATION: laneTotals[0]!,
        REVIEW_RESPONSE: laneTotals[1]!,
        COOLING_PERIOD: laneTotals[2]!,
        INACTIVE: laneTotals[3]!,
      };
      return { lanes: byLane, laneCounts, maxFollowUps };
    }),

  // Server-side search across every lane — kicks in when the operator
  // types in the board's search box. Client-side filter over the
  // paginated 200 rows can't find a card that isn't currently
  // materialised, so this endpoint hits the DB with an ILIKE on
  // email / firstName / lastName and returns up to 200 matches
  // (grouped by lane, same shape as `board`).
  boardSearch: tenantProcedure
    .input(
      z.object({
        id: z.string().min(1),
        q: z.string().trim().min(1).max(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const rows = await prisma.emailAgentEnrollment.findMany({
        where: {
          tenantId,
          emailAgentId: input.id,
          contact: {
            OR: [
              { email: { contains: input.q, mode: 'insensitive' } },
              { firstName: { contains: input.q, mode: 'insensitive' } },
              { lastName: { contains: input.q, mode: 'insensitive' } },
            ],
          },
        },
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
            select: { id: true, email: true, firstName: true, lastName: true },
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
        orderBy: { lastActivityAt: 'desc' },
        take: 200,
      });
      const ids = rows.map((r) => r.id);
      const inboundCounts = ids.length
        ? await prisma.emailAgentMessage.groupBy({
            by: ['enrollmentId'],
            where: {
              tenantId,
              enrollmentId: { in: ids },
              direction: 'INBOUND',
            },
            _count: { _all: true },
          })
        : [];
      const inboundByEnrollment = new Map<string, number>();
      for (const g of inboundCounts) {
        inboundByEnrollment.set(g.enrollmentId, g._count._all);
      }
      const withCounts = rows.map((r) => ({
        ...r,
        inboundCount: inboundByEnrollment.get(r.id) ?? 0,
      }));
      const byLane = {
        ACTIVE_CONVERSATION: withCounts.filter((r) => r.conversationStatus === 'ACTIVE_CONVERSATION'),
        REVIEW_RESPONSE: withCounts.filter((r) => r.conversationStatus === 'REVIEW_RESPONSE'),
        COOLING_PERIOD: withCounts.filter((r) => r.conversationStatus === 'COOLING_PERIOD'),
        INACTIVE: withCounts.filter((r) => r.conversationStatus === 'INACTIVE'),
      };
      return { lanes: byLane, matchTotal: rows.length };
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

  // Count of enrollments whose initial-send job silently failed —
  // currentStep=0, lastSentAt=null, nextActionAt=null, status=ACTIVE,
  // and older than the grace window. The tick sweeper picks these
  // up on its own cadence, but exposing the count + a manual
  // "re-enqueue now" button lets an operator kick a big backlog
  // through immediately after fixing a root cause (credit outage,
  // SDK bug, etc.) rather than waiting for the sweep.
  orphanCount: tenantProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const count = await prisma.emailAgentEnrollment.count({
        where: {
          tenantId,
          emailAgentId: input.id,
          status: EnrollmentStatus.ACTIVE,
          currentStep: 0,
          lastSentAt: null,
          nextActionAt: null,
        },
      });
      return { count };
    }),

  reEnqueueOrphans: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        // Cap per call so a 20k backlog doesn't tie up one request
        // for minutes. The button in the UI can be clicked again to
        // continue until orphanCount hits 0.
        maxBatch: z.number().int().min(1).max(5000).default(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const orphans = await prisma.emailAgentEnrollment.findMany({
        where: {
          tenantId,
          emailAgentId: input.id,
          status: EnrollmentStatus.ACTIVE,
          currentStep: 0,
          lastSentAt: null,
          nextActionAt: null,
        },
        select: { id: true },
        take: input.maxBatch,
        orderBy: { enrolledAt: 'asc' },
      });
      let enqueued = 0;
      for (const r of orphans) {
        try {
          await enqueueEmailAgentEnroll({ enrollmentId: r.id, tenantId });
          enqueued += 1;
        } catch (err) {
          console.error('[emailAgent.reEnqueueOrphans] enqueue failed', err);
        }
      }
      const remaining = await prisma.emailAgentEnrollment.count({
        where: {
          tenantId,
          emailAgentId: input.id,
          status: EnrollmentStatus.ACTIVE,
          currentStep: 0,
          lastSentAt: null,
          nextActionAt: null,
        },
      });
      return { enqueued, remaining };
    }),

  /**
   * Real-time runtime status for the Kanban board banner. One
   * roundtrip covers every signal the operator needs: how much is
   * pending, how much shipped in the last five minutes, and whether
   * the drafter is currently paused (Anthropic outage, drainPausedAt
   * set by an operator, agent itself not ACTIVE). Refetched every
   * 10s from the UI so the banner reflects reality.
   */
  runtimeStatus: tenantProcedure
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const agent = await prisma.emailAgent.findFirst({
        where: { id: input.id, tenantId },
        select: {
          id: true,
          status: true,
          lastDrafterErrorAt: true,
          lastDrafterErrorMessage: true,
          drainPausedAt: true,
          lastFollowupTickAt: true,
        },
      });
      if (!agent) throw new TRPCError({ code: 'NOT_FOUND' });
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
      const [pending, sentLast5m, sentTotal] = await Promise.all([
        prisma.emailAgentEnrollment.count({
          where: {
            tenantId,
            emailAgentId: input.id,
            status: EnrollmentStatus.ACTIVE,
            OR: [
              // Waiting on the follow-up tick.
              { nextActionAt: { lte: now } },
              // Orphaned initial (job silently failed).
              {
                currentStep: 0,
                lastSentAt: null,
                nextActionAt: null,
              },
            ],
          },
        }),
        prisma.emailAgentMessage.count({
          where: {
            tenantId,
            enrollment: { emailAgentId: input.id },
            direction: 'OUTBOUND',
            sentAt: { gte: fiveMinAgo },
          },
        }),
        // Lifetime send count for this agent — the operator wants to
        // see total shipped alongside pending, not just the throughput
        // rate. Cheap: covered by (tenantId, direction, sentAt) index.
        prisma.emailAgentMessage.count({
          where: {
            tenantId,
            enrollment: { emailAgentId: input.id },
            direction: 'OUTBOUND',
            sentAt: { not: null },
          },
        }),
      ]);
      // State decision — trust throughput over error-age windows. The
      // old logic hid a real outage once its error was >30 min old:
      // banner turned green even though pending was 10k+ and sends
      // were 0. Now: if pending > 0 AND no sends in 5 min, we're
      // paused *whatever* the reason. Show the last recorded error
      // when we have one, a generic 'stalled' otherwise.
      // Worker-down detection: if the tick hasn't fired in 3 min
      // (it should fire every 60s), something outside our code path
      // is broken — Railway deploy failed, worker crash-looping,
      // Redis unreachable. Distinct signal from 'stalled' (worker
      // up, but no work getting through).
      const tickStale =
        !agent.lastFollowupTickAt ||
        agent.lastFollowupTickAt < new Date(now.getTime() - 3 * 60_000);
      let state:
        | 'healthy'
        | 'idle'
        | 'paused_operator'
        | 'paused_error'
        | 'stalled'
        | 'worker_down'
        | 'agent_paused';
      if (agent.status !== 'ACTIVE') state = 'agent_paused';
      else if (agent.drainPausedAt) state = 'paused_operator';
      else if (pending === 0) state = 'idle';
      else if (sentLast5m > 0) state = 'healthy';
      else if (tickStale) state = 'worker_down';
      else if (agent.lastDrafterErrorAt) state = 'paused_error';
      else state = 'stalled';
      return {
        state,
        pending,
        sentLast5m,
        sendsPerMinute: Math.round(sentLast5m / 5),
        sentTotal,
        errorMessage: agent.lastDrafterErrorMessage,
        errorAt: agent.lastDrafterErrorAt,
        drainPausedAt: agent.drainPausedAt,
        agentStatus: agent.status,
        lastTickAt: agent.lastFollowupTickAt,
      };
    }),

  /**
   * Clear the drafter-error state and the operator drain-pause so the
   * follow-up tick / orphan sweep picks the agent back up on its next
   * run. Idempotent — safe to call when already healthy.
   */
  resumeDrafting: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const result = await prisma.emailAgent.updateMany({
        where: { id: input.id, tenantId },
        data: {
          lastDrafterErrorAt: null,
          lastDrafterErrorMessage: null,
          drainPausedAt: null,
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
      // Reset the enrollment out of PAUSED_AWAITING_APPROVAL back to
      // ACTIVE so processFollowUp's atomic-claim (`where status=ACTIVE`)
      // succeeds. Without this, the auto-drafted reply that put the
      // enrollment into PAUSED_AWAITING_APPROVAL blocks the operator's
      // hint: the priority job's claim silently fails and nothing sends.
      const updated = await prisma.emailAgentEnrollment.updateMany({
        where: { id: input.enrollmentId, tenantId },
        data: {
          suggestedReplyHint: input.hint,
          suggestedReplyCc: input.cc ?? null,
          conversationStatus: 'ACTIVE_CONVERSATION',
          status: EnrollmentStatus.ACTIVE,
          nextActionAt: new Date(),
        },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });

      // Supersede any pending auto-drafted reply — the operator's hint
      // is the authoritative version, and leaving the old DRAFT sitting
      // in the Approval Inbox would confuse anyone reviewing it.
      // Marks as REJECTED (the closest existing terminal state) rather
      // than deleting so the thread history stays intact for audit.
      await prisma.emailAgentMessage.updateMany({
        where: {
          tenantId,
          enrollmentId: input.enrollmentId,
          direction: 'OUTBOUND',
          status: 'DRAFT_AWAITING_APPROVAL',
        },
        data: { status: 'REJECTED' },
      });
      // Priority dispatch — the tick alone would order this NOW row
      // behind every already-due row (12k+ on SkillCertified), so
      // the operator's "Submit hint & resume" would sit behind the
      // whole backlog. Enqueueing a dedicated priority: 1 job jumps
      // it to the front. Idempotent on enrollmentId; if the tick
      // somehow raced ahead, processFollowUp's atomic-claim would
      // still gate a double-send.
      try {
        await enqueueEmailAgentImmediateFollowUp({
          enrollmentId: input.enrollmentId,
          tenantId,
        });
      } catch (err) {
        // Log-and-continue — the tick will pick it up within 60s if
        // the enqueue fails for any reason.
        console.warn(
          '[emailAgent.submitSuggestedReply] priority enqueue failed; falling back to tick',
          err,
        );
      }
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
