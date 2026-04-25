import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  CampaignStatus,
  Channel,
  Prisma,
  Role,
  SubscriptionStatus,
  withTenant,
} from '@getyn/db';
import {
  abTestSchema,
  campaignCancelSchema,
  campaignCreateSchema,
  campaignDeleteSchema,
  campaignGetSchema,
  campaignListInputSchema,
  campaignScheduleSchema,
  campaignSendNowSchema,
  campaignUpdateSchema,
  cuidSchema,
  segmentRulesSchema,
} from '@getyn/types';

import { scanCampaignContent } from '@/server/email/content-scanner';
import {
  compileSegmentRules,
  SegmentCompileError,
  type SegmentCustomFieldEntry,
} from '@getyn/db';
import { enqueuePrepareCampaign } from '@/server/queues';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Campaign router — Phase 3 M5.
 *
 * Lifecycle:
 *   DRAFT     —{schedule}→ SCHEDULED  —{worker}→  SENDING → SENT
 *   DRAFT     —{sendNow}→  SENDING    —{worker}→  SENT
 *   SCHEDULED —{cancel}→   CANCELED
 *   any       —{infra fail}→ FAILED
 *
 * Update + delete are DRAFT-only. Once a campaign moves out of DRAFT the
 * `EmailCampaign.renderedHtml` is locked by the trigger added in M1.
 *
 * The worker (M6) does the actual send pipeline. M5 stops at queueing —
 * `sendNow` enqueues `prepare-campaign` and flips status to SENDING. The
 * worker takes over from there.
 */

async function loadCustomFieldEntries(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<SegmentCustomFieldEntry[]> {
  const rows = await tx.customField.findMany({
    where: { tenantId },
    select: { id: true, key: true, type: true },
  });
  return rows.map((r) => ({ id: r.id, key: r.key, type: r.type }));
}

/**
 * Resolve a segment to its current Prisma WHERE clause + the count of
 * SUBSCRIBED contacts whose email is not on the suppression list.
 *
 * The kickoff's "11,890 will receive after suppressions" estimate. Phase
 * 3 only sends EMAIL campaigns, so `Channel.EMAIL` filter is hard-coded
 * — Phase 4 (WhatsApp) will widen this when it lands.
 */
async function previewRecipientsForSegment(
  tx: Prisma.TransactionClient,
  tenantId: string,
  segmentId: string,
): Promise<{ segmentTotal: number; afterSuppression: number }> {
  const segment = await tx.segment.findFirst({
    where: { id: segmentId, tenantId },
  });
  if (!segment) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Segment not found.',
    });
  }

  // Compile the persisted rules JSON. We re-validate against the schema
  // defensively — segments older than the latest schema migration may
  // have shapes that won't compile cleanly.
  const rulesParsed = segmentRulesSchema.safeParse(segment.rules);
  if (!rulesParsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Segment "${segment.name}" has invalid rules — re-save it before sending.`,
    });
  }

  const customFields = await loadCustomFieldEntries(tx, tenantId);
  let compiled: Prisma.ContactWhereInput;
  try {
    compiled = compileSegmentRules(rulesParsed.data, { customFields });
  } catch (err) {
    if (err instanceof SegmentCompileError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Segment compile failed: ${err.message}`,
      });
    }
    throw err;
  }

  // Layer 1: contacts that match the segment AND are reachable via email
  // (have an address, are SUBSCRIBED).
  const reachableWhere: Prisma.ContactWhereInput = {
    AND: [
      { tenantId, deletedAt: null },
      { email: { not: null } },
      { emailStatus: SubscriptionStatus.SUBSCRIBED },
      compiled,
    ],
  };
  const segmentTotal = await tx.contact.count({ where: reachableWhere });
  if (segmentTotal === 0) {
    return { segmentTotal: 0, afterSuppression: 0 };
  }

  // Layer 2: of those, how many have an email matching a SuppressionEntry?
  // We pull the set of suppressed email values for this tenant + EMAIL
  // channel and use it as an `in` filter against the segment match.
  const suppressedEmails = await tx.suppressionEntry.findMany({
    where: { tenantId, channel: Channel.EMAIL },
    select: { value: true },
  });
  if (suppressedEmails.length === 0) {
    return { segmentTotal, afterSuppression: segmentTotal };
  }
  const suppressedCount = await tx.contact.count({
    where: {
      AND: [
        reachableWhere,
        { email: { in: suppressedEmails.map((e) => e.value) } },
      ],
    },
  });
  return {
    segmentTotal,
    afterSuppression: segmentTotal - suppressedCount,
  };
}

export const campaignsRouter = createTRPCRouter({
  /**
   * List + filter. Cursor pagination on (createdAt desc, id desc).
   */
  list: tenantProcedure
    .input(campaignListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const where: Prisma.CampaignWhereInput = {
          tenantId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.segmentId ? { segmentId: input.segmentId } : {}),
          ...(input.search
            ? { name: { contains: input.search, mode: 'insensitive' } }
            : {}),
        };
        const rows = await tx.campaign.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
          include: {
            emailCampaign: {
              select: {
                subject: true,
                fromName: true,
                fromEmail: true,
                abTest: true,
              },
            },
            segment: { select: { id: true, name: true } },
          },
        });
        let nextCursor: string | null = null;
        if (rows.length > input.limit) {
          const next = rows.pop();
          nextCursor = next?.id ?? null;
        }
        const total = await tx.campaign.count({ where });
        return { items: rows, nextCursor, total };
      });
    }),

  get: tenantProcedure
    .input(campaignGetSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.campaign.findFirst({
          where: { id: input.id, tenantId },
          include: {
            emailCampaign: {
              include: { sendingDomain: true, template: true },
            },
            segment: true,
          },
        });
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        return row;
      });
    }),

  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(campaignCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      // Defensive: re-validate the abTest config if present (the input
      // schema permits null/undefined; we fully validate when present).
      if (input.settings.abTest && input.settings.abTest !== null) {
        const r = abTestSchema.safeParse(input.settings.abTest);
        if (!r.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'A/B test config is invalid: ' +
              r.error.issues.map((i) => i.message).join('; '),
          });
        }
      }

      return withTenant(tenantId, async (tx) => {
        // Verify the segment belongs to this tenant.
        const segment = await tx.segment.findFirst({
          where: { id: input.segmentId, tenantId },
          select: { id: true },
        });
        if (!segment) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Segment not found in this workspace.',
          });
        }

        // If sendingDomainId is provided, verify it's also our tenant's.
        if (input.settings.sendingDomainId) {
          const domain = await tx.sendingDomain.findFirst({
            where: { id: input.settings.sendingDomainId, tenantId },
            select: { id: true, status: true },
          });
          if (!domain) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Sending domain not found.',
            });
          }
        }

        const campaign = await tx.campaign.create({
          data: {
            tenantId,
            name: input.name,
            type: input.type,
            status: CampaignStatus.DRAFT,
            segmentId: input.segmentId,
            timezone: ctx.tenantContext.tenant.settings
              ? // Tenant settings JSON may carry a tz; fall back to UTC.
                (ctx.tenantContext.tenant.settings as { timezone?: string })
                  .timezone ?? 'UTC'
              : 'UTC',
            createdByUserId: ctx.user.id,
            emailCampaign: {
              create: {
                subject: input.settings.subject,
                previewText: input.settings.previewText,
                fromName: input.settings.fromName,
                fromEmail: input.settings.fromEmail,
                replyTo: input.settings.replyTo,
                sendingDomainId: input.settings.sendingDomainId ?? null,
                designJson: input.designJson as object,
                abTest:
                  input.settings.abTest && input.settings.abTest !== null
                    ? (input.settings.abTest as object)
                    : Prisma.DbNull,
                templateId: input.templateId ?? null,
              },
            },
          },
          include: { emailCampaign: true },
        });
        return campaign;
      });
    }),

  /**
   * Patch a draft campaign. Only DRAFT status accepts updates; once
   * scheduled or sent, the immutability trigger on EmailCampaign would
   * also kick in if anyone tried to change `renderedHtml`.
   */
  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(campaignUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.campaign.findFirst({
          where: { id: input.id, tenantId },
          include: { emailCampaign: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (existing.status !== CampaignStatus.DRAFT) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only DRAFT campaigns can be edited.',
          });
        }

        const campaignPatch: Prisma.CampaignUpdateInput = {};
        if (input.patch.name !== undefined)
          campaignPatch.name = input.patch.name;
        if (input.patch.segmentId !== undefined)
          campaignPatch.segment = { connect: { id: input.patch.segmentId } };

        const settings = input.patch.settings;
        const designJson = input.patch.designJson;
        const ecPatch: Prisma.EmailCampaignUpdateInput = {};
        if (settings) {
          if (settings.subject !== undefined) ecPatch.subject = settings.subject;
          if (settings.previewText !== undefined)
            ecPatch.previewText = settings.previewText;
          if (settings.fromName !== undefined)
            ecPatch.fromName = settings.fromName;
          if (settings.fromEmail !== undefined)
            ecPatch.fromEmail = settings.fromEmail;
          if (settings.replyTo !== undefined) ecPatch.replyTo = settings.replyTo;
          if (settings.sendingDomainId !== undefined) {
            ecPatch.sendingDomain = settings.sendingDomainId
              ? { connect: { id: settings.sendingDomainId } }
              : { disconnect: true };
          }
          if (settings.abTest !== undefined) {
            ecPatch.abTest =
              settings.abTest && settings.abTest !== null
                ? (settings.abTest as object)
                : Prisma.DbNull;
          }
        }
        if (designJson !== undefined)
          ecPatch.designJson = designJson as object;

        const updated = await tx.campaign.update({
          where: { id: existing.id },
          data: {
            ...campaignPatch,
            emailCampaign: Object.keys(ecPatch).length
              ? { update: ecPatch }
              : undefined,
          },
          include: { emailCampaign: true },
        });
        return updated;
      });
    }),

  /**
   * Save the rendered HTML produced by the editor. Called from the
   * design page's onSave callback. Bypasses the standard `update`
   * because designJson + renderedHtml are paired writes — they must
   * land together.
   */
  saveDesign: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(
      z.object({
        id: cuidSchema,
        designJson: z.record(z.unknown()),
        renderedHtml: z.string().max(2_000_000), // hard cap ~2MB
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.campaign.findFirst({
          where: { id: input.id, tenantId },
          include: { emailCampaign: true },
        });
        if (!existing || !existing.emailCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (existing.status !== CampaignStatus.DRAFT) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'renderedHtml is locked once the campaign moves out of DRAFT.',
          });
        }
        await tx.emailCampaign.update({
          where: { id: existing.emailCampaign.id },
          data: {
            designJson: input.designJson as object,
            renderedHtml: input.renderedHtml,
          },
        });
        return { ok: true as const };
      });
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(campaignDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.campaign.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, status: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (existing.status !== CampaignStatus.DRAFT) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Only DRAFT campaigns can be deleted. Cancel a SCHEDULED campaign first.',
          });
        }
        await tx.campaign.delete({ where: { id: existing.id } });
        return { ok: true as const };
      });
    }),

  /**
   * Schedule a draft campaign. Pre-flight: design saved, content scan
   * passes, segment yields recipients. The worker picks it up at
   * `scheduledAt`.
   */
  schedule: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(campaignScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      return runPreFlightAndTransition({
        tenantId: ctx.tenantContext.tenant.id,
        postalAddress: ctx.tenantContext.tenant.postalAddress,
        id: input.id,
        toStatus: CampaignStatus.SCHEDULED,
        scheduledAt: new Date(input.scheduledAt),
      });
    }),

  /**
   * Send now: same pre-flight as schedule, but the campaign goes
   * straight to SENDING and the worker picks it up immediately.
   */
  sendNow: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(campaignSendNowSchema)
    .mutation(async ({ ctx, input }) => {
      return runPreFlightAndTransition({
        tenantId: ctx.tenantContext.tenant.id,
        postalAddress: ctx.tenantContext.tenant.postalAddress,
        id: input.id,
        toStatus: CampaignStatus.SENDING,
      });
    }),

  cancel: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(campaignCancelSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.campaign.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, status: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        if (existing.status !== CampaignStatus.SCHEDULED) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only SCHEDULED campaigns can be canceled.',
          });
        }
        await tx.campaign.update({
          where: { id: existing.id },
          data: { status: CampaignStatus.CANCELED },
        });
        return { ok: true as const };
      });
    }),

  /**
   * Recipient preview — count of contacts in the segment, and after
   * the suppression filter. Used by the wizard's recipients step and
   * the review step. Cheap: two indexed counts.
   */
  previewRecipients: tenantProcedure
    .input(z.object({ segmentId: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, (tx) =>
        previewRecipientsForSegment(tx, tenantId, input.segmentId),
      );
    }),

  /**
   * Run the M5 content scanner against the campaign's current state.
   * Surfaces warnings and errors to the wizard's review step. The
   * actual send pipeline (M6) re-runs this as a final gate.
   */
  scan: tenantProcedure
    .input(campaignGetSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const c = await tx.campaign.findFirst({
          where: { id: input.id, tenantId },
          include: { emailCampaign: true },
        });
        if (!c || !c.emailCampaign) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Campaign not found.',
          });
        }
        const ec = c.emailCampaign;
        return scanCampaignContent({
          subject: ec.subject,
          fromEmail: ec.fromEmail,
          renderedHtml: ec.renderedHtml,
          abTest: ec.abTest as Parameters<
            typeof scanCampaignContent
          >[0]['abTest'],
        });
      });
    }),
});

/**
 * Shared helper for `schedule` and `sendNow`. Both run the same pre-flight
 * battery; only the destination state and (optional) scheduledAt differ.
 *
 * Takes plain values (not the procedure ctx) so it can be unit-tested
 * without spinning up a tRPC caller.
 */
async function runPreFlightAndTransition(args: {
  tenantId: string;
  postalAddress: string | null;
  id: string;
  toStatus: typeof CampaignStatus.SCHEDULED | typeof CampaignStatus.SENDING;
  scheduledAt?: Date;
}): Promise<{ ok: true }> {
  const { tenantId } = args;
  return withTenant(tenantId, async (tx) => {
    const c = await tx.campaign.findFirst({
      where: { id: args.id, tenantId },
      include: { emailCampaign: true },
    });
    if (!c || !c.emailCampaign) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Campaign not found.',
      });
    }
    if (c.status !== CampaignStatus.DRAFT) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot ${args.toStatus.toLowerCase()} a campaign in status ${c.status}.`,
      });
    }

    // Tenant must have a postal address before sending — CAN-SPAM.
    if (!args.postalAddress) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Add a postal address in Settings → Workspace before sending. Required by CAN-SPAM and similar laws.',
      });
    }

    // Suspension check — TenantSendingPolicy must not be suspended.
    const policy = await tx.tenantSendingPolicy.findUnique({
      where: { tenantId },
    });
    if (policy?.suspendedAt) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This workspace is suspended from sending: ${
          policy.suspensionReason ?? 'contact support.'
        }`,
      });
    }

    // Design must be saved.
    if (!c.emailCampaign.renderedHtml) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Design hasn\'t been saved yet — open the editor and save.',
      });
    }

    // Scheduled time must be in the future.
    if (args.scheduledAt && args.scheduledAt.getTime() < Date.now() + 60_000) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Schedule at least one minute in the future.',
      });
    }

    // Recipients > 0 (after suppression filter).
    const recipients = await previewRecipientsForSegment(
      tx,
      tenantId,
      c.segmentId,
    );
    if (recipients.afterSuppression === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          recipients.segmentTotal === 0
            ? 'Segment is empty — nothing to send.'
            : 'All segment members are suppressed — no one would receive this campaign.',
      });
    }

    // Content scan must not have errors. Warnings are accepted at this
    // layer (the UI confirms them); only hard errors block.
    const scan = scanCampaignContent({
      subject: c.emailCampaign.subject,
      fromEmail: c.emailCampaign.fromEmail,
      renderedHtml: c.emailCampaign.renderedHtml,
      abTest: c.emailCampaign.abTest as Parameters<
        typeof scanCampaignContent
      >[0]['abTest'],
    });
    if (scan.hasErrors) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Content scan failed: ' +
          scan.issues
            .filter((i) => i.level === 'error')
            .map((i) => i.message)
            .join('; '),
      });
    }

    // Transition + enqueue.
    //
    // For SENDING (sendNow): flip status, enqueue prepare-campaign with
    // no delay — worker picks it up immediately.
    // For SCHEDULED (schedule): flip status + scheduledAt, enqueue
    // prepare-campaign with `delay = scheduledAt - now`. BullMQ holds
    // the job until then.
    //
    // Cancel logic in `campaign.cancel` doesn't proactively remove the
    // delayed job — instead, the worker re-checks campaign.status
    // before doing any work. SCHEDULED → CANCELED transitions cause
    // prepare-campaign to skip cleanly when it fires.
    await tx.campaign.update({
      where: { id: c.id },
      data: {
        status: args.toStatus,
        scheduledAt: args.scheduledAt ?? null,
      },
    });

    // Outside the transaction (BullMQ enqueue isn't a DB op).
    // We do this AFTER the DB write so the worker never reads a stale
    // campaign — by the time it picks up the job, the status is set.
    const delayMs = args.scheduledAt
      ? Math.max(0, args.scheduledAt.getTime() - Date.now())
      : undefined;
    try {
      await enqueuePrepareCampaign(
        { campaignId: c.id, tenantId },
        { delayMs },
      );
    } catch (err) {
      // Enqueue failed — REDIS_URL likely unset. Roll back to DRAFT
      // so the user can try again rather than leaving a SENDING-but-
      // never-processed campaign.
      await tx.campaign.update({
        where: { id: c.id },
        data: {
          status: CampaignStatus.DRAFT,
          scheduledAt: null,
        },
      });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Could not queue the send: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    return { ok: true as const };
  });
}
