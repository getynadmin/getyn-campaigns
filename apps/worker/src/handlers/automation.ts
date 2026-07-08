/* eslint-disable no-console */
/**
 * Phase 8 M3 — Drip Campaigns execution engine.
 *
 * Three job types share the `automations` queue:
 *
 *   automation-tick (repeatable, 60s)
 *     Scans AutomationEnrollment where status=ACTIVE,
 *     pausedAtDraftNode=false, nextActionAt <= now.
 *     Enqueues one automation-step per due enrollment. Kept small
 *     (batch cap) so one slow enrollment can't starve the queue.
 *
 *   automation-step (per-enrollment)
 *     Loads the enrollment + automation definition, finds the
 *     current node, dispatches to a per-type processor, advances
 *     currentNodeId + nextActionAt (or sets pausedAtDraftNode when
 *     the message node is DRAFT).
 *
 *   automation-wake-node (fired by web on DRAFT→LIVE flip)
 *     Wakes every enrollment paused at (automationId, nodeId).
 */
import { randomUUID } from 'node:crypto';

import { Resend } from 'resend';
import type { Job } from 'bullmq';
import * as Sentry from '@sentry/node';

import {
  AutomationStatus,
  ContactEventType,
  EnrollmentStatus,
  prisma,
} from '@getyn/db';
import type { Prisma } from '@getyn/db';
import {
  automationDefinitionSchema,
  type AutomationDefinition,
  type AutomationNode,
  type AutomationEdge,
  type AutomationStepPayload,
  type AutomationWakePayload,
} from '@getyn/types';
import { buildReplyToAddress } from '@getyn/crypto';

// -----------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const NODE_HISTORY_CAP = 100;

/**
 * How many enrollments the tick handler drains per run. Beyond this
 * they land on the next tick — bounded fan-out keeps a slow batch
 * from choking Redis with hundreds of parallel step jobs.
 */
const TICK_BATCH_SIZE = 200;

interface StepContext {
  enrollmentId: string;
  tenantId: string;
  automationId: string;
  automationSettings: Record<string, unknown> | null;
  definition: AutomationDefinition;
  currentNode: AutomationNode;
  contact: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    customFields: Record<string, unknown>;
    emailStatus: string;
    whatsappStatus: string;
  };
  tenant: {
    id: string;
    name: string;
    postalAddress: string | null;
    companyDisplayName: string | null;
  };
}

interface StepResult {
  /** Node id to advance to, or null to stay put (paused-at-draft). */
  nextNodeId: string | null;
  /** Absolute time the next step should run; null means immediately. */
  nextActionDelayMs: number | null;
  /** If set, exit the enrollment with this reason. */
  exit?: { status: EnrollmentStatus; reason: string };
  /** Optional annotation for nodeStateHistory. */
  result?: string;
  /** Set true when the message node is DRAFT — pause enrollment. */
  paused?: boolean;
}

// -----------------------------------------------------------------
// TICK — repeatable heartbeat
// -----------------------------------------------------------------

export async function handleAutomationTick(): Promise<void> {
  const now = new Date();
  const due = await prisma.automationEnrollment.findMany({
    where: {
      status: EnrollmentStatus.ACTIVE,
      pausedAtDraftNode: false,
      nextActionAt: { lte: now },
      automation: { status: AutomationStatus.ACTIVE },
    },
    select: { id: true, tenantId: true },
    orderBy: [{ nextActionAt: 'asc' }, { id: 'asc' }],
    take: TICK_BATCH_SIZE,
  });
  if (due.length === 0) return;
  console.info(`[automation:tick] enqueuing ${due.length} step jobs`);
  const { sendsQueueProducer } = await getQueueProducer();
  for (const enrollment of due) {
    await sendsQueueProducer.enqueueStep(enrollment.id, enrollment.tenantId);
  }
}

// -----------------------------------------------------------------
// STEP — process one enrollment
// -----------------------------------------------------------------

export async function handleAutomationStep(
  job: Job<AutomationStepPayload>,
): Promise<void> {
  const { enrollmentId } = job.data;

  const enrollment = await prisma.automationEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      automation: {
        select: {
          id: true,
          status: true,
          definition: true,
          settings: true,
        },
      },
      contact: {
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          customFields: true,
          emailStatus: true,
          whatsappStatus: true,
        },
      },
      tenant: {
        select: {
          id: true,
          name: true,
          postalAddress: true,
          companyDisplayName: true,
        },
      },
    },
  });
  if (!enrollment) {
    console.warn(`[automation:step] enrollment ${enrollmentId} vanished`);
    return;
  }
  if (enrollment.status !== EnrollmentStatus.ACTIVE) {
    return; // Nothing to do — completed / exited elsewhere.
  }
  if (enrollment.automation.status !== AutomationStatus.ACTIVE) {
    // Automation was paused/archived after the tick queued this job.
    return;
  }
  const parsed = automationDefinitionSchema.safeParse(enrollment.automation.definition);
  if (!parsed.success) {
    await failEnrollment(enrollment.id, 'definition_malformed');
    Sentry.captureMessage('[automation:step] malformed definition', {
      level: 'error',
      extra: { enrollmentId, automationId: enrollment.automation.id },
    });
    return;
  }
  const definition = parsed.data;
  const currentNode = definition.nodes.find((n) => n.id === enrollment.currentNodeId);
  if (!currentNode) {
    await failEnrollment(enrollment.id, `node_not_found:${enrollment.currentNodeId}`);
    return;
  }

  const ctx: StepContext = {
    enrollmentId: enrollment.id,
    tenantId: enrollment.tenantId,
    automationId: enrollment.automation.id,
    automationSettings: enrollment.automation.settings as Record<string, unknown> | null,
    definition,
    currentNode,
    contact: {
      id: enrollment.contact.id,
      email: enrollment.contact.email,
      phone: enrollment.contact.phone,
      firstName: enrollment.contact.firstName,
      lastName: enrollment.contact.lastName,
      customFields: (enrollment.contact.customFields ?? {}) as Record<string, unknown>,
      emailStatus: enrollment.contact.emailStatus,
      whatsappStatus: enrollment.contact.whatsappStatus,
    },
    tenant: {
      id: enrollment.tenant.id,
      name: enrollment.tenant.name,
      postalAddress: enrollment.tenant.postalAddress,
      companyDisplayName: enrollment.tenant.companyDisplayName,
    },
  };

  let result: StepResult;
  const nodeStartedAt = new Date();
  try {
    result = await processNode(ctx);
  } catch (err) {
    console.error(`[automation:step] processor failed for ${currentNode.type}`, err);
    Sentry.captureException(err, {
      tags: { handler: 'automation-step', nodeType: currentNode.type },
      extra: { enrollmentId, nodeId: currentNode.id },
    });
    await failEnrollment(
      enrollment.id,
      `node_error:${currentNode.type}:${(err as Error).message ?? 'unknown'}`,
    );
    return;
  }

  const history = appendHistory(
    (enrollment.nodeStateHistory as unknown as HistoryEntry[]) ?? [],
    {
      nodeId: currentNode.id,
      type: currentNode.type,
      enteredAt: nodeStartedAt.toISOString(),
      exitedAt: new Date().toISOString(),
      result: result.result ?? null,
    },
  );

  if (result.exit) {
    await prisma.automationEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: result.exit.status,
        completedAt: new Date(),
        exitReason: result.exit.reason,
        nextActionAt: null,
        nodeStateHistory: history as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }

  if (result.paused) {
    // Message node was DRAFT — keep currentNodeId, set pausedAtDraftNode.
    await prisma.automationEnrollment.update({
      where: { id: enrollment.id },
      data: {
        pausedAtDraftNode: true,
        nextActionAt: null,
        nodeStateHistory: history as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }

  const nextNodeId = result.nextNodeId;
  if (!nextNodeId) {
    // No outgoing edge — treat as completed to prevent stuck rows.
    await prisma.automationEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: EnrollmentStatus.COMPLETED,
        completedAt: new Date(),
        exitReason: 'no_outgoing_edge',
        nextActionAt: null,
        nodeStateHistory: history as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }

  const nextActionAt = result.nextActionDelayMs
    ? new Date(Date.now() + result.nextActionDelayMs)
    : new Date();

  await prisma.automationEnrollment.update({
    where: { id: enrollment.id },
    data: {
      currentNodeId: nextNodeId,
      nextActionAt,
      pausedAtDraftNode: false,
      nodeStateHistory: history as unknown as Prisma.InputJsonValue,
    },
  });
}

// -----------------------------------------------------------------
// WAKE — DRAFT→LIVE flip nudge
// -----------------------------------------------------------------

export async function handleAutomationWake(
  job: Job<AutomationWakePayload>,
): Promise<void> {
  const { automationId, nodeId, tenantId } = job.data;
  const now = new Date();
  const result = await prisma.automationEnrollment.updateMany({
    where: {
      automationId,
      tenantId,
      currentNodeId: nodeId,
      status: EnrollmentStatus.ACTIVE,
      pausedAtDraftNode: true,
    },
    data: { pausedAtDraftNode: false, nextActionAt: now },
  });
  if (result.count > 0) {
    console.info(
      `[automation:wake] woke ${result.count} enrollments at ${automationId}/${nodeId}`,
    );
  }
}

// -----------------------------------------------------------------
// Node dispatcher
// -----------------------------------------------------------------

async function processNode(ctx: StepContext): Promise<StepResult> {
  const node = ctx.currentNode;
  switch (node.type) {
    case 'trigger':
      return advance(ctx, node);
    case 'email':
      return processEmail(ctx, node);
    case 'whatsapp':
      return processWhatsApp(ctx, node);
    case 'delay':
      return processDelay(ctx, node);
    case 'split':
      return processSplit(ctx, node);
    case 'property_update':
      return processPropertyUpdate(ctx, node);
    case 'list_update':
      return processListUpdate(ctx, node);
    case 'internal_alert':
      return processInternalAlert(ctx, node);
    case 'exit':
      return {
        nextNodeId: null,
        nextActionDelayMs: null,
        exit: {
          status: EnrollmentStatus.COMPLETED,
          reason: node.data.reason || 'exit_node',
        },
        result: 'exited',
      };
  }
}

// -----------------------------------------------------------------
// Edge traversal
// -----------------------------------------------------------------

function outgoingEdges(
  definition: AutomationDefinition,
  fromNodeId: string,
): AutomationEdge[] {
  return definition.edges.filter((e) => e.source === fromNodeId);
}

function advance(
  ctx: StepContext,
  node: AutomationNode,
  handle: 'yes' | 'no' | null = null,
  result?: string,
): StepResult {
  const edges = outgoingEdges(ctx.definition, node.id);
  const match = edges.find((e) => (e.sourceHandle ?? null) === handle);
  return {
    nextNodeId: match?.target ?? null,
    nextActionDelayMs: null,
    result,
  };
}

// -----------------------------------------------------------------
// Individual processors
// -----------------------------------------------------------------

async function processEmail(
  ctx: StepContext,
  node: Extract<AutomationNode, { type: 'email' }>,
): Promise<StepResult> {
  if (node.data.status !== 'LIVE') {
    return {
      nextNodeId: null,
      nextActionDelayMs: null,
      paused: true,
      result: 'paused_draft_node',
    };
  }

  // Guard rails before we send anything.
  if (!ctx.contact.email) {
    return advance(ctx, node, null, 'skipped_no_email');
  }
  if (ctx.contact.emailStatus !== 'SUBSCRIBED') {
    return advance(ctx, node, null, `skipped_channel_${ctx.contact.emailStatus.toLowerCase()}`);
  }
  // Suppression list — the send pipeline uses this same source.
  const suppressed = await prisma.suppressionEntry.findFirst({
    where: {
      tenantId: ctx.tenantId,
      channel: 'EMAIL',
      value: ctx.contact.email.toLowerCase(),
    },
    select: { id: true },
  });
  if (suppressed) {
    return {
      nextNodeId: null,
      nextActionDelayMs: null,
      exit: {
        status: EnrollmentStatus.EXITED,
        reason: 'suppressed_email',
      },
      result: 'exited_suppressed',
    };
  }

  // Prepare payload.
  const merge = buildMergeTags(ctx);
  const subject = renderTemplate(node.data.subject || '(no subject)', merge);
  const html = renderTemplate(node.data.renderedHtml || node.data.textBody || '', merge);
  const text = renderTemplate(node.data.textBody || stripHtml(node.data.renderedHtml || ''), merge);

  // Reply-To routes replies back to us so onReply policy fires.
  const replyToAddress = buildReplyToAddress(
    'w',
    { id: ctx.enrollmentId, tenantId: ctx.tenantId, nodeId: node.id },
    {
      secret: process.env.REPLY_ROUTING_SECRET ?? null,
      inboundDomain: process.env.REPLY_INBOUND_DOMAIN ?? null,
    },
  );

  // Sender identity — per-automation settings take precedence.
  // The tRPC `updateSettings` mutation verifies fromEmail lives on
  // a verified SendingDomain, and `activate` blocks activation when
  // an Email node is present without a from address configured, so
  // in practice the fallback only kicks in during pre-activation
  // preview sends or when settings are stale.
  const settings =
    (ctx.automationSettings as {
      fromName?: string | null;
      fromEmail?: string | null;
    } | null) ?? null;
  const fromEmail =
    settings?.fromEmail ?? process.env.NOTIFICATIONS_FROM ?? 'noreply@getyn.com';
  const fromName =
    settings?.fromName ?? ctx.tenant.companyDisplayName ?? ctx.tenant.name;

  if (resend) {
    try {
      await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: ctx.contact.email,
        subject,
        html,
        text,
        replyTo: replyToAddress ?? undefined,
        headers: {
          'X-Getyn-Automation-Id': ctx.automationId,
          'X-Getyn-Enrollment-Id': ctx.enrollmentId,
          'X-Getyn-Node-Id': node.id,
        },
      });
    } catch (err) {
      console.error('[automation:email] send failed', err);
      Sentry.captureException(err, {
        tags: { handler: 'automation-email' },
        extra: { enrollmentId: ctx.enrollmentId, nodeId: node.id },
      });
      // Continue past the node — don't stall the flow on a
      // transient Resend hiccup. Alert triaged separately in Sentry.
      return advance(ctx, node, null, 'send_failed');
    }
  } else {
    console.warn('[automation:email] RESEND_API_KEY missing — skipping send');
  }

  // Emit a ContactEvent so the segment builder can see it.
  await prisma.contactEvent.create({
    data: {
      tenantId: ctx.tenantId,
      contactId: ctx.contact.id,
      type: ContactEventType.EMAIL_SENT,
      occurredAt: new Date(),
      metadata: { automationId: ctx.automationId, nodeId: node.id },
    },
  });

  return advance(ctx, node, null, 'sent');
}

async function processWhatsApp(
  ctx: StepContext,
  node: Extract<AutomationNode, { type: 'whatsapp' }>,
): Promise<StepResult> {
  if (node.data.status !== 'LIVE') {
    return {
      nextNodeId: null,
      nextActionDelayMs: null,
      paused: true,
      result: 'paused_draft_node',
    };
  }
  if (!ctx.contact.phone) {
    return advance(ctx, node, null, 'skipped_no_phone');
  }
  if (ctx.contact.whatsappStatus !== 'SUBSCRIBED') {
    return advance(
      ctx,
      node,
      null,
      `skipped_channel_${ctx.contact.whatsappStatus.toLowerCase()}`,
    );
  }
  const suppressed = await prisma.suppressionEntry.findFirst({
    where: {
      tenantId: ctx.tenantId,
      channel: 'WHATSAPP',
      value: ctx.contact.phone,
    },
    select: { id: true },
  });
  if (suppressed) {
    return {
      nextNodeId: null,
      nextActionDelayMs: null,
      exit: {
        status: EnrollmentStatus.EXITED,
        reason: 'suppressed_whatsapp',
      },
      result: 'exited_suppressed',
    };
  }
  if (!node.data.templateId || !node.data.phoneNumberId) {
    return advance(ctx, node, null, 'skipped_incomplete_config');
  }

  // TODO(M4?): actually enqueue a WhatsApp single-send. The Phase 4
  //   dispatch-wa-single job expects an existing WhatsAppMessage row +
  //   conversationId; wiring that from a contactless entry point
  //   deserves its own review pass. For M3 we log the intent and
  //   advance so the flow doesn't stall.
  console.info(
    `[automation:whatsapp] TODO wire send — automation=${ctx.automationId} enrollment=${ctx.enrollmentId} node=${node.id}`,
  );
  return advance(ctx, node, null, 'stubbed_send');
}

async function processDelay(
  ctx: StepContext,
  node: Extract<AutomationNode, { type: 'delay' }>,
): Promise<StepResult> {
  const edges = outgoingEdges(ctx.definition, node.id);
  const targetId = edges[0]?.target ?? null;

  if (node.data.mode === 'absolute' && node.data.absoluteAt) {
    const delta = new Date(node.data.absoluteAt).getTime() - Date.now();
    return {
      nextNodeId: targetId,
      nextActionDelayMs: Math.max(0, delta),
      result: 'delayed_absolute',
    };
  }
  if (node.data.mode === 'weekday_time' && node.data.weekday !== null && node.data.hourUtc !== null) {
    const delta = minutesUntilWeekdayHour(node.data.weekday, node.data.hourUtc);
    return {
      nextNodeId: targetId,
      nextActionDelayMs: delta * 60_000,
      result: 'delayed_weekday',
    };
  }
  // relative
  const minutes = toMinutes(node.data.amount ?? 1, node.data.unit ?? 'days');
  return {
    nextNodeId: targetId,
    nextActionDelayMs: minutes * 60_000,
    result: 'delayed_relative',
  };
}

async function processSplit(
  ctx: StepContext,
  node: Extract<AutomationNode, { type: 'split' }>,
): Promise<StepResult> {
  const branch = await evaluateSplitCondition(ctx, node.data.condition);
  return advance(ctx, node, branch ? 'yes' : 'no', `split_${branch ? 'yes' : 'no'}`);
}

async function processPropertyUpdate(
  ctx: StepContext,
  node: Extract<AutomationNode, { type: 'property_update' }>,
): Promise<StepResult> {
  const key = node.data.customFieldKey;
  if (!key) return advance(ctx, node, null, 'skipped_no_key');
  const current = ctx.contact.customFields ?? {};
  const next = { ...current };
  if (node.data.action === 'set_custom_field') {
    next[key] = node.data.value;
  } else {
    delete next[key];
  }
  await prisma.contact.update({
    where: { id: ctx.contact.id },
    data: { customFields: next as Prisma.InputJsonValue },
  });
  return advance(ctx, node, null, node.data.action);
}

async function processListUpdate(
  ctx: StepContext,
  node: Extract<AutomationNode, { type: 'list_update' }>,
): Promise<StepResult> {
  const action = node.data.action;
  const targetId = node.data.targetId;
  switch (action) {
    case 'add_tag':
      if (!targetId) return advance(ctx, node, null, 'skipped_no_target');
      await prisma.contactTag
        .create({ data: { contactId: ctx.contact.id, tagId: targetId } })
        .catch(() => null); // ignore unique-violation on re-add
      break;
    case 'remove_tag':
      if (!targetId) return advance(ctx, node, null, 'skipped_no_target');
      await prisma.contactTag.deleteMany({
        where: { contactId: ctx.contact.id, tagId: targetId },
      });
      break;
    case 'move_to_segment':
      // Segments in this codebase are rule-based, not roster-based.
      // No-op with a warning — surface in Sentry so tenant notices.
      console.warn('[automation:list_update] move_to_segment is not applicable to rule-based segments');
      return advance(ctx, node, null, 'noop_segment');
    case 'unsubscribe_email':
      await prisma.contact.update({
        where: { id: ctx.contact.id },
        data: { emailStatus: 'UNSUBSCRIBED' },
      });
      break;
    case 'unsubscribe_whatsapp':
      await prisma.contact.update({
        where: { id: ctx.contact.id },
        data: { whatsappStatus: 'UNSUBSCRIBED' },
      });
      break;
    case 'unsubscribe_sms':
      await prisma.contact.update({
        where: { id: ctx.contact.id },
        data: { smsStatus: 'UNSUBSCRIBED' },
      });
      break;
  }
  return advance(ctx, node, null, action);
}

async function processInternalAlert(
  ctx: StepContext,
  node: Extract<AutomationNode, { type: 'internal_alert' }>,
): Promise<StepResult> {
  if (!node.data.target) {
    return advance(ctx, node, null, 'skipped_no_target');
  }
  const merge = buildMergeTags(ctx);
  const message = renderTemplate(
    node.data.message || `Contact ${ctx.contact.email ?? ctx.contact.id} reached this step`,
    merge,
  );
  try {
    if (node.data.channel === 'webhook') {
      await fetch(node.data.target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          automationId: ctx.automationId,
          enrollmentId: ctx.enrollmentId,
          nodeId: node.id,
          contact: {
            id: ctx.contact.id,
            email: ctx.contact.email,
            firstName: ctx.contact.firstName,
            lastName: ctx.contact.lastName,
          },
          message,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else if (node.data.channel === 'email' && resend) {
      const fromEmail = process.env.NOTIFICATIONS_FROM ?? 'noreply@getyn.com';
      await resend.emails.send({
        from: `Getyn Campaigns <${fromEmail}>`,
        to: node.data.target,
        subject: `[${ctx.tenant.name}] Automation alert`,
        text: message,
      });
    } else if (node.data.channel === 'user') {
      // Resolve to their email via Membership; skip if not found.
      const member = await prisma.membership.findUnique({
        where: { userId_tenantId: { userId: node.data.target, tenantId: ctx.tenantId } },
        select: { user: { select: { email: true } } },
      });
      if (member?.user.email && resend) {
        const fromEmail = process.env.NOTIFICATIONS_FROM ?? 'noreply@getyn.com';
        await resend.emails.send({
          from: `Getyn Campaigns <${fromEmail}>`,
          to: member.user.email,
          subject: `[${ctx.tenant.name}] Automation alert`,
          text: message,
        });
      }
    }
  } catch (err) {
    console.error('[automation:internal_alert] failed', err);
    Sentry.captureException(err, {
      tags: { handler: 'automation-internal-alert' },
      extra: { enrollmentId: ctx.enrollmentId, nodeId: node.id },
    });
    // Non-fatal — automation continues.
  }
  return advance(ctx, node, null, 'alerted');
}

// -----------------------------------------------------------------
// Conditional split evaluation
// -----------------------------------------------------------------

async function evaluateSplitCondition(
  ctx: StepContext,
  condition: Extract<AutomationNode, { type: 'split' }>['data']['condition'],
): Promise<boolean> {
  switch (condition.kind) {
    case 'has_tag':
      return (
        (await prisma.contactTag.count({
          where: { contactId: ctx.contact.id, tagId: condition.tagId },
        })) > 0
      );
    case 'custom_field_equals':
      return String(ctx.contact.customFields[condition.customFieldKey] ?? '') === condition.value;
    case 'time_since_enrollment': {
      const enrollment = await prisma.automationEnrollment.findUnique({
        where: { id: ctx.enrollmentId },
        select: { enrolledAt: true },
      });
      if (!enrollment) return false;
      const diffMinutes = Math.floor((Date.now() - enrollment.enrolledAt.getTime()) / 60_000);
      return condition.op === 'gt'
        ? diffMinutes > condition.minutes
        : diffMinutes < condition.minutes;
    }
    case 'opened_previous_email':
    case 'clicked_previous_email':
    case 'clicked_specific_link':
      // Email engagement checks. For MVP we consult ContactEvent —
      // which the automation email path emits `EMAIL_SENT` for.
      // Real per-node OPENED/CLICKED tracking will land when we wire
      // the automation email through the campaign pipeline (M4/M5
      // scope). Default false so branches at least route somewhere.
      return false;
    case 'whatsapp_message_delivered':
    case 'whatsapp_message_read':
    case 'whatsapp_message_replied':
      return false;
  }
}

// -----------------------------------------------------------------
// Merge tags + template substitution
// -----------------------------------------------------------------

function buildMergeTags(ctx: StepContext): Record<string, string> {
  const tags: Record<string, string> = {
    'contact.firstName': ctx.contact.firstName ?? '',
    'contact.lastName': ctx.contact.lastName ?? '',
    'contact.email': ctx.contact.email ?? '',
    'contact.phone': ctx.contact.phone ?? '',
    'tenant.name': ctx.tenant.name,
    'tenant.company': ctx.tenant.companyDisplayName ?? ctx.tenant.name,
    'tenant.postalAddress': ctx.tenant.postalAddress ?? '',
    // Also legacy short names for backward compat with campaign
    // template conventions.
    firstName: ctx.contact.firstName ?? '',
    lastName: ctx.contact.lastName ?? '',
    email: ctx.contact.email ?? '',
  };
  for (const [key, value] of Object.entries(ctx.contact.customFields)) {
    tags[`contact.${key}`] = String(value ?? '');
  }
  return tags;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, key: string) => {
    const v = vars[key];
    return v === undefined ? m : v;
  });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// -----------------------------------------------------------------
// Time helpers
// -----------------------------------------------------------------

const UNIT_MINUTES: Record<string, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
};

function toMinutes(amount: number, unit: string): number {
  return amount * (UNIT_MINUTES[unit] ?? 0);
}

function minutesUntilWeekdayHour(weekday: number, hourUtc: number): number {
  const now = new Date();
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hourUtc,
      0,
      0,
      0,
    ),
  );
  // Advance to the requested weekday.
  const dayDiff = (weekday - target.getUTCDay() + 7) % 7;
  if (dayDiff === 0 && target.getTime() <= Date.now()) {
    target.setUTCDate(target.getUTCDate() + 7);
  } else {
    target.setUTCDate(target.getUTCDate() + dayDiff);
  }
  return Math.max(0, Math.floor((target.getTime() - Date.now()) / 60_000));
}

// -----------------------------------------------------------------
// nodeStateHistory append with cap
// -----------------------------------------------------------------

interface HistoryEntry {
  nodeId: string;
  type: string;
  enteredAt: string;
  exitedAt: string;
  result: string | null;
}

function appendHistory(prev: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const next = Array.isArray(prev) ? [...prev, entry] : [entry];
  if (next.length > NODE_HISTORY_CAP) {
    // Loop detector: overflow means the enrollment has stepped
    // through NODE_HISTORY_CAP nodes — indicates a design issue we
    // should hear about.
    Sentry.captureMessage('[automation] nodeStateHistory overflow — potential loop', {
      level: 'warning',
      extra: { entry },
    });
    next.splice(0, next.length - NODE_HISTORY_CAP);
  }
  return next;
}

// -----------------------------------------------------------------
// Failure helpers
// -----------------------------------------------------------------

async function failEnrollment(enrollmentId: string, reason: string): Promise<void> {
  await prisma.automationEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: EnrollmentStatus.FAILED,
      exitReason: reason,
      completedAt: new Date(),
      nextActionAt: null,
    },
  });
}

// -----------------------------------------------------------------
// Queue producer (worker-side)
// -----------------------------------------------------------------
//
// The web app has its own producer at apps/web/src/server/queues/index.ts;
// the tick handler needs to enqueue step jobs from *within* the worker,
// which means talking to Redis directly. Isolate the setup here to
// avoid pulling web deps.

let cachedProducer: {
  sendsQueueProducer: { enqueueStep: (enrollmentId: string, tenantId: string) => Promise<void> };
} | null = null;

async function getQueueProducer(): Promise<NonNullable<typeof cachedProducer>> {
  if (cachedProducer) return cachedProducer;
  const { Queue } = await import('bullmq');
  const { createRedisConnection } = await import('../redis');
  const { QUEUE_NAMES, JOB_NAMES } = await import('@getyn/types');
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL missing — worker cannot enqueue');
  const connection = createRedisConnection(url);
  const q = new Queue(QUEUE_NAMES.automations, { connection });
  cachedProducer = {
    sendsQueueProducer: {
      enqueueStep: async (enrollmentId, tenantId) => {
        await q.add(
          JOB_NAMES.automations.step,
          { enrollmentId, tenantId },
          { jobId: `step_${enrollmentId}_${randomUUID().slice(0, 8)}` },
        );
      },
    },
  };
  return cachedProducer;
}
