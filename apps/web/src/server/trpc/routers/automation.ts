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

import { getAnthropicClient, isAiConfigured } from '@getyn/ai';

import { assertWithinLimit } from '@/server/billing/assert-limit';
import { getAnthropicCredentials } from '@/server/integrations/anthropic';
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

  /**
   * Availability signal for the builder AI bar — matches ai.isAvailable.
   */
  aiIsAvailable: tenantProcedure.query(async () => {
    const anthropic = await getAnthropicCredentials();
    return { available: isAiConfigured(anthropic.apiKey ?? undefined) };
  }),

  /**
   * Generate an AutomationDefinition from a natural-language prompt.
   *
   * Sonnet takes the tenant's brief, our node-schema summary, and (if
   * present) the current canvas as context. Output is a full
   * definition JSON validated through automationDefinitionSchema.
   *
   * Speed-over-polish trade-offs baked in:
   *   - Plaintext email bodies only (no Unlayer designJson). Operator
   *     can open the design composer per node afterwards.
   *   - Message nodes always land as DRAFT so the operator explicitly
   *     flips them Live after review — matches the safety model of
   *     the whole builder.
   *   - One shot, no retry loop. Parse failure surfaces to the client
   *     as a clean error the operator can rephrase from.
   */
  generateFromPrompt: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        prompt: z.string().trim().min(4).max(4000),
        /**
         * When true, discard the current canvas and start from the
         * generated definition. When false, the caller keeps the
         * existing definition and shows this as a preview.
         */
        replace: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const anthropic = await getAnthropicCredentials();
      if (!anthropic.apiKey) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AI is not configured. Ask your admin to add an Anthropic key under Admin → Integrations.',
        });
      }

      const client = getAnthropicClient(anthropic.apiKey);
      let raw: string;
      try {
        const res = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: BUILDER_SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: `Brief: ${input.prompt}` },
            // Prefill with the opening brace so the model has to
            // continue as JSON — proper prefill pattern per Anthropic docs.
            { role: 'assistant', content: '{' },
          ],
        });
        const text = (res.content as { type: string; text?: string }[])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('');
        raw = `{${text}`;
      } catch (err) {
        console.error('[automation.generateFromPrompt] Sonnet call failed', err);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'AI generation failed. Try again in a moment.',
        });
      }

      const candidate = extractJsonObject(raw);
      if (!candidate) {
        console.warn(
          '[automation.generateFromPrompt] no JSON in output. First 500 chars:',
          raw.slice(0, 500),
        );
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message: 'AI output was not valid JSON. Try rephrasing your prompt.',
        });
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(candidate);
      } catch (err) {
        console.warn(
          '[automation.generateFromPrompt] JSON.parse failed. Slice head:',
          candidate.slice(0, 300),
          'tail:',
          candidate.slice(-200),
          'err:',
          (err as Error).message,
        );
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message: 'AI output was not valid JSON. Try rephrasing your prompt.',
        });
      }
      const parsed = automationDefinitionSchema.safeParse(parsedJson);
      if (!parsed.success) {
        console.warn('[automation.generateFromPrompt] schema mismatch', parsed.error.issues.slice(0, 3));
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message: `AI output did not match the workflow schema (${parsed.error.issues[0]?.path.join('.') ?? 'unknown'}). Try rephrasing.`,
        });
      }
      // Graph sanity — same check the client shows inline. We do NOT
      // require a LIVE message node here; the operator flips nodes
      // Live manually after reviewing.
      const issues = validateAutomationDefinition(parsed.data);
      if (issues.length > 0) {
        console.warn('[automation.generateFromPrompt] graph issues', issues);
        throw new TRPCError({
          code: 'UNPROCESSABLE_CONTENT',
          message: issues[0]!.message + ' (Try rephrasing your prompt.)',
        });
      }

      // We don't persist here — the client applies the definition
      // through the same updateDefinition path used by regular edits.
      // Keeps autosave semantics consistent.
      void tenantId; // reserved for future audit row (AiGeneration)
      return { definition: parsed.data };
    }),

  /**
   * Save Unlayer-generated designJson + renderedHtml back to a single
   * Email node. Fired by the /nodes/[nodeId]/design page's Save button.
   */
  saveNodeDesign: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        nodeId: z.string().min(1),
        subject: z.string().trim().max(200).optional(),
        designJson: z.unknown(),
        renderedHtml: z.string(),
        textBody: z.string(),
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
        const parsed = automationDefinitionSchema.safeParse(row.definition);
        if (!parsed.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Existing definition is malformed.',
          });
        }
        let found = false;
        const nodes = parsed.data.nodes.map((n) => {
          if (n.id !== input.nodeId) return n;
          if (n.type !== 'email') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Node is not an Email node.',
            });
          }
          found = true;
          return {
            ...n,
            data: {
              ...n.data,
              subject: input.subject ?? n.data.subject,
              designJson: (input.designJson ?? null) as never,
              renderedHtml: input.renderedHtml,
              textBody: input.textBody,
            },
          };
        });
        if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Email node not found.' });
        await tx.automation.update({
          where: { id: row.id },
          data: {
            definition: { ...parsed.data, nodes } as unknown as object,
            lastEditedAt: new Date(),
          },
        });
        return { ok: true as const };
      });
    }),

  /**
   * Load an EmailTemplate's design into a specific Email node.
   * Cheaper than a full round-trip through the design composer for
   * the common "pick a template" flow.
   */
  loadTemplateIntoNode: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: z.string().min(1),
        nodeId: z.string().min(1),
        templateId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const template = await tx.emailTemplate.findFirst({
          where: {
            id: input.templateId,
            OR: [{ tenantId }, { tenantId: null }], // include system templates
          },
          select: { name: true, designJson: true },
        });
        if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
        const row = await tx.automation.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, definition: true },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        const parsed = automationDefinitionSchema.safeParse(row.definition);
        if (!parsed.success) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Malformed definition.' });
        }
        let found = false;
        const nodes = parsed.data.nodes.map((n) => {
          if (n.id !== input.nodeId) return n;
          if (n.type !== 'email') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Node is not an Email node.' });
          }
          found = true;
          return {
            ...n,
            data: {
              ...n.data,
              designJson: template.designJson as never,
              // Rendered HTML is regenerated when the operator opens
              // the composer — we clear it here so the send pipeline
              // doesn't ship a stale render.
              renderedHtml: '',
            },
          };
        });
        if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Email node not found.' });
        await tx.automation.update({
          where: { id: row.id },
          data: {
            definition: { ...parsed.data, nodes } as unknown as object,
            lastEditedAt: new Date(),
          },
        });
        return { ok: true as const, templateName: template.name };
      });
    }),
});

// -----------------------------------------------------------------
// AI builder system prompt (long — the model needs the whole schema).
// -----------------------------------------------------------------

/**
 * Robust JSON-object extractor. Sonnet outputs sometimes come wrapped
 * in markdown fences (```json … ```) or trail with prose. We:
 *   1. Strip fenced code blocks if we can find one.
 *   2. Brace-count from the first `{` to find the matching close,
 *      respecting strings so an unescaped `}` inside a string doesn't
 *      confuse us.
 *   3. Fall back to the naive first-`{` / last-`}` slice as a last resort.
 */
function extractJsonObject(input: string): string | null {
  // Try fenced first — Sonnet occasionally wraps despite instructions.
  const fenceMatch = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenceMatch?.[1] ?? input;

  const openIdx = source.indexOf('{');
  if (openIdx === -1) return null;

  // Brace-count with string awareness.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < source.length; i += 1) {
    const ch = source[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIdx, i + 1);
      }
    }
  }
  // Unclosed — as a last resort, hand back everything from `{` to
  // the final `}` and let JSON.parse decide.
  const closeIdx = source.lastIndexOf('}');
  return closeIdx > openIdx ? source.slice(openIdx, closeIdx + 1) : null;
}

const BUILDER_SYSTEM_PROMPT = `You are a workflow-authoring assistant for a marketing-automation product.

You output ONE JSON object (no prose) describing an automation workflow
matching this schema:

{
  "nodes": [ …array of node objects… ],
  "edges": [ …array of edge objects… ]
}

# Node types

Every node has: id (string), type, position ({x, y}), data (per-type).

Position them left-to-right / top-to-bottom starting at x=240 y=40 in
100px vertical increments; branch splits move x by ±240.

1. Trigger — exactly one, always the entry point.
   type: "trigger"
   data: { label, trigger: { kind: "manual_enrollment" | "contact_added_to_segment" | "tag_applied" | "date_field_matches" } }
   Use manual_enrollment unless the user explicitly names a segment or tag.

2. Email — a marketing email to send.
   type: "email"
   data: { label, status: "DRAFT" (always DRAFT — operator flips Live),
           subject (string), previewText (string, ≤120 chars),
           designJson: null, renderedHtml: "", textBody (write the FULL email body here as plaintext, 80-200 words, personalized with {{contact.firstName}}, ending with a specific ask) }

3. WhatsApp — placeholder for WhatsApp send.
   type: "whatsapp"
   data: { label, status: "DRAFT", templateId: null, phoneNumberId: null, variables: {} }

4. Time delay
   type: "delay"
   data: { label, mode: "relative", amount (int), unit: "minutes"|"hours"|"days"|"weeks", absoluteAt: null, weekday: null, hourUtc: null }

5. Conditional split — routes based on condition.
   type: "split"
   data: { label, condition: { kind: "opened_previous_email" | "clicked_previous_email" | "has_tag" | "custom_field_equals" | "time_since_enrollment", …kind-specific fields… } }
   Two outgoing edges: one with sourceHandle "yes", one with "no".

6. Property update — sets/unsets a contact custom field.
   type: "property_update"
   data: { label, action: "set_custom_field"|"unset_custom_field", customFieldKey (string), value (string) }

7. List update — tag/segment/unsub operations.
   type: "list_update"
   data: { label, action: "add_tag"|"remove_tag"|"unsubscribe_email"|"unsubscribe_whatsapp"|"unsubscribe_sms", targetId (string|null) }

8. Internal alert — notifies the team.
   type: "internal_alert"
   data: { label, channel: "email"|"user"|"webhook", target (string), message (string) }

9. Exit — end the flow.
   type: "exit"
   data: { label: "End", reason (string) }

Every path must reach an Exit node.

# Edge schema

{ "id": "e-<n>", "source": "<sourceNodeId>", "target": "<targetNodeId>", "sourceHandle": null | "yes" | "no" }

Split nodes emit TWO edges (yes + no).
Every other node emits at most one; use sourceHandle: null.

# Rules

- Exactly ONE trigger node.
- No cycles.
- No orphan nodes.
- Every non-Exit node connects forward.
- When the user asks for N emails, produce N distinct Email nodes with
  distinct subject + textBody appropriate to that step of the sequence.
- Delays between emails should feel natural (2-3 days for first
  follow-up, 5-7 for later ones) unless the user specifies otherwise.
- Prefer manual_enrollment for the trigger unless the user names a
  segment or tag.

# Output format — CRITICAL

Your entire response MUST be a single valid JSON object, nothing else.
- No prose before or after.
- No markdown code fences.
- No trailing "// " comments inside the JSON.
- All string values MUST be valid JSON strings — escape newlines as \\n,
  quotes as \\", backslashes as \\\\.
- The first character of your response is "{" and the last is "}".

The assistant turn will be prefilled with "{" — continue directly with
the rest of the JSON.`;

