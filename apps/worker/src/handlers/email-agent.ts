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
const FOLLOWUP_BATCH_SIZE = 25;

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
  const { enrollmentId } = job.data;
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
  if (enrollment.emailAgent.status !== 'ACTIVE') return;

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
      emailAgent: { status: 'ACTIVE' },
    },
    select: { id: true },
    orderBy: [{ nextActionAt: 'asc' }, { id: 'asc' }],
    take: FOLLOWUP_BATCH_SIZE,
  });
  if (due.length === 0) return;
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
  await prisma.emailAgentMessage.create({
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
  });

  await prisma.emailAgentEnrollment.update({
    where: { id: enrollmentId },
    data: { lastInboundAt: new Date() },
  });

  const client = await anthropic();
  if (!client) return;

  // Classify with Haiku.
  const classification = await classifyReply(client, {
    goal: enrollment.emailAgent.goal,
    replyText: inbound.bodyText || stripHtml(inbound.bodyHtml),
  });
  const classified = classification.classification;

  // Route by classification.
  if (classified === ReplyClassification.OUT_OF_OFFICE || classified === ReplyClassification.BOUNCE) {
    // Don't draft; keep the follow-up sequence going.
    console.info(`[email-agent:reply] ${enrollmentId} classified ${classified}; continuing`);
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
    return;
  }

  // Draft a reply with Sonnet.
  const history = await loadThreadHistory(enrollmentId);
  const draft = await draftReply(client, enrollment, {
    inboundSubject: inbound.subject,
    inboundBody: inbound.bodyText || stripHtml(inbound.bodyHtml),
    history,
  });
  if (!draft) return;

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
        aiGenerationCostCents: draft.costCents,
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
  const prompt = buildPrompt(ctx, {
    kind: 'initial',
    task: 'Write the first outreach email to this contact based on the agent goal + knowledge below. Keep it under 150 words, personalized to what we know about them, direct, and end with a single specific ask.',
  });
  return callSonnet(client, prompt, 'initial');
}

async function draftFollowUp(
  client: Anthropic,
  ctx: EnrollmentContext,
  args: { stepNumber: number; history: ThreadMessage[] },
): Promise<Draft | null> {
  const prompt = buildPrompt(ctx, {
    kind: 'followup',
    task: `Write follow-up #${args.stepNumber}. Reference the previous ${args.history.length} message(s) in the thread. Keep it short, add new value (not just a bump), and change the ask if the earlier one didn't land.`,
    history: args.history,
  });
  return callSonnet(client, prompt, 'followup');
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
  const prompt = buildPrompt(ctx, {
    kind: 'reply',
    task: `The contact replied. Draft a response that engages with what they actually said. Use the knowledge sources when they asked about product/pricing/etc. Keep it conversational and match their length.`,
    history: [
      ...args.history,
      { direction: 'INBOUND', subject: args.inboundSubject, body: args.inboundBody },
    ],
  });
  return callSonnet(client, prompt, 'reply');
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

function buildPrompt(
  ctx: EnrollmentContext,
  args: {
    kind: 'initial' | 'followup' | 'reply';
    task: string;
    history?: ThreadMessage[];
  },
): string {
  const knowledge = ctx.emailAgent.knowledgeSources
    .filter((s) => s.summary && !s.summary.startsWith('(URL — extracting'))
    .map((s, i) => `[${i + 1}] ${s.rawTitle}${s.sourceUrl ? ` (${s.sourceUrl})` : ''}\n${s.summary}`)
    .join('\n\n');
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
    `You are an outbound email agent for ${ctx.tenant.companyDisplayName ?? ctx.tenant.name}.`,
    `Tone: ${ctx.emailAgent.tone.toLowerCase()}.`,
    ``,
    `AGENT GOAL:\n${ctx.emailAgent.goal}`,
    ``,
    `INSTRUCTIONS FROM OPERATOR:\n${ctx.emailAgent.systemInstructions || '(none)'}`,
    ``,
    knowledge ? `KNOWLEDGE BASE (use as needed):\n${knowledge}` : '',
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

async function callSonnet(
  client: Anthropic,
  prompt: string,
  kind: 'initial' | 'followup' | 'reply',
): Promise<Draft | null> {
  try {
    const res = await client.messages.create({
      model: DRAFTING_MODEL,
      max_tokens: MAX_TOKENS_DRAFT,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content as { type: string; text?: string }[])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join('');
    const parsed = extractJson(text);
    if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
      Sentry.captureMessage('[email-agent] Sonnet output not parseable', {
        level: 'warning',
        extra: { text: text.slice(0, 500) },
      });
      return null;
    }
    const usage = res.usage;
    const costCents = Math.round(
      ((usage.input_tokens / 1_000_000) * 3.0 +
        (usage.output_tokens / 1_000_000) * 15.0) *
        100,
    );
    // Hard per-call cap: $0.30 per draft. If a single Sonnet call
    // somehow exceeds this, log loudly — indicates a runaway prompt.
    if (costCents > 30) {
      Sentry.captureMessage('[email-agent] draft exceeded $0.30 cap', {
        level: 'warning',
        extra: { costCents, kind, tokens: usage },
      });
    }
    const subject = parsed.subject.trim();
    const bodyText = parsed.body.trim();
    return {
      subject,
      bodyText,
      bodyHtml: textToHtml(bodyText),
      costCents,
      context: {
        prompt,
        knowledgeSourceCount: 0, // set by callsite when useful
        model: DRAFTING_MODEL,
        kind,
      },
    };
  } catch (err) {
    console.error('[email-agent] Sonnet call failed', err);
    Sentry.captureException(err, { tags: { handler: 'email-agent-draft' } });
    return null;
  }
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

  const replyTo = buildReplyToAddress(
    'a',
    { id: ctx.id, tenantId: ctx.tenantId },
    {
      secret: process.env.REPLY_ROUTING_SECRET ?? null,
      inboundDomain: process.env.REPLY_INBOUND_DOMAIN ?? null,
    },
  );

  let messageId: string | null = null;
  if (resend) {
    try {
      const result = await resend.emails.send({
        from: `${ctx.emailAgent.fromName} <${ctx.emailAgent.fromEmail}>`,
        to: ctx.contact.email,
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
