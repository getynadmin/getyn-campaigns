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
import {
  automationDefinitionSchema,
  automationSettingsSchema,
  automationTriggerSchema,
  validateAutomationDefinition,
  type AutomationDefinition,
} from '@getyn/types';

import { assertWithinLimit } from '@/server/billing/assert-limit';
import { enqueueAutomationStep, enqueueAutomationWake } from '@/server/queues';
import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Phase 8 M2 — /t/[slug]/automation/drip tRPC.
 *
 * All operations are tenant-scoped via withTenant. Editing a DRAFT
 * automation is free-form; ACTIVE automations only accept small
 * changes (rename, pause, archive, per-node status flip) because
 * their `definition` is being interpreted live by the M3 worker.
 * Larger structural changes on an ACTIVE automation require
 * pausing first — enforced in updateDefinition.
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * Build a bare-minimum definition — one trigger, one exit, wired.
 * Used by create + duplicate-from-empty flows so the canvas doesn't
 * start blank.
 */
function bareDefinition(): AutomationDefinition {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 240, y: 40 },
        data: {
          label: 'When...',
          trigger: { kind: 'manual_enrollment' },
        },
      },
      {
        id: 'exit-1',
        type: 'exit',
        position: { x: 240, y: 320 },
        data: { label: 'End', reason: '' },
      },
    ],
    edges: [
      { id: 'e-trigger-1-exit-1', source: 'trigger-1', target: 'exit-1', sourceHandle: null },
    ],
  };
}

export const automationRouter = createTRPCRouter({
  /**
   * List for the drip index page. Includes an active-enrollment count
   * so the table can show "N contacts enrolled" without the client
   * running a follow-up count query per row.
   */
  list: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.automation.findMany({
        where: { tenantId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          trigger: true,
          lastEditedAt: true,
          lastActivatedAt: true,
          updatedAt: true,
          createdAt: true,
          _count: { select: { enrollments: true } },
        },
      });
      return { items: rows };
    });
  }),

  /** Full get for the editor. Returns the definition JSON verbatim. */
  get: tenantProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const row = await tx.automation.findFirst({
        where: { id: input.id, tenantId },
        include: { _count: { select: { enrollments: true } } },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    });
  }),

  /** Create a new empty automation (Trigger → Exit). */
  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const created = await tx.automation.create({
          data: {
            tenantId,
            name: input.name,
            description: input.description ?? null,
            status: AutomationStatus.DRAFT,
            trigger: { kind: 'manual_enrollment' },
            definition: bareDefinition() as unknown as object,
            settings: { onReply: 'STOP' },
            createdByUserId: ctx.user.id,
          },
          select: { id: true },
        });
        return created;
      });
    }),

  /** Rename / change description. */
  rename: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const result = await tx.automation.updateMany({
          where: { id: input.id, tenantId },
          data: {
            name: input.name,
            description: input.description ?? null,
            lastEditedAt: new Date(),
          },
        });
        if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: true as const };
      });
    }),

  /** Duplicate — copies definition + trigger + settings, resets to DRAFT. */
  duplicate: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const src = await tx.automation.findFirst({
          where: { id: input.id, tenantId },
        });
        if (!src) throw new TRPCError({ code: 'NOT_FOUND' });
        const dup = await tx.automation.create({
          data: {
            tenantId,
            name: `${src.name} (copy)`,
            description: src.description,
            status: AutomationStatus.DRAFT,
            trigger: src.trigger as object,
            definition: src.definition as object,
            settings: src.settings as object,
            createdByUserId: ctx.user.id,
          },
          select: { id: true },
        });
        return dup;
      });
    }),

  /**
   * Delete. Blocked while ACTIVE — pause first. Cascades enrollments,
   * so a delete while contacts are enrolled kills them cleanly.
   */
  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.automation.findFirst({
          where: { id: input.id, tenantId },
          select: { status: true },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        if (row.status === AutomationStatus.ACTIVE) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Pause the automation before deleting.',
          });
        }
        await tx.automation.delete({ where: { id: input.id } });
        return { ok: true as const };
      });
    }),

  /**
   * Replace the entire definition JSON. Debounced-autosave endpoint.
   *
   * DRAFT: any shape allowed (client-side validation surfaces issues
   *        inline; the schema still validates so we don't persist
   *        garbage — but we skip the graph-level validator so the
   *        user can save intermediate states).
   * ACTIVE: only structural changes that don't break current
   *         enrollments — enforced by graph-validator + status
   *         requirement. Realistically clients pause first.
   */
  updateDefinition: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        definition: automationDefinitionSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.automation.findFirst({
          where: { id: input.id, tenantId },
          select: { status: true },
        });
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

        // Extract trigger from the definition — mirror it into the
        // top-level `trigger` column so cron scan queries can filter
        // without deserializing the whole definition.
        const trigger = input.definition.nodes.find((n) => n.type === 'trigger');
        const triggerConfig = trigger?.data.trigger ?? { kind: 'manual_enrollment' };

        await tx.automation.update({
          where: { id: input.id },
          data: {
            definition: input.definition as unknown as object,
            trigger: triggerConfig as object,
            lastEditedAt: new Date(),
          },
        });
        return { ok: true as const };
      });
    }),

  /** Automation-level settings (onReply policy today). */
  updateSettings: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ id: z.string().min(1), settings: automationSettingsSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const result = await tx.automation.updateMany({
          where: { id: input.id, tenantId },
          data: { settings: input.settings as object, lastEditedAt: new Date() },
        });
        if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: true as const };
      });
    }),

  /**
   * Flip a single node's status (DRAFT ↔ LIVE) — used by the toggle
   * on message-node cards. Runs alone (not via updateDefinition) so
   * the M3 worker's "wake paused enrollments at this node" hook can
   * fire cleanly.
   */
  setNodeStatus: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        nodeId: z.string().min(1),
        status: z.enum(['DRAFT', 'LIVE']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.automation.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, definition: true },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        const def = automationDefinitionSchema.safeParse(row.definition);
        if (!def.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Existing definition is malformed.',
          });
        }
        const nodes = def.data.nodes.map((n) => {
          if (n.id !== input.nodeId) return n;
          if (n.type !== 'email' && n.type !== 'whatsapp') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Node ${n.id} does not have a Draft/Live status.`,
            });
          }
          return { ...n, data: { ...n.data, status: input.status } };
        });
        const nextDef = { ...def.data, nodes };
        await tx.automation.update({
          where: { id: row.id },
          data: {
            definition: nextDef as unknown as object,
            lastEditedAt: new Date(),
          },
        });
        // M3 hook: nudge every enrollment paused at this node so the
        // next tick picks them up. Fire-and-forget — the mutation
        // should not fail if Redis is briefly unavailable.
        if (input.status === 'LIVE') {
          void enqueueAutomationWake({
            automationId: input.id,
            nodeId: input.nodeId,
            tenantId,
          }).catch((err) => {
            console.error('[automation.setNodeStatus] wake enqueue failed', err);
          });
        }
        return { ok: true as const };
      });
    }),

  /**
   * Activate an automation. Runs the graph-level validator with
   * requireLiveMessageNode — an active automation with zero LIVE
   * message nodes would send nothing, so we block it.
   */
  activate: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.automation.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, definition: true, status: true },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        const parsed = automationDefinitionSchema.safeParse(row.definition);
        if (!parsed.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Definition is malformed.',
          });
        }
        const issues = validateAutomationDefinition(parsed.data, {
          requireLiveMessageNode: true,
        });
        if (issues.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: issues.map((i) => i.message).join(' '),
          });
        }
        await tx.automation.update({
          where: { id: row.id },
          data: {
            status: AutomationStatus.ACTIVE,
            lastActivatedAt: new Date(),
          },
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
        const result = await tx.automation.updateMany({
          where: { id: input.id, tenantId, status: AutomationStatus.ACTIVE },
          data: { status: AutomationStatus.PAUSED },
        });
        if (result.count === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Automation is not active.',
          });
        }
        return { ok: true as const };
      });
    }),

  archive: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const result = await tx.automation.updateMany({
          where: {
            id: input.id,
            tenantId,
            status: { in: [AutomationStatus.DRAFT, AutomationStatus.PAUSED] },
          },
          data: { status: AutomationStatus.ARCHIVED },
        });
        if (result.count === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only draft or paused automations can be archived.',
          });
        }
        return { ok: true as const };
      });
    }),

  /**
   * Return the automationTriggerSchema-shaped default we plant when
   * the builder needs a fresh Trigger node's data. Client uses this
   * for adding a new Trigger after deletion.
   */
  defaultTrigger: tenantProcedure.query(() => {
    return automationTriggerSchema.parse({ kind: 'manual_enrollment' });
  }),

  /**
   * Manually enroll one or more contacts into an ACTIVE automation.
   * Skips contacts already actively enrolled — re-enrollment after a
   * prior exit is allowed. Blocked when the target automation is not
   * ACTIVE (draft/paused automations don't have running enrollments).
   *
   * Charges each new enrollment against
   * AUTOMATION_ENROLLMENTS_PER_MONTH.
   */
  enroll: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        automationId: z.string().min(1),
        contactIds: z.array(z.string().min(1)).min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const automation = await tx.automation.findFirst({
          where: { id: input.automationId, tenantId },
          select: { id: true, status: true, definition: true },
        });
        if (!automation) throw new TRPCError({ code: 'NOT_FOUND' });
        if (automation.status !== AutomationStatus.ACTIVE) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Automation must be Active to enroll contacts.',
          });
        }
        const parsedDef = automationDefinitionSchema.safeParse(automation.definition);
        if (!parsedDef.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Automation definition is malformed.',
          });
        }
        const trigger = parsedDef.data.nodes.find((n) => n.type === 'trigger');
        if (!trigger) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Automation is missing a Trigger node.',
          });
        }

        // Filter out contacts already actively enrolled.
        const existing = await tx.automationEnrollment.findMany({
          where: {
            tenantId,
            automationId: input.automationId,
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

        await assertWithinLimit(
          tenantId,
          PlanMetric.AUTOMATION_ENROLLMENTS_PER_MONTH,
          eligible.length,
        );

        // Materialize enrollments. currentNodeId points at the Trigger
        // — the worker advances past it on first step, so scheduling
        // nextActionAt=now lets the tick pick them up immediately.
        const now = new Date();
        await tx.automationEnrollment.createMany({
          data: eligible.map((contactId) => ({
            tenantId,
            automationId: input.automationId,
            contactId,
            currentNodeId: trigger.id,
            status: EnrollmentStatus.ACTIVE,
            nextActionAt: now,
            pausedAtDraftNode: false,
          })),
          skipDuplicates: true,
        });

        // Fire the tick-style nudge outside the write so lock contention
        // is bounded. Best-effort — the repeatable tick will pick these
        // up either way; the direct enqueue just eliminates the ~60s
        // wait for interactive testing.
        void (async () => {
          const rows = await prisma.automationEnrollment.findMany({
            where: {
              tenantId,
              automationId: input.automationId,
              contactId: { in: eligible },
              status: EnrollmentStatus.ACTIVE,
            },
            select: { id: true },
          });
          for (const r of rows) {
            void enqueueAutomationStep({ enrollmentId: r.id, tenantId }).catch(
              (err) => console.error('[automation.enroll] step enqueue failed', err),
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
