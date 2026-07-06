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
  followUpDays: z.array(z.number().int().min(1).max(180)).max(10),
  maxFollowUps: z.number().int().min(0).max(10).default(3),
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
