/* eslint-disable no-console */
/**
 * Phase 8 M5 — Email Agent execution engine.
 *
 * Three handlers on the `email-agent` queue:
 *
 *   email-agent-enroll (per-enrollment, one-shot)
 *     Draft + send the initial outreach for a fresh
 *     EmailAgentEnrollment. Idempotent — bails out if the enrollment
 *     already has an OUTBOUND message with currentStep==0.
 *
 *   email-agent-followup-tick (repeatable, 60s)
 *     Scan ACTIVE enrollments where nextActionAt <= now and
 *     currentStep < maxFollowUps; enqueue individual step jobs.
 *     For now the tick does the follow-up drafting inline (batch
 *     capped) — a future refactor can split into per-enrollment
 *     jobs if we need parallelism.
 *
 *   email-agent-process-reply (per-inbound, one-shot)
 *     Fired by the M1 inbound-email worker. Loads inbound + agent
 *     config, classifies with Haiku, drafts with Sonnet for
 *     actionable classifications, sets enrollment to
 *     PAUSED_AWAITING_APPROVAL. NOT_INTERESTED exits the enrollment.
 *
 * All outbound sends are marked APPROVED_QUEUED (initial + scheduled
 * follow-ups are proactive, not reactive to a reply — the config
 * itself is the tenant's approval). ONLY reply drafts land as
 * DRAFT_AWAITING_APPROVAL for human review.
 */
import { Resend } from 'resend';
import type { Job } from 'bullmq';
import * as Sentry from '@sentry/node';

import { getAnthropicClient } from '@getyn/ai';
type Anthropic = ReturnType<typeof getAnthropicClient>;

import {
  EmailAgentMessageDirection,
  EmailAgentMessageStatus,
  EnrollmentStatus,
  ReplyClassification,
  prisma,
} from '@getyn/db';
import { buildReplyToAddress } from '@getyn/crypto';
import type {
  EmailAgentEnrollPayload,
  EmailAgentProcessReplyPayload,
} from '@getyn/types';

import { getAnthropicApiKey } from '../integrations/anthropic';

// -----------------------------------------------------------------
// Shared setup
// -----------------------------------------------------------------

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Cheap classifier for inbound replies (Haiku 4.5 per current
// pricing).
const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';
// Drafting model for outbound messages (initial send, follow-ups,
// reply drafts). Sonnet 4.6.
const DRAFTING_MODEL = 'claude-sonnet-4-6';

// Per-call cost caps. Sonnet: 3 in / 15 out per M tokens; Haiku
// pricing much cheaper. We enforce a hard token cap in the request
// so runaway generations can't spike a tenant's usage.
const MAX_TOKENS_DRAFT = 1200;
const MAX_TOKENS_CLASSIFY = 60;

// Follow-up tick batch cap. Small — LLM calls are the bottleneck,
// so we drain gradually. If backlog grows, split into per-enrollment
// jobs like the drip engine.
// Follow-up + orphan-sweep batch size per tick. Bumped from 25 →
// 100 so the automatic drain keeps pace with a 12k+ orphan backlog
// (100/min × 60 = 6000/hour vs the old 1500/hour). The downstream
// send layer still enforces the agent's `sending_throttle_per_second`
// against Resend, so we can't send faster than Resend allows — this
// just widens the *enqueue* rate so the send layer stays saturated.
const FOLLOWUP_BATCH_SIZE = 100;

/**
 * Lazy Anthropic client — pulls key from DB or env with 60s cache.
 * getAnthropicApiKey handles the fallback chain.
 */
async function anthropic(): Promise<Anthropic | null> {
  const key = await getAnthropicApiKey();
  if (!key) return null;
  return getAnthropicClient(key);
}

// -----------------------------------------------------------------
// Public handlers
// -----------------------------------------------------------------

export async function handleEmailAgentEnroll(
  job: Job<EmailAgentEnrollPayload>,
): Promise<void> {
  const { enrollmentId, isTest } = job.data;
  const enrollment = await loadEnrollment(enrollmentId);
  if (!enrollment) return;

  // Idempotence: if we already sent the initial email, skip.
  const existing = await prisma.emailAgentMessage.findFirst({
    where: {
      enrollmentId,
      direction: EmailAgentMessageDirection.OUTBOUND,
    },
    select: { id: true },
  });
  if (existing) {
    console.info(`[email-agent:enroll] ${enrollmentId} already has outbound; skipping`);
    return;
  }

  if (enrollment.status !== EnrollmentStatus.ACTIVE) return;
  // Test-agent enrollments bypass the ACTIVE-only gate so operators
  // can iterate against a DRAFT / PAUSED agent without turning the
  // whole cohort back on.
  if (!isTest && enrollment.emailAgent.status !== 'ACTIVE') return;

  if (!enrollment.contact.email) {
    await exitEnrollment(enrollmentId, 'no_email');
    return;
  }
  if (enrollment.contact.emailStatus !== 'SUBSCRIBED') {
    await exitEnrollment(enrollmentId, `channel_${enrollment.contact.emailStatus.toLowerCase()}`);
    return;
  }

  const client = await anthropic();
  if (!client) {
    console.warn('[email-agent:enroll] ANTHROPIC_API_KEY missing — cannot draft');
    return;
  }
  const draft = await draftInitial(client, enrollment);
  if (!draft) {
    Sentry.captureMessage('[email-agent:enroll] draft failed', {
      level: 'warning',
      extra: { enrollmentId },
    });
    return;
  }

  await sendAndPersistOutbound(enrollment, draft, EmailAgentMessageStatus.APPROVED_QUEUED, {
    step: 0,
  });

  // Schedule the first follow-up (if any).
  await scheduleNextFollowUp(enrollmentId, 0);
}

export async function handleEmailAgentFollowupTick(): Promise<void> {
  const now = new Date();
  const due = await prisma.emailAgentEnrollment.findMany({
    where: {
      status: EnrollmentStatus.ACTIVE,
      nextActionAt: { lte: now },
      emailAgent: { status: 'ACTIVE', drainPausedAt: null },
    },
    select: { id: true },
    orderBy: [{ nextActionAt: 'asc' }, { id: 'asc' }],
    take: FOLLOWUP_BATCH_SIZE,
  });
  if (due.length > 0) {
    console.info(`[email-agent:followup] processing ${due.length} follow-ups`);
    for (const row of due) {
      try {
        await processFollowUp(row.id);
      } catch (err) {
        console.error(`[email-agent:followup] ${row.id} failed`, err);
        Sentry.captureException(err, {
          tags: { handler: 'email-agent-followup' },
          extra: { enrollmentId: row.id },
        });
      }
    }
  }

  // Orphan sweeper — enrollments whose initial-send job silently
  // failed (Anthropic outage, transient SDK rejection, worker crash
  // mid-draft). They sit at currentStep=0, lastSentAt=null,
  // nextActionAt=null forever because the follow-up filter only
  // matches nextActionAt<=now. Ten-minute grace so we don't race
  // an enroll job currently in flight from the same tick.
  const ORPHAN_GRACE_MS = 10 * 60 * 1000;
  const orphans = await prisma.emailAgentEnrollment.findMany({
    where: {
      status: EnrollmentStatus.ACTIVE,
      currentStep: 0,
      lastSentAt: null,
      nextActionAt: null,
      enrolledAt: { lt: new Date(now.getTime() - ORPHAN_GRACE_MS) },
      emailAgent: { status: 'ACTIVE', drainPausedAt: null },
    },
    select: { id: true, tenantId: true },
    orderBy: [{ enrolledAt: 'asc' }],
    take: FOLLOWUP_BATCH_SIZE,
  });
  if (orphans.length === 0) return;
  console.info(`[email-agent:followup] re-enqueueing ${orphans.length} orphaned initials`);
  const { enqueueEmailAgentEnrollFromWorker } = await import('../index');
  for (const row of orphans) {
    try {
      await enqueueEmailAgentEnrollFromWorker({
        enrollmentId: row.id,
        tenantId: row.tenantId,
      });
    } catch (err) {
      console.error(`[email-agent:orphan-sweep] ${row.id} failed`, err);
      Sentry.captureException(err, {
        tags: { handler: 'email-agent-orphan-sweep' },
        extra: { enrollmentId: row.id },
      });
    }
  }
}

/**
 * Direct-dispatch follow-up for operator-submitted hints from the
 * Kanban "Suggest a reply" drawer. Same processFollowUp path the
 * tick uses, but enqueued with priority: 1 so it doesn't wait
 * behind a 12k-orphan backlog. The row already has nextActionAt
 * set by submitSuggestedReply, so processFollowUp's atomic-claim
 * still holds — a concurrent tick can't double-send.
 */
export async function handleEmailAgentImmediateFollowUp(
  job: Job<{ enrollmentId: string; tenantId: string }>,
): Promise<void> {
  try {
    await processFollowUp(job.data.enrollmentId);
  } catch (err) {
    console.error(
      `[email-agent:immediate-followup] ${job.data.enrollmentId} failed`,
      err,
    );
    Sentry.captureException(err, {
      tags: { handler: 'email-agent-immediate-followup' },
      extra: { enrollmentId: job.data.enrollmentId },
    });
    throw err; // let BullMQ retry per the queue's default retry policy
  }
}

export async function handleEmailAgentProcessReply(
  job: Job<EmailAgentProcessReplyPayload>,
): Promise<void> {
  const { inboundEmailId, enrollmentId } = job.data;
  const inbound = await prisma.inboundEmail.findUnique({
    where: { id: inboundEmailId },
    select: {
      id: true,
      fromAddress: true,
      subject: true,
      bodyText: true,
      bodyHtml: true,
    },
  });
  const enrollment = await loadEnrollment(enrollmentId);
  if (!inbound || !enrollment) return;

  // Persist the inbound as an EmailAgentMessage row so the approval
  // inbox has a single source of truth for the thread.
  const inboundRow = await prisma.emailAgentMessage.create({
    data: {
      tenantId: enrollment.tenantId,
      enrollmentId,
      direction: EmailAgentMessageDirection.INBOUND,
      subject: inbound.subject,
      bodyHtml: inbound.bodyHtml,
      bodyText: inbound.bodyText,
      status: EmailAgentMessageStatus.REPLIED,
      messageId: `inbound_${inbound.id}`,
    },
    select: { id: true },
  });

  // Accumulator for every LLM call this reply-processing pipeline
  // makes (classify + delay-detect Haiku fallback + reply draft).
  // We charge it to the outbound reply's aiGenerationCostCents when
  // we produce one; on paths that early-return without drafting
  // (delay-request, OUT_OF_OFFICE, BOUNCE, NOT_INTERESTED, drafter
  // failure) we attach it to the inbound row instead so no LLM
  // spend goes unrecorded.
  let processingCostCents = 0;
  const attachToInbound = async (): Promise<void> => {
    if (processingCostCents === 0) return;
    await prisma.emailAgentMessage.update({
      where: { id: inboundRow.id },
      data: { aiGenerationCostCents: processingCostCents },
    });
  };

  // Phase 9 — stop-keyword hard match. Case-insensitive substring
  // check against the agent's operator-configured phrases. Overrides
  // any LLM classification because "do not email me again" is
  // unambiguous and a wrong-answer failure mode here is legally
  // costly (CAN-SPAM / GDPR).
  const stopWords = (enrollment.emailAgent.stopKeywords ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const replyLower = (inbound.bodyText || stripHtml(inbound.bodyHtml))
    .toLowerCase();
  const matchedStop = stopWords.find((kw) => kw && replyLower.includes(kw));

  if (matchedStop) {
    await prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        lastInboundAt: new Date(),
        conversationStatus: 'INACTIVE',
        status: EnrollmentStatus.EXITED,
        exitReason: `stop_keyword:${matchedStop}`,
        completedAt: new Date(),
        nextActionAt: null,
      },
    });
    // Best-effort suppression add so the contact never gets emailed
    // again from any surface.
    try {
      const { Channel, SuppressionReason } = await import('@getyn/db');
      await prisma.suppressionEntry.upsert({
        where: {
          tenantId_channel_value: {
            tenantId: enrollment.tenantId,
            channel: Channel.EMAIL,
            value: inbound.fromAddress.toLowerCase(),
          },
        },
        create: {
          tenantId: enrollment.tenantId,
          channel: Channel.EMAIL,
          value: inbound.fromAddress.toLowerCase(),
          reason: SuppressionReason.UNSUBSCRIBED,
          metadata: { source: 'email_agent_stop_keyword' } as unknown as object,
        },
        update: {
          reason: SuppressionReason.UNSUBSCRIBED,
          metadata: { source: 'email_agent_stop_keyword' } as unknown as object,
        },
      });
    } catch (err) {
      console.warn(
        '[email-agent:reply] suppression upsert failed',
        err,
      );
    }
    console.info(
      `[email-agent:reply] ${enrollmentId} stop-keyword "${matchedStop}" → INACTIVE`,
    );
    return;
  }

  const client = await anthropic();

  // Phase 9 — if the sender asks to be contacted after N days
  // ("get back to me next week", "reach out in 2 weeks"), auto-move
  // the card into COOLING_PERIOD with a cooldownUntil, so the
  // cooling-wake cron auto-resumes at the right time. No human review
  // needed for these — the request is explicit.
  const delay = await detectDelayRequest(
    client,
    inbound.bodyText || stripHtml(inbound.bodyHtml),
  );
  if (delay) processingCostCents += delay.costCents;
  if (delay) {
    const until = new Date(Date.now() + delay.days * 24 * 60 * 60 * 1000);
    await prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        lastInboundAt: new Date(),
        conversationStatus: 'COOLING_PERIOD',
        cooldownUntil: until,
        nextActionAt: null,
      },
    });
    console.info(
      `[email-agent:reply] ${enrollmentId} delay-request ${delay.days}d (${delay.source}) → COOLING_PERIOD until ${until.toISOString()}`,
    );
    await attachToInbound();
    return;
  }

  // Otherwise: any reply pauses the sequence and lands the card in
  // REVIEW_RESPONSE so a human can shape the next outbound.
  await prisma.emailAgentEnrollment.update({
    where: { id: enrollmentId },
    data: {
      lastInboundAt: new Date(),
      conversationStatus: 'REVIEW_RESPONSE',
    },
  });

  if (!client) return;

  // Classify with Haiku.
  const classification = await classifyReply(client, {
    goal: enrollment.emailAgent.goal,
    replyText: inbound.bodyText || stripHtml(inbound.bodyHtml),
  });
  const classified = classification.classification;
  processingCostCents += classification.costCents;

  // Route by classification.
  if (classified === ReplyClassification.OUT_OF_OFFICE || classified === ReplyClassification.BOUNCE) {
    // Don't draft; keep the follow-up sequence going.
    console.info(`[email-agent:reply] ${enrollmentId} classified ${classified}; continuing`);
    await attachToInbound();
    return;
  }
  if (classified === ReplyClassification.NOT_INTERESTED) {
    await prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: EnrollmentStatus.EXITED,
        exitReason: 'not_interested',
        completedAt: new Date(),
        nextActionAt: null,
      },
    });
    await attachToInbound();
    return;
  }

  // Draft a reply with Sonnet.
  const history = await loadThreadHistory(enrollmentId);
  const draft = await draftReply(client, enrollment, {
    inboundSubject: inbound.subject,
    inboundBody: inbound.bodyText || stripHtml(inbound.bodyHtml),
    history,
  });
  if (!draft) {
    // Sonnet call returned null — still record the classify+delay
    // cost we already burned on the inbound row.
    await attachToInbound();
    return;
  }
  // Fold classify + delay-detect cost into the outbound draft's
  // costCents so a single row captures the total AI spend attributable
  // to processing this reply. Matches how initial-send prompt costs
  // are already recorded on the outbound row.
  const totalDraftCost = draft.costCents + processingCostCents;

  await prisma.$transaction([
    prisma.emailAgentMessage.create({
      data: {
        tenantId: enrollment.tenantId,
        enrollmentId,
        direction: EmailAgentMessageDirection.OUTBOUND,
        subject: draft.subject,
        bodyHtml: draft.bodyHtml,
        bodyText: draft.bodyText,
        status: EmailAgentMessageStatus.DRAFT_AWAITING_APPROVAL,
        inboundClassification: classified,
        aiGenerationContext: draft.context as unknown as object,
        aiGenerationCostCents: totalDraftCost,
      },
    }),
    prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: EnrollmentStatus.PAUSED_AWAITING_APPROVAL,
        nextActionAt: null,
      },
    }),
  ]);
}

// -----------------------------------------------------------------
// Follow-up processing (inline, called by the tick)
// -----------------------------------------------------------------

async function processFollowUp(enrollmentId: string): Promise<void> {
  // Phase 9 dupe-send fix — reserve the row atomically BEFORE the
  // multi-second Sonnet call. Without this, the 60s tick fires again
  // while the LLM is still drafting and the same enrollment gets
  // drafted+sent multiple times back-to-back (users saw 2–3 identical
  // emails within 2 seconds).
  //
  // We do a conditional updateMany against (id, nextActionAt<=now,
  // status=ACTIVE) → if count===0 another worker already claimed it.
  // If count===1 we hold the reservation and continue safely. We
  // clear nextActionAt for the duration; scheduleNextFollowUp at the
  // end sets it to the real next-touch time.
  const now = new Date();
  const claim = await prisma.emailAgentEnrollment.updateMany({
    where: {
      id: enrollmentId,
      status: EnrollmentStatus.ACTIVE,
      nextActionAt: { lte: now },
    },
    data: { nextActionAt: null },
  });
  if (claim.count === 0) return;

  const enrollment = await loadEnrollment(enrollmentId);
  if (!enrollment) return;
  if (enrollment.status !== EnrollmentStatus.ACTIVE) return;

  const schedule = enrollment.emailAgent.outboundSchedule as {
    followUpDays: number[];
    maxFollowUps: number;
    stopOnReply: boolean;
  };

  // Reply-since-last-send guard.
  if (
    enrollment.lastInboundAt &&
    enrollment.lastSentAt &&
    enrollment.lastInboundAt > enrollment.lastSentAt &&
    schedule.stopOnReply
  ) {
    // Reply arrived — the process-reply handler owns this from here.
    // Just clear nextActionAt so the tick stops picking us up.
    await prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: { nextActionAt: null },
    });
    return;
  }

  if (enrollment.currentStep >= schedule.maxFollowUps) {
    await prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: EnrollmentStatus.COMPLETED,
        completedAt: new Date(),
        exitReason: 'max_follow_ups',
        nextActionAt: null,
      },
    });
    return;
  }

  const client = await anthropic();
  if (!client) return;

  const history = await loadThreadHistory(enrollmentId);
  const nextStep = enrollment.currentStep + 1;
  const draft = await draftFollowUp(client, enrollment, {
    stepNumber: nextStep,
    history,
  });
  if (!draft) return;

  await sendAndPersistOutbound(enrollment, draft, EmailAgentMessageStatus.APPROVED_QUEUED, {
    step: nextStep,
  });
  await scheduleNextFollowUp(enrollmentId, nextStep);
}

async function scheduleNextFollowUp(enrollmentId: string, currentStep: number): Promise<void> {
  const enrollment = await prisma.emailAgentEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      emailAgent: { select: { outboundSchedule: true } },
    },
  });
  if (!enrollment) return;
  const schedule = enrollment.emailAgent.outboundSchedule as {
    followUpDays: number[];
    maxFollowUps: number;
  };
  const nextStep = currentStep + 1;
  if (nextStep > schedule.maxFollowUps) {
    // No more follow-ups queued — the tick's max-check will close it
    // on the next cycle.
    await prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: { currentStep, nextActionAt: null },
    });
    return;
  }
  const dayOffset = schedule.followUpDays[nextStep - 1];
  if (dayOffset === undefined) {
    await prisma.emailAgentEnrollment.update({
      where: { id: enrollmentId },
      data: { currentStep, nextActionAt: null },
    });
    return;
  }
  const nextAt = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  await prisma.emailAgentEnrollment.update({
    where: { id: enrollmentId },
    data: { currentStep, nextActionAt: nextAt },
  });
}

// -----------------------------------------------------------------
// Enrollment fetch + shared shape
// -----------------------------------------------------------------

async function loadEnrollment(enrollmentId: string): Promise<EnrollmentContext | null> {
  const row = await prisma.emailAgentEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      emailAgent: {
        include: {
          knowledgeSources: {
            select: { rawTitle: true, summary: true, kind: true, sourceUrl: true },
          },
        },
      },
      contact: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          customFields: true,
          emailStatus: true,
        },
      },
      tenant: {
        select: {
          id: true,
          name: true,
          companyDisplayName: true,
        },
      },
    },
  });
  if (!row) return null;
  return row as unknown as EnrollmentContext;
}

interface EnrollmentContext {
  id: string;
  tenantId: string;
  emailAgentId: string;
  status: EnrollmentStatus;
  conversationStatus: string;
  suggestedReplyHint: string | null;
  suggestedReplyCc: string | null;
  currentStep: number;
  lastSentAt: Date | null;
  lastInboundAt: Date | null;
  emailAgent: {
    id: string;
    name: string;
    status: string;
    goal: string;
    tone: string;
    systemInstructions: string;
    signature: string;
    outboundSchedule: unknown;
    stopKeywords: string;
    coolingPeriodDays: number;
    fromName: string;
    fromEmail: string;
    knowledgeSources: {
      rawTitle: string;
      summary: string;
      kind: string;
      sourceUrl: string | null;
    }[];
  };
  contact: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    customFields: Record<string, unknown>;
    emailStatus: string;
  };
  tenant: {
    id: string;
    name: string;
    companyDisplayName: string | null;
  };
}

// -----------------------------------------------------------------
// Sonnet drafting
// -----------------------------------------------------------------

interface Draft {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  costCents: number;
  context: {
    prompt: string;
    knowledgeSourceCount: number;
    model: string;
    kind: 'initial' | 'followup' | 'reply';
  };
}

async function draftInitial(
  client: Anthropic,
  ctx: EnrollmentContext,
): Promise<Draft | null> {
  return callDrafter(client, ctx, {
    kind: 'initial',
    task: 'Write the first outreach email to this contact based on the agent goal + knowledge below. Keep it under 150 words, personalized to what we know about them, direct, and end with a single specific ask.',
  });
}

async function draftFollowUp(
  client: Anthropic,
  ctx: EnrollmentContext,
  args: { stepNumber: number; history: ThreadMessage[] },
): Promise<Draft | null> {
  return callDrafter(client, ctx, {
    kind: 'followup',
    task: `Write follow-up #${args.stepNumber}. Reference the previous ${args.history.length} message(s) in the thread. Keep it short, add new value (not just a bump), and change the ask if the earlier one didn't land.`,
    history: args.history,
  });
}

async function draftReply(
  client: Anthropic,
  ctx: EnrollmentContext,
  args: {
    inboundSubject: string;
    inboundBody: string;
    history: ThreadMessage[];
  },
): Promise<Draft | null> {
  return callDrafter(client, ctx, {
    kind: 'reply',
    task: `The contact replied. Draft a response that engages with what they actually said. Use the knowledge sources when they asked about product/pricing/etc. Keep it conversational and match their length.`,
    history: [
      ...args.history,
      { direction: 'INBOUND', subject: args.inboundSubject, body: args.inboundBody },
    ],
  });
}

interface ThreadMessage {
  direction: 'INBOUND' | 'OUTBOUND';
  subject: string;
  body: string;
}

async function loadThreadHistory(enrollmentId: string): Promise<ThreadMessage[]> {
  const rows = await prisma.emailAgentMessage.findMany({
    where: { enrollmentId },
    orderBy: { createdAt: 'asc' },
    select: {
      direction: true,
      subject: true,
      bodyText: true,
    },
    take: 20,
  });
  return rows.map((r) => ({
    direction: r.direction as 'INBOUND' | 'OUTBOUND',
    subject: r.subject,
    body: r.bodyText,
  }));
}

/**
 * Split the drafting prompt into three parts so Anthropic prompt
 * caching can amortise the stable prefix across every follow-up on
 * the same agent (Phase 9 cost optimisation):
 *
 *   1. `buildStableSystem` — persona/goal/tone/operator-instructions
 *      /knowledge. Identical for every enrollment on the same
 *      EmailAgent, so we mark it `cache_control: ephemeral` and pay
 *      10% of input price after the first hit within the cache TTL.
 *   2. `buildDynamicUser` — per-enrollment (contact, thread, task,
 *      one-shot operator hint). Not cached.
 *   3. `buildTailInstructions` — fixed JSON-output contract. Kept
 *      inside the user message so cache invalidation stays scoped
 *      to the stable block above.
 *
 * For a 10-touch enrollment the persona/knowledge block gets sent
 * once at full price and hit 9 more times at the 10% cache rate —
 * roughly a 60–70% input-token cost reduction on drafts alone.
 */
function buildStableSystem(ctx: EnrollmentContext): string {
  const knowledge = ctx.emailAgent.knowledgeSources
    .filter((s) => s.summary && !s.summary.startsWith('(URL — extracting'))
    .map((s, i) => `[${i + 1}] ${s.rawTitle}${s.sourceUrl ? ` (${s.sourceUrl})` : ''}\n${s.summary}`)
    .join('\n\n');
  return [
    `You are an outbound email agent for ${ctx.tenant.companyDisplayName ?? ctx.tenant.name}.`,
    `Tone: ${ctx.emailAgent.tone.toLowerCase()}.`,
    ``,
    `AGENT GOAL:\n${ctx.emailAgent.goal}`,
    ``,
    `INSTRUCTIONS FROM OPERATOR:\n${ctx.emailAgent.systemInstructions || '(none)'}`,
    ``,
    knowledge ? `KNOWLEDGE BASE (use as needed):\n${knowledge}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildDynamicUser(
  ctx: EnrollmentContext,
  args: {
    task: string;
    history?: ThreadMessage[];
  },
): string {
  const contactBits = [
    ctx.contact.firstName && `First name: ${ctx.contact.firstName}`,
    ctx.contact.lastName && `Last name: ${ctx.contact.lastName}`,
    ctx.contact.email && `Email: ${ctx.contact.email}`,
    ...Object.entries(ctx.contact.customFields)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${String(v)}`),
  ]
    .filter(Boolean)
    .join('\n');
  const history = (args.history ?? [])
    .map((m) => `[${m.direction}] ${m.subject}\n${m.body}`)
    .join('\n\n---\n\n');
  return [
    // Phase 9 — one-shot hint the operator submitted from the Kanban
    // "Review Response" drawer. High priority: the model should weave
    // it in without contradicting the goal/instructions.
    ctx.suggestedReplyHint
      ? `URGENT REPLY HINT FROM OPERATOR — include this in the next email:\n"${ctx.suggestedReplyHint}"`
      : '',
    ``,
    `CONTACT:\n${contactBits || '(no profile data)'}`,
    ``,
    history ? `THREAD SO FAR:\n${history}` : '',
    ``,
    `TASK: ${args.task}`,
    ``,
    `Return a JSON object with keys "subject" and "body" (plaintext, no HTML). The signature "${ctx.emailAgent.signature || '(none set)'}" will be appended by the send pipeline — do NOT include a sign-off. Reply with ONLY the JSON, no prose.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Tier-by-touch model routing. Sonnet 4.6 for the two touches that
 * matter most (first outbound + replies to a real human), Haiku 4.5
 * for follow-up nudges — same output-token budget, ~5x cheaper on
 * input, ~3x cheaper on output. Combined with prompt caching this
 * takes typical enrollment spend from ~$0.20 to ~$0.04.
 */
function pickDraftModel(kind: 'initial' | 'followup' | 'reply'): {
  model: string;
  inputPricePerMTok: number;
  cacheReadPricePerMTok: number;
  outputPricePerMTok: number;
} {
  if (kind === 'followup') {
    return {
      model: CLASSIFIER_MODEL, // Haiku 4.5
      inputPricePerMTok: 1.0,
      cacheReadPricePerMTok: 0.1,
      outputPricePerMTok: 5.0,
    };
  }
  return {
    model: DRAFTING_MODEL, // Sonnet 4.6
    inputPricePerMTok: 3.0,
    cacheReadPricePerMTok: 0.3,
    outputPricePerMTok: 15.0,
  };
}

async function callDrafter(
  client: Anthropic,
  ctx: EnrollmentContext,
  args: {
    kind: 'initial' | 'followup' | 'reply';
    task: string;
    history?: ThreadMessage[];
  },
): Promise<Draft | null> {
  const stableSystem = buildStableSystem(ctx);
  const userMessage = buildDynamicUser(ctx, { task: args.task, history: args.history });
  const routing = pickDraftModel(args.kind);
  // Try the caching-enabled path first (system as an array with
  // cache_control on the stable block). If the SDK/API rejects that
  // shape for any reason — usually an older @anthropic-ai/sdk that
  // predates GA prompt caching — fall back to the plain-string form
  // so the drafter still returns a message. Losing the cache saving
  // is preferable to silently dropping every outbound email.
  const callWithCache = () =>
    client.messages.create({
      model: routing.model,
      max_tokens: MAX_TOKENS_DRAFT,
      system: [
        {
          type: 'text',
          text: stableSystem,
          cache_control: { type: 'ephemeral' },
        },
      ] as never,
      messages: [{ role: 'user', content: userMessage }],
    });
  const callPlain = () =>
    client.messages.create({
      model: routing.model,
      max_tokens: MAX_TOKENS_DRAFT,
      system: stableSystem,
      messages: [{ role: 'user', content: userMessage }],
    });

  try {
    let res: Awaited<ReturnType<typeof callWithCache>>;
    try {
      res = await callWithCache();
    } catch (cacheErr) {
      // Log once so we notice if this always falls back — otherwise
      // the caching optimization would be silently disabled.
      console.warn(
        '[email-agent] cache_control path rejected, falling back to plain system prompt',
        cacheErr instanceof Error ? cacheErr.message : cacheErr,
      );
      res = await callPlain();
    }
    const text = (res.content as { type: string; text?: string }[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    const parsed = extractJson(text);
    if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
      Sentry.captureMessage('[email-agent] draft output not parseable', {
        level: 'warning',
        extra: { text: text.slice(0, 500), model: routing.model, kind: args.kind },
      });
      return null;
    }
    // Anthropic reports cache reads + writes separately in usage.
    // Full-price input tokens = input_tokens - cache_read_input_tokens
    // - cache_creation_input_tokens. Cache writes are billed at 1.25x
    // input; reads at 0.1x input. Approximate here with two lines.
    const u = res.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    const cacheReads = u.cache_read_input_tokens ?? 0;
    const cacheWrites = u.cache_creation_input_tokens ?? 0;
    const freshInput = Math.max(0, u.input_tokens - cacheReads - cacheWrites);
    // Bill at least 1¢ per call so Haiku follow-ups (which typically
    // land under 0.5¢ each and would round to 0) still show up in
    // aggregate spend queries. Slight overcount vs Anthropic's actual
    // bill on the very cheap end, but the alternative — silently
    // recording $0 — makes cost dashboards lie.
    const rawCents =
      ((freshInput / 1_000_000) * routing.inputPricePerMTok +
        (cacheWrites / 1_000_000) * routing.inputPricePerMTok * 1.25 +
        (cacheReads / 1_000_000) * routing.cacheReadPricePerMTok +
        (u.output_tokens / 1_000_000) * routing.outputPricePerMTok) *
      100;
    const costCents = Math.max(1, Math.ceil(rawCents));
    if (costCents > 30) {
      Sentry.captureMessage('[email-agent] draft exceeded $0.30 cap', {
        level: 'warning',
        extra: { costCents, kind: args.kind, model: routing.model, tokens: u },
      });
    }
    const subject = parsed.subject.trim();
    const bodyText = parsed.body.trim();
    // Successful draft — clear any prior drafter-error state on the
    // agent so the status banner flips back to healthy.
    if (ctx.emailAgent.id) {
      prisma.emailAgent
        .updateMany({
          where: {
            id: ctx.emailAgent.id,
            lastDrafterErrorAt: { not: null },
          },
          data: { lastDrafterErrorAt: null, lastDrafterErrorMessage: null },
        })
        .catch((e) =>
          console.warn('[email-agent] failed clearing lastDrafterError', e),
        );
    }
    return {
      subject,
      bodyText,
      bodyHtml: textToHtml(bodyText),
      costCents,
      context: {
        prompt: userMessage, // stable system omitted from context row; it's on the agent
        knowledgeSourceCount: 0,
        model: routing.model,
        kind: args.kind,
      },
    };
  } catch (err) {
    console.error('[email-agent] draft call failed', err);
    Sentry.captureException(err, {
      tags: { handler: 'email-agent-draft', model: routing.model, kind: args.kind },
    });
    // Persist the last drafter error on the agent so the Kanban
    // status banner can surface *why* things stopped moving. Rewrite
    // known Anthropic errors into short operator-actionable phrases
    // (the raw JSON body is unreadable in a banner and buries the
    // one thing an operator needs to see).
    const raw = err instanceof Error ? err.message : String(err);
    const msg = summarizeAnthropicError(raw);
    if (ctx.emailAgent.id) {
      prisma.emailAgent
        .update({
          where: { id: ctx.emailAgent.id },
          data: {
            lastDrafterErrorAt: new Date(),
            lastDrafterErrorMessage: msg,
          },
        })
        .catch((e) =>
          console.warn('[email-agent] failed recording lastDrafterError', e),
        );
    }
    return null;
  }
}

/**
 * Rewrite raw Anthropic error strings into short banner-friendly
 * messages. Every branch returns something an operator can act on:
 * top up credits, wait, check status, etc. Falls back to a truncated
 * raw string so unknown errors still surface something.
 */
function summarizeAnthropicError(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes('credit balance is too low')) {
    return 'Anthropic API credits exhausted — top up at console.anthropic.com/settings/billing, then Resume.';
  }
  if (t.includes('rate_limit') || t.includes('rate limit')) {
    return 'Anthropic rate limit hit — the sweeper will retry automatically as the window resets.';
  }
  if (t.includes('overloaded') || t.includes('529')) {
    return "Anthropic is overloaded — retrying automatically.";
  }
  if (t.includes('authentication') || t.includes('invalid x-api-key')) {
    return 'Anthropic API key rejected — check ANTHROPIC_API_KEY in the deploy.';
  }
  if (t.includes('permission')) {
    return 'Anthropic API key lacks permission for this model — check console access.';
  }
  return raw.slice(0, 300);
}

// -----------------------------------------------------------------
// Haiku classification
// -----------------------------------------------------------------

const CLASSIFICATION_VALUES: ReplyClassification[] = [
  ReplyClassification.INTERESTED,
  ReplyClassification.QUESTION,
  ReplyClassification.OBJECTION,
  ReplyClassification.NOT_INTERESTED,
  ReplyClassification.OUT_OF_OFFICE,
  ReplyClassification.BOUNCE,
  ReplyClassification.OTHER,
];

async function classifyReply(
  client: Anthropic,
  args: { goal: string; replyText: string },
): Promise<{ classification: ReplyClassification; costCents: number }> {
  const prompt = [
    'Classify this email reply into ONE of the categories below.',
    'Reply with just the category name in ALL CAPS, no other text.',
    '',
    'Categories:',
    '- INTERESTED: positive, wants to engage',
    '- QUESTION: asking something specific',
    '- OBJECTION: has concerns / pushing back',
    '- NOT_INTERESTED: clear rejection',
    '- OUT_OF_OFFICE: auto-reply / vacation',
    '- BOUNCE: delivery failure',
    '- OTHER: unclear / unrelated',
    '',
    `Outbound agent goal: ${args.goal}`,
    '',
    'REPLY:',
    args.replyText.slice(0, 4000),
  ].join('\n');
  try {
    const res = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: MAX_TOKENS_CLASSIFY,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content as { type: string; text?: string }[])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join('')
      .trim()
      .toUpperCase();
    const match = CLASSIFICATION_VALUES.find((v) => text.includes(v));
    // Haiku is cheap — rough $0.001 per call at this token count.
    const costCents = Math.max(
      1,
      Math.round(
        ((res.usage.input_tokens / 1_000_000) * 0.8 +
          (res.usage.output_tokens / 1_000_000) * 4.0) *
          100,
      ),
    );
    return { classification: match ?? ReplyClassification.OTHER, costCents };
  } catch (err) {
    console.error('[email-agent] Haiku classification failed', err);
    return { classification: ReplyClassification.OTHER, costCents: 0 };
  }
}

/**
 * Phase 9 — detect "contact me in N days / after next week / next
 * month" style asks. Two-stage:
 *
 *  1. Cheap regex first — catches the majority ("get back to me in
 *     2 weeks", "reach out after 15 Jan", "not before next month").
 *     Zero API cost.
 *
 *  2. Haiku fallback only when the regex misses BUT the reply looks
 *     conversational (>20 chars, not obviously OOO / bounce). Emits
 *     a single JSON blob with days count so the caller can auto-cool
 *     without a second parse.
 *
 * Returns null when no delay is asked for.
 */
async function detectDelayRequest(
  client: Anthropic | null,
  replyText: string,
): Promise<{ days: number; source: 'regex' | 'haiku'; costCents: number } | null> {
  const t = replyText.toLowerCase().slice(0, 4000);

  // -- Stage 1: regex ------------------------------------------------
  // Explicit N days/weeks/months.
  const explicit = t.match(
    /(?:contact|reach out|get back|reply|follow[- ]?up|check in|circle back)[^.]{0,40}?(?:in|after)\s+(\d{1,3})\s+(day|days|week|weeks|month|months)/,
  );
  if (explicit) {
    const n = Number.parseInt(explicit[1] ?? '0', 10);
    const unit = explicit[2] ?? 'days';
    if (n > 0) {
      const days =
        unit.startsWith('month') ? n * 30 : unit.startsWith('week') ? n * 7 : n;
      return { days: Math.min(days, 365), source: 'regex', costCents: 0 };
    }
  }
  // Phrases: "next week", "next month", "after N days", "in 2 weeks".
  if (/(after|in)\s+(a\s+)?(week|month)/.test(t)) {
    return { days: /month/.test(t) ? 30 : 7, source: 'regex', costCents: 0 };
  }
  if (/next\s+(week|month|quarter)/.test(t)) {
    const days = /month/.test(t) ? 30 : /quarter/.test(t) ? 90 : 7;
    return { days, source: 'regex', costCents: 0 };
  }
  // "not now, later / not right now" — treat as 30-day soft hold.
  if (/(not\s+(now|right now|at the moment)|busy right now|check back|later)/.test(t)) {
    // Be conservative — only if the reply is short and doesn't sound
    // like a rejection.
    if (t.length < 300 && !/never|remove/.test(t)) {
      return { days: 30, source: 'regex', costCents: 0 };
    }
  }

  // -- Stage 2: Haiku fallback --------------------------------------
  if (!client) return null;
  if (replyText.trim().length < 20) return null;
  try {
    const prompt = [
      'Read this email reply. If the sender asks to be contacted again after a specific delay (days/weeks/months), respond with JSON like {"delay_days": N}. If no specific delay is requested, respond with {"delay_days": 0}. Respond with ONLY the JSON, no other text.',
      '',
      'REPLY:',
      replyText.slice(0, 2000),
    ].join('\n');
    const res = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content as { type: string; text?: string }[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    const m = text.match(/"delay_days"\s*:\s*(\d{1,3})/);
    // Haiku is cheap — bill the call even if the answer was 0 days.
    const costCents = Math.max(
      1,
      Math.round(
        ((res.usage.input_tokens / 1_000_000) * 0.8 +
          (res.usage.output_tokens / 1_000_000) * 4.0) *
          100,
      ),
    );
    if (!m) return null;
    const days = Number.parseInt(m[1] ?? '0', 10);
    if (days > 0)
      return { days: Math.min(days, 365), source: 'haiku', costCents };
  } catch (err) {
    console.warn('[email-agent] delay-request Haiku call failed', err);
  }
  return null;
}

// -----------------------------------------------------------------
// Cooling-wake — Phase 9
// -----------------------------------------------------------------

/**
 * Every 5 minutes: find enrollments cooling with cooldownUntil elapsed
 * and flip them back to ACTIVE_CONVERSATION so the follow-up sequence
 * resumes at the next follow-up tick.
 */
export async function handleEmailAgentCoolingWake(): Promise<void> {
  const now = new Date();
  const due = await prisma.emailAgentEnrollment.findMany({
    where: {
      conversationStatus: 'COOLING_PERIOD',
      cooldownUntil: { lte: now },
      status: EnrollmentStatus.ACTIVE,
    },
    select: { id: true },
    take: 500,
  });
  if (due.length === 0) return;
  await prisma.emailAgentEnrollment.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: {
      conversationStatus: 'ACTIVE_CONVERSATION',
      cooldownUntil: null,
      nextActionAt: now,
    },
  });
  console.info(
    `[email-agent:cooling-wake] resumed ${due.length} enrollments`,
  );
}

// -----------------------------------------------------------------
// Send + persist outbound
// -----------------------------------------------------------------

async function sendAndPersistOutbound(
  ctx: EnrollmentContext,
  draft: Draft,
  status: EmailAgentMessageStatus,
  opts: { step: number },
): Promise<void> {
  if (!ctx.contact.email) return;

  const finalBodyText = draft.bodyText + (ctx.emailAgent.signature ? `\n\n${ctx.emailAgent.signature}` : '');
  const finalBodyHtml = textToHtml(finalBodyText);

  // Phase 9 — short-token routing under RFC 5321's 64-char local-part
  // cap. Per-agent replyInboundDomain lets brands own the reply
  // subdomain (e.g. reply.skillcertified.com) so customers see an
  // on-brand address in their mail client. Fallback to global env.
  const { createReplyRoute } = await import('../utils/reply-route');
  const inboundDomain =
    (ctx.emailAgent as { replyInboundDomain?: string | null })
      .replyInboundDomain ||
    process.env.REPLY_INBOUND_DOMAIN ||
    null;
  const rawReplyTo = await createReplyRoute(
    { kind: 'a', targetId: ctx.id, tenantId: ctx.tenantId },
    { inboundDomain },
  );
  // Wrap the address in the display name so Gmail/Outlook show the
  // brand instead of the raw `reply+xxx@…` address.
  const replyDisplayName =
    (ctx.emailAgent as { replyToDisplayName?: string | null })
      .replyToDisplayName ||
    ctx.emailAgent.fromName ||
    null;
  const replyTo =
    rawReplyTo && replyDisplayName
      ? `${replyDisplayName} <${rawReplyTo}>`
      : rawReplyTo;

  let messageId: string | null = null;
  if (resend) {
    try {
      const { claimSendSlot } = await import('../utils/send-rate-limit');
      await claimSendSlot();
      // Phase 9 — one-shot CC set by an operator on the Review
      // Response suggest-a-reply form. Split, trim, dedupe against
      // the primary recipient; cleared below alongside the hint.
      // Multiple CC addresses supported: comma-separated in the
      // suggested-reply form → split, trim, drop empties, dedupe
      // case-insensitively, and drop the primary recipient. Resend's
      // `cc` field accepts a string[].
      const seenCc = new Set<string>();
      const ccList = (ctx.suggestedReplyCc ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => {
          if (!s) return false;
          const k = s.toLowerCase();
          if (k === ctx.contact.email!.toLowerCase()) return false;
          if (seenCc.has(k)) return false;
          seenCc.add(k);
          return true;
        });
      const result = await resend.emails.send({
        from: `${ctx.emailAgent.fromName} <${ctx.emailAgent.fromEmail}>`,
        to: ctx.contact.email,
        ...(ccList.length ? { cc: ccList } : {}),
        subject: draft.subject,
        html: finalBodyHtml,
        text: finalBodyText,
        replyTo: replyTo ?? undefined,
        headers: {
          'X-Getyn-EmailAgent-Id': ctx.emailAgent.id,
          'X-Getyn-Enrollment-Id': ctx.id,
        },
      });
      messageId = result.data?.id ?? null;
    } catch (err) {
      console.error('[email-agent] send failed', err);
      Sentry.captureException(err, { tags: { handler: 'email-agent-send' } });
    }
  }

  await prisma.$transaction([
    prisma.emailAgentMessage.create({
      data: {
        tenantId: ctx.tenantId,
        enrollmentId: ctx.id,
        direction: EmailAgentMessageDirection.OUTBOUND,
        subject: draft.subject,
        bodyHtml: finalBodyHtml,
        bodyText: finalBodyText,
        status: messageId ? EmailAgentMessageStatus.SENT : status,
        messageId,
        sentAt: messageId ? new Date() : null,
        aiGenerationContext: draft.context as unknown as object,
        aiGenerationCostCents: draft.costCents,
      },
    }),
    prisma.emailAgentEnrollment.update({
      where: { id: ctx.id },
      data: {
        currentStep: opts.step,
        lastSentAt: new Date(),
        // Phase 9 — a hint is one-shot: consumed by this send, cleared
        // so it can't leak into future follow-ups.
        ...(ctx.suggestedReplyHint ? { suggestedReplyHint: null } : {}),
        ...(ctx.suggestedReplyCc ? { suggestedReplyCc: null } : {}),
      },
    }),
  ]);
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

async function exitEnrollment(enrollmentId: string, reason: string): Promise<void> {
  await prisma.emailAgentEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: EnrollmentStatus.EXITED,
      exitReason: reason,
      completedAt: new Date(),
      nextActionAt: null,
    },
  });
}

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

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Sonnet occasionally wraps JSON in prose or backticks. Peel the
 * outermost braces and parse.
 */
function extractJson(text: string): { subject?: unknown; body?: unknown } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
