/* eslint-disable no-console */
/**
 * WhatsApp Agent execution engine — mirror of email-agent.ts.
 *
 *   whatsapp-agent-enroll (per-enrollment): send the initial approved
 *     template (Meta requires a template for the first outbound outside
 *     the 24h session window).
 *   whatsapp-agent-followup-tick (repeatable, 60s): scan ACTIVE
 *     enrollments due for a follow-up. Follow-ups go out as free-form
 *     text ONLY if within the 24h service window — otherwise skip +
 *     reschedule.
 *   whatsapp-agent-process-reply (per-inbound): classify + draft reply
 *     for an inbound WhatsAppMessage that matches an enrollment.
 *   whatsapp-agent-cooling-wake (repeatable, 5m): wake cards whose
 *     cooldownUntil has elapsed.
 */
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
import { decrypt, type EncryptedField } from '@getyn/crypto';
import { sendTemplateMessage, sendTextMessage } from '@getyn/whatsapp';
import type {
  WhatsappAgentEnrollPayload,
  WhatsappAgentProcessReplyPayload,
} from '@getyn/types';

import { getAnthropicApiKey } from '../integrations/anthropic';

// Same model IDs as email-agent.ts.
const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';
const DRAFTING_MODEL = 'claude-sonnet-4-6';

const MAX_TOKENS_DRAFT = 800;
const MAX_TOKENS_CLASSIFY = 60;

const FOLLOWUP_BATCH_SIZE = 25;
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function anthropic(): Promise<Anthropic | null> {
  const key = await getAnthropicApiKey();
  if (!key) return null;
  return getAnthropicClient(key);
}

// -----------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------

export async function handleWhatsAppAgentEnroll(
  job: Job<WhatsappAgentEnrollPayload>,
): Promise<void> {
  const { enrollmentId, isTest } = job.data;
  const enrollment = await loadEnrollment(enrollmentId);
  if (!enrollment) return;

  const existing = await prisma.whatsAppAgentMessage.findFirst({
    where: {
      enrollmentId,
      direction: EmailAgentMessageDirection.OUTBOUND,
    },
    select: { id: true },
  });
  if (existing) {
    console.info(`[wa-agent:enroll] ${enrollmentId} already has outbound; skipping`);
    return;
  }

  if (enrollment.status !== EnrollmentStatus.ACTIVE) return;
  if (!isTest && enrollment.whatsappAgent.status !== 'ACTIVE') return;

  if (!enrollment.contact.phone) {
    await exitEnrollment(enrollmentId, 'no_phone');
    return;
  }
  if (enrollment.contact.whatsappStatus !== 'SUBSCRIBED') {
    await exitEnrollment(
      enrollmentId,
      `channel_${enrollment.contact.whatsappStatus.toLowerCase()}`,
    );
    return;
  }

  const template = enrollment.whatsappAgent.initialTemplate;
  if (!template) {
    console.warn(`[wa-agent:enroll] ${enrollmentId} has no initial template`);
    await exitEnrollment(enrollmentId, 'no_initial_template');
    return;
  }
  if (template.status !== 'APPROVED') {
    console.warn(`[wa-agent:enroll] initial template not APPROVED (${template.status})`);
    return;
  }

  const phone = enrollment.whatsappAgent.phoneNumber;
  const accessToken = decrypt(
    phone.whatsAppAccount.accessTokenEncrypted as unknown as EncryptedField,
    enrollment.tenantId,
  );

  let metaMessageId: string | null = null;
  try {
    const resp = await sendTemplateMessage(phone.phoneNumberId, accessToken, {
      to: enrollment.contact.phone,
      templateName: template.name,
      templateLanguage: template.language,
      bodyParams: [],
    });
    metaMessageId = resp.messages[0]?.id ?? null;
  } catch (err) {
    console.error('[wa-agent:enroll] send failed', err);
    Sentry.captureException(err, { tags: { handler: 'wa-agent-enroll' } });
    return;
  }

  const now = new Date();
  const bodyPreview = renderTemplatePreview(template);
  await prisma.$transaction([
    prisma.whatsAppAgentMessage.create({
      data: {
        tenantId: enrollment.tenantId,
        enrollmentId,
        direction: EmailAgentMessageDirection.OUTBOUND,
        status: EmailAgentMessageStatus.SENT,
        bodyText: bodyPreview,
        messageId: metaMessageId,
        sentAt: now,
      },
    }),
    prisma.whatsAppAgentEnrollment.update({
      where: { id: enrollmentId },
      data: { currentStep: 0, lastSentAt: now },
    }),
  ]);
  await scheduleNextFollowUp(enrollmentId, 0);
}

export async function handleWhatsAppAgentFollowUpTick(): Promise<void> {
  const now = new Date();
  const due = await prisma.whatsAppAgentEnrollment.findMany({
    where: {
      status: EnrollmentStatus.ACTIVE,
      nextActionAt: { lte: now },
      whatsappAgent: { status: 'ACTIVE' },
    },
    select: { id: true },
    orderBy: [{ nextActionAt: 'asc' }, { id: 'asc' }],
    take: FOLLOWUP_BATCH_SIZE,
  });
  if (due.length === 0) return;
  console.info(`[wa-agent:followup] processing ${due.length}`);
  for (const row of due) {
    try {
      await processFollowUp(row.id);
    } catch (err) {
      console.error(`[wa-agent:followup] ${row.id} failed`, err);
      Sentry.captureException(err, { tags: { handler: 'wa-agent-followup' } });
    }
  }
}

export async function handleWhatsAppAgentProcessReply(
  job: Job<WhatsappAgentProcessReplyPayload>,
): Promise<void> {
  const { enrollmentId, bodyText, waMessageId } = job.data;
  const enrollment = await loadEnrollment(enrollmentId);
  if (!enrollment) return;

  // Persist the inbound as an agent message row.
  await prisma.whatsAppAgentMessage.create({
    data: {
      tenantId: enrollment.tenantId,
      enrollmentId,
      direction: EmailAgentMessageDirection.INBOUND,
      status: EmailAgentMessageStatus.REPLIED,
      bodyText,
      messageId: `inbound_${waMessageId}`,
    },
  });

  // Stop-keyword hard match.
  const stopWords = (enrollment.whatsappAgent.stopKeywords ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const replyLower = bodyText.toLowerCase();
  const matchedStop = stopWords.find((kw) => kw && replyLower.includes(kw));

  if (matchedStop) {
    await prisma.whatsAppAgentEnrollment.update({
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
    console.info(`[wa-agent:reply] ${enrollmentId} stop-keyword "${matchedStop}" → INACTIVE`);
    return;
  }

  const client = await anthropic();

  // Delay-request detection (regex first, Haiku fallback).
  const delay = await detectDelayRequest(client, bodyText);
  if (delay) {
    const until = new Date(Date.now() + delay.days * 24 * 60 * 60 * 1000);
    await prisma.whatsAppAgentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        lastInboundAt: new Date(),
        conversationStatus: 'COOLING_PERIOD',
        cooldownUntil: until,
        nextActionAt: null,
      },
    });
    console.info(
      `[wa-agent:reply] ${enrollmentId} delay ${delay.days}d (${delay.source}) → COOLING_PERIOD`,
    );
    return;
  }

  await prisma.whatsAppAgentEnrollment.update({
    where: { id: enrollmentId },
    data: { lastInboundAt: new Date(), conversationStatus: 'REVIEW_RESPONSE' },
  });

  if (!client) return;

  const classification = await classifyReply(client, {
    goal: enrollment.whatsappAgent.goal,
    replyText: bodyText,
  });
  const classified = classification.classification;
  if (
    classified === ReplyClassification.OUT_OF_OFFICE ||
    classified === ReplyClassification.BOUNCE
  ) {
    console.info(`[wa-agent:reply] ${enrollmentId} classified ${classified}; continuing`);
    return;
  }
  if (classified === ReplyClassification.NOT_INTERESTED) {
    await prisma.whatsAppAgentEnrollment.update({
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

  // Draft a reply with Sonnet; land it as DRAFT_AWAITING_APPROVAL.
  const history = await loadThreadHistory(enrollmentId);
  const draft = await draftReply(client, enrollment, { inboundBody: bodyText, history });
  if (!draft) return;

  await prisma.$transaction([
    prisma.whatsAppAgentMessage.create({
      data: {
        tenantId: enrollment.tenantId,
        enrollmentId,
        direction: EmailAgentMessageDirection.OUTBOUND,
        status: EmailAgentMessageStatus.DRAFT_AWAITING_APPROVAL,
        bodyText: draft.bodyText,
        aiGenerationContext: draft.context as unknown as object,
        aiGenerationCostCents: draft.costCents,
      },
    }),
    prisma.whatsAppAgentEnrollment.update({
      where: { id: enrollmentId },
      data: { status: EnrollmentStatus.PAUSED_AWAITING_APPROVAL, nextActionAt: null },
    }),
  ]);
}

export async function handleWhatsAppAgentCoolingWake(): Promise<void> {
  const now = new Date();
  const due = await prisma.whatsAppAgentEnrollment.findMany({
    where: {
      conversationStatus: 'COOLING_PERIOD',
      cooldownUntil: { lte: now },
      status: EnrollmentStatus.ACTIVE,
    },
    select: { id: true },
    take: 500,
  });
  if (due.length === 0) return;
  await prisma.whatsAppAgentEnrollment.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: {
      conversationStatus: 'ACTIVE_CONVERSATION',
      cooldownUntil: null,
      nextActionAt: now,
    },
  });
  console.info(`[wa-agent:cooling-wake] resumed ${due.length}`);
}

// -----------------------------------------------------------------
// Follow-up processing (atomic claim + free-form text send)
// -----------------------------------------------------------------

async function processFollowUp(enrollmentId: string): Promise<void> {
  const now = new Date();
  // Atomic reservation — prevents dupe sends when the tick fires again
  // during a slow Sonnet call.
  const claim = await prisma.whatsAppAgentEnrollment.updateMany({
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

  const schedule = enrollment.whatsappAgent.outboundSchedule as {
    followUpDays: number[];
    maxFollowUps: number;
  };

  if (enrollment.currentStep >= schedule.maxFollowUps) {
    await prisma.whatsAppAgentEnrollment.update({
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

  // 24h service window check — free-form text is only allowed inside it.
  const withinWindow =
    enrollment.lastInboundAt &&
    Date.now() - enrollment.lastInboundAt.getTime() < SERVICE_WINDOW_MS;
  if (!withinWindow) {
    // No inbound to open the window → skip this follow-up, retry later.
    console.info(
      `[wa-agent:followup] ${enrollmentId} outside 24h window; skipping (no template fallback configured)`,
    );
    await scheduleNextFollowUp(enrollmentId, enrollment.currentStep);
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

  if (!enrollment.contact.phone) return;
  const phone = enrollment.whatsappAgent.phoneNumber;
  const accessToken = decrypt(
    phone.whatsAppAccount.accessTokenEncrypted as unknown as EncryptedField,
    enrollment.tenantId,
  );

  let metaMessageId: string | null = null;
  try {
    const resp = await sendTextMessage(phone.phoneNumberId, accessToken, {
      to: enrollment.contact.phone,
      text: draft.bodyText + (enrollment.whatsappAgent.signature ? `\n\n${enrollment.whatsappAgent.signature}` : ''),
    });
    metaMessageId = resp.messages[0]?.id ?? null;
  } catch (err) {
    console.error('[wa-agent:followup] send failed', err);
    Sentry.captureException(err, { tags: { handler: 'wa-agent-followup' } });
    return;
  }

  const now2 = new Date();
  await prisma.$transaction([
    prisma.whatsAppAgentMessage.create({
      data: {
        tenantId: enrollment.tenantId,
        enrollmentId,
        direction: EmailAgentMessageDirection.OUTBOUND,
        status: EmailAgentMessageStatus.SENT,
        bodyText: draft.bodyText,
        messageId: metaMessageId,
        sentAt: now2,
        aiGenerationContext: draft.context as unknown as object,
        aiGenerationCostCents: draft.costCents,
      },
    }),
    prisma.whatsAppAgentEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStep: nextStep,
        lastSentAt: now2,
        ...(enrollment.suggestedReplyHint ? { suggestedReplyHint: null } : {}),
      },
    }),
  ]);
  await scheduleNextFollowUp(enrollmentId, nextStep);
}

async function scheduleNextFollowUp(enrollmentId: string, currentStep: number): Promise<void> {
  const row = await prisma.whatsAppAgentEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { whatsappAgent: { select: { outboundSchedule: true } } },
  });
  if (!row) return;
  const schedule = row.whatsappAgent.outboundSchedule as {
    followUpDays: number[];
    maxFollowUps: number;
  };
  const nextStep = currentStep + 1;
  if (nextStep > schedule.maxFollowUps) {
    await prisma.whatsAppAgentEnrollment.update({
      where: { id: enrollmentId },
      data: { currentStep, nextActionAt: null },
    });
    return;
  }
  const dayOffset = schedule.followUpDays[nextStep - 1];
  if (dayOffset === undefined) {
    await prisma.whatsAppAgentEnrollment.update({
      where: { id: enrollmentId },
      data: { currentStep, nextActionAt: null },
    });
    return;
  }
  const nextAt = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  await prisma.whatsAppAgentEnrollment.update({
    where: { id: enrollmentId },
    data: { currentStep, nextActionAt: nextAt },
  });
}

// -----------------------------------------------------------------
// Enrollment fetch
// -----------------------------------------------------------------

async function loadEnrollment(enrollmentId: string): Promise<EnrollmentContext | null> {
  const row = await prisma.whatsAppAgentEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      whatsappAgent: {
        include: {
          phoneNumber: { include: { whatsAppAccount: true } },
          initialTemplate: true,
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
          whatsappStatus: true,
        },
      },
      tenant: { select: { id: true, name: true, companyDisplayName: true } },
    },
  });
  if (!row) return null;
  return row as unknown as EnrollmentContext;
}

interface EnrollmentContext {
  id: string;
  tenantId: string;
  whatsappAgentId: string;
  status: EnrollmentStatus;
  conversationStatus: string;
  suggestedReplyHint: string | null;
  currentStep: number;
  lastSentAt: Date | null;
  lastInboundAt: Date | null;
  whatsappAgent: {
    id: string;
    name: string;
    status: string;
    persona: string;
    goal: string;
    signature: string | null;
    outboundSchedule: unknown;
    stopKeywords: string;
    coolingPeriodDays: number;
    knowledgeUrls: string[];
    phoneNumber: {
      id: string;
      phoneNumberId: string;
      phoneNumber: string;
      whatsAppAccount: { accessTokenEncrypted: unknown };
    };
    initialTemplate: {
      id: string;
      name: string;
      language: string;
      status: string;
      components: unknown;
    } | null;
  };
  contact: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    customFields: Record<string, unknown>;
    whatsappStatus: string;
  };
  tenant: { id: string; name: string; companyDisplayName: string | null };
}

// -----------------------------------------------------------------
// LLM drafting
// -----------------------------------------------------------------

interface Draft {
  bodyText: string;
  costCents: number;
  context: {
    prompt: string;
    knowledgeSourceCount: number;
    model: string;
    kind: 'followup' | 'reply';
  };
}

interface ThreadMessage {
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
}

async function loadThreadHistory(enrollmentId: string): Promise<ThreadMessage[]> {
  const rows = await prisma.whatsAppAgentMessage.findMany({
    where: { enrollmentId },
    orderBy: { createdAt: 'asc' },
    select: { direction: true, bodyText: true },
    take: 20,
  });
  return rows.map((r) => ({
    direction: r.direction as 'INBOUND' | 'OUTBOUND',
    body: r.bodyText,
  }));
}

function buildPrompt(
  ctx: EnrollmentContext,
  args: { kind: 'followup' | 'reply'; task: string; history?: ThreadMessage[] },
): string {
  const knowledge = ctx.whatsappAgent.knowledgeUrls.length
    ? `KNOWLEDGE URLS (reference for facts):\n${ctx.whatsappAgent.knowledgeUrls.map((u, i) => `[${i + 1}] ${u}`).join('\n')}`
    : '';
  const contactBits = [
    ctx.contact.firstName && `First name: ${ctx.contact.firstName}`,
    ctx.contact.lastName && `Last name: ${ctx.contact.lastName}`,
    ctx.contact.phone && `Phone: ${ctx.contact.phone}`,
    ...Object.entries(ctx.contact.customFields)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${String(v)}`),
  ]
    .filter(Boolean)
    .join('\n');
  const history = (args.history ?? [])
    .map((m) => `[${m.direction}] ${m.body}`)
    .join('\n\n---\n\n');
  return [
    `You are an outbound WhatsApp agent for ${ctx.tenant.companyDisplayName ?? ctx.tenant.name}.`,
    `Persona: ${ctx.whatsappAgent.persona}`,
    ``,
    `AGENT GOAL:\n${ctx.whatsappAgent.goal}`,
    ``,
    ctx.suggestedReplyHint
      ? `URGENT REPLY HINT FROM OPERATOR — include this in the next message:\n"${ctx.suggestedReplyHint}"`
      : '',
    ``,
    knowledge,
    ``,
    `CONTACT:\n${contactBits || '(no profile data)'}`,
    ``,
    history ? `THREAD SO FAR:\n${history}` : '',
    ``,
    `TASK: ${args.task}`,
    ``,
    `Return ONLY the message body as plain text — no JSON, no quotes, no sign-off (the signature is appended by the send pipeline). Keep it under 400 characters, conversational, appropriate for WhatsApp.`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function draftFollowUp(
  client: Anthropic,
  ctx: EnrollmentContext,
  args: { stepNumber: number; history: ThreadMessage[] },
): Promise<Draft | null> {
  const prompt = buildPrompt(ctx, {
    kind: 'followup',
    task: `Write follow-up #${args.stepNumber}. Reference the prior ${args.history.length} message(s), add new value (not just a bump), change the ask if the earlier one didn't land.`,
    history: args.history,
  });
  return callSonnet(client, prompt, 'followup');
}

async function draftReply(
  client: Anthropic,
  ctx: EnrollmentContext,
  args: { inboundBody: string; history: ThreadMessage[] },
): Promise<Draft | null> {
  const prompt = buildPrompt(ctx, {
    kind: 'reply',
    task: `The contact replied. Draft a response that engages with what they actually said. Keep it conversational and match their length.`,
    history: [...args.history, { direction: 'INBOUND', body: args.inboundBody }],
  });
  return callSonnet(client, prompt, 'reply');
}

async function callSonnet(
  client: Anthropic,
  prompt: string,
  kind: 'followup' | 'reply',
): Promise<Draft | null> {
  try {
    const res = await client.messages.create({
      model: DRAFTING_MODEL,
      max_tokens: MAX_TOKENS_DRAFT,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content as { type: string; text?: string }[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    if (!text) return null;
    const usage = res.usage;
    const costCents = Math.round(
      ((usage.input_tokens / 1_000_000) * 3.0 +
        (usage.output_tokens / 1_000_000) * 15.0) *
        100,
    );
    return {
      bodyText: text,
      costCents,
      context: { prompt, knowledgeSourceCount: 0, model: DRAFTING_MODEL, kind },
    };
  } catch (err) {
    console.error('[wa-agent] Sonnet call failed', err);
    Sentry.captureException(err, { tags: { handler: 'wa-agent-draft' } });
    return null;
  }
}

// -----------------------------------------------------------------
// Reply classification
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
    'Classify this WhatsApp reply into ONE of the categories below.',
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
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim()
      .toUpperCase();
    const match = CLASSIFICATION_VALUES.find((v) => text.includes(v));
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
    console.error('[wa-agent] Haiku classification failed', err);
    return { classification: ReplyClassification.OTHER, costCents: 0 };
  }
}

async function detectDelayRequest(
  client: Anthropic | null,
  replyText: string,
): Promise<{ days: number; source: 'regex' | 'haiku' } | null> {
  const t = replyText.toLowerCase().slice(0, 4000);
  const explicit = t.match(
    /(?:contact|reach out|get back|reply|follow[- ]?up|check in|circle back|message)[^.]{0,40}?(?:in|after)\s+(\d{1,3})\s+(day|days|week|weeks|month|months)/,
  );
  if (explicit) {
    const n = Number.parseInt(explicit[1] ?? '0', 10);
    const unit = explicit[2] ?? 'days';
    if (n > 0) {
      const days = unit.startsWith('month') ? n * 30 : unit.startsWith('week') ? n * 7 : n;
      return { days: Math.min(days, 365), source: 'regex' };
    }
  }
  if (/(after|in)\s+(a\s+)?(week|month)/.test(t)) {
    return { days: /month/.test(t) ? 30 : 7, source: 'regex' };
  }
  if (/next\s+(week|month|quarter)/.test(t)) {
    const days = /month/.test(t) ? 30 : /quarter/.test(t) ? 90 : 7;
    return { days, source: 'regex' };
  }
  if (/(not\s+(now|right now|at the moment)|busy right now|check back|later)/.test(t)) {
    if (t.length < 300 && !/never|remove/.test(t)) {
      return { days: 30, source: 'regex' };
    }
  }
  if (!client) return null;
  if (replyText.trim().length < 20) return null;
  try {
    const prompt = [
      'Read this WhatsApp reply. If the sender asks to be contacted again after a specific delay (days/weeks/months), respond with JSON like {"delay_days": N}. If no specific delay is requested, respond with {"delay_days": 0}. Respond with ONLY the JSON.',
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
    if (!m) return null;
    const days = Number.parseInt(m[1] ?? '0', 10);
    if (days > 0) return { days: Math.min(days, 365), source: 'haiku' };
  } catch (err) {
    console.warn('[wa-agent] delay-request Haiku failed', err);
  }
  return null;
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

async function exitEnrollment(enrollmentId: string, reason: string): Promise<void> {
  await prisma.whatsAppAgentEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: EnrollmentStatus.EXITED,
      exitReason: reason,
      completedAt: new Date(),
      nextActionAt: null,
    },
  });
}

/** Best-effort plaintext preview of a template body for the message log. */
function renderTemplatePreview(template: {
  name: string;
  components: unknown;
}): string {
  const comps = (template.components as Array<{ type?: string; text?: string }>) ?? [];
  const body = comps.find((c) => c?.type === 'BODY' || c?.type === 'body');
  if (body?.text) return body.text;
  return `[template: ${template.name}]`;
}
