/**
 * Phase 5.5 M4 — current-period usage measurement.
 *
 * One function per metric so callers pay only for what they need.
 * The combined `getCurrentMonthUsage` driver is the tenant-side
 * dashboard path; mutation gates use the single-metric helpers.
 *
 * # Counting rules (locked in M0):
 *   - EMAILS_PER_MONTH: CampaignSend rows where status IN
 *     (SENT, DELIVERED, OPENED, CLICKED, BOUNCED, COMPLAINED).
 *     Excludes QUEUED, FAILED, SUPPRESSED — FAILED means Resend
 *     never accepted the request so we didn't consume their quota.
 *   - WA_MESSAGES_PER_MONTH: WhatsAppCampaignSend rows where status
 *     IN (SENT, DELIVERED, READ) OR (status=FAILED AND
 *     metaMessageId IS NOT NULL). The metaMessageId discriminator
 *     splits Meta-accepted-then-failed (counts) from Meta-rejected
 *     (doesn't).
 *   - SMS: 0 today (no SMS schema yet). Stub returns 0 so the
 *     gate is a no-op.
 *   - AI_CREDITS_PER_MONTH: AiGeneration rows. One credit per
 *     generation today; tokens-based ledger is a future change.
 *   - CONTACTS / CUSTOM_SENDING_DOMAINS / USER_SEATS: not period-
 *     bound. CONTACTS = contact.count; SENDING_DOMAINS =
 *     sendingDomain.count; SEATS = membership.count + non-expired
 *     pending invitation.count.
 *
 * # Calendar month UTC.
 *   Period starts at the 1st of the current month at 00:00 UTC.
 *   This is the tenant-facing reset clock; surface it on the
 *   subscription page (M5).
 */
import {
  CampaignSendStatus,
  PlanMetric,
  WASendStatus,
  prisma,
} from '@getyn/db';

export function startOfCalendarMonthUTC(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

const COUNTABLE_EMAIL_STATUSES: CampaignSendStatus[] = [
  CampaignSendStatus.SENT,
  CampaignSendStatus.DELIVERED,
  CampaignSendStatus.OPENED,
  CampaignSendStatus.CLICKED,
  CampaignSendStatus.BOUNCED,
  CampaignSendStatus.COMPLAINED,
];

const COUNTABLE_WA_OK_STATUSES: WASendStatus[] = [
  WASendStatus.SENT,
  WASendStatus.DELIVERED,
  WASendStatus.READ,
];

export async function countEmailsThisMonth(tenantId: string): Promise<number> {
  // CampaignSend has no createdAt — use sentAt (set when the row
  // transitions out of QUEUED, i.e. when Resend accepted it). Every
  // countable status has sentAt populated by definition.
  return prisma.campaignSend.count({
    where: {
      tenantId,
      status: { in: COUNTABLE_EMAIL_STATUSES },
      sentAt: { gte: startOfCalendarMonthUTC() },
    },
  });
}

export async function countWaMessagesThisMonth(
  tenantId: string,
): Promise<number> {
  const gte = startOfCalendarMonthUTC();
  // Count two slices then sum — Prisma doesn't support OR across enum
  // value + null discriminator in a single count without raw SQL.
  // Two indexed counts is fine: both hit
  // (tenantId, status, createdAt).
  // WhatsAppCampaignSend has createdAt but the truth marker for
  // "Meta consumed the request" is sentAt — set when Meta accepted.
  // Mirrors the email semantics.
  const [ok, failedWithId] = await Promise.all([
    prisma.whatsAppCampaignSend.count({
      where: {
        tenantId,
        status: { in: COUNTABLE_WA_OK_STATUSES },
        sentAt: { gte },
      },
    }),
    prisma.whatsAppCampaignSend.count({
      where: {
        tenantId,
        status: WASendStatus.FAILED,
        metaMessageId: { not: null },
        sentAt: { gte },
      },
    }),
  ]);
  return ok + failedWithId;
}

export async function countAiCreditsThisMonth(
  tenantId: string,
): Promise<number> {
  return prisma.aiGeneration.count({
    where: { tenantId, createdAt: { gte: startOfCalendarMonthUTC() } },
  });
}

export async function countContacts(tenantId: string): Promise<number> {
  return prisma.contact.count({ where: { tenantId } });
}

export async function countSendingDomains(tenantId: string): Promise<number> {
  return prisma.sendingDomain.count({ where: { tenantId } });
}

/**
 * Memberships + non-expired pending invitations. Counting pending
 * invites prevents the "invite 50 emails before any accepts" exploit
 * on a 10-seat plan.
 */
/**
 * Phase 7 — count agent conversations started in the current calendar
 * month UTC. Any non-ABANDONED status counts (we don't refund a
 * conversation that ended up in the FAILED bucket; the token spend
 * already happened). Only conversations created by this tenant.
 */
export async function countAgentConversationsThisMonth(
  tenantId: string,
): Promise<number> {
  return prisma.agentConversation.count({
    where: {
      tenantId,
      createdAt: { gte: startOfCalendarMonthUTC() },
      status: { not: 'ABANDONED' },
    },
  });
}

// Phase 8 M3 — counts every drip-campaign enrollment (regardless of
// current status) created since the calendar-month boundary. The
// gate at automation.enroll assertions checks against this.
export async function countAutomationEnrollmentsThisMonth(
  tenantId: string,
): Promise<number> {
  return prisma.automationEnrollment.count({
    where: {
      tenantId,
      enrolledAt: { gte: startOfCalendarMonthUTC() },
    },
  });
}

// Phase 8 M5 — counts every draft the Email Agent generated (approved
// + rejected) since the calendar-month boundary. Sonnet calls are
// expensive; this cap protects the tenant's budget.
export async function countAgentRepliesThisMonth(
  tenantId: string,
): Promise<number> {
  return prisma.emailAgentMessage.count({
    where: {
      tenantId,
      createdAt: { gte: startOfCalendarMonthUTC() },
      direction: 'OUTBOUND',
      status: { in: ['DRAFT_AWAITING_APPROVAL', 'APPROVED_QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'REJECTED'] },
    },
  });
}

export async function countSeatsConsumed(tenantId: string): Promise<number> {
  const now = new Date();
  const [members, pending] = await Promise.all([
    prisma.membership.count({ where: { tenantId } }),
    prisma.invitation.count({
      where: {
        tenantId,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    }),
  ]);
  return members + pending;
}

/**
 * Single-metric dispatcher. The gate functions use this; the M5
 * subscription page calls all of them at once via the convenience
 * `getAllCurrentUsage` below.
 */
export async function getCurrentUsage(
  tenantId: string,
  metric: PlanMetric,
): Promise<number> {
  switch (metric) {
    case PlanMetric.CONTACTS:
      return countContacts(tenantId);
    case PlanMetric.EMAILS_PER_MONTH:
      return countEmailsThisMonth(tenantId);
    case PlanMetric.WA_MESSAGES_PER_MONTH:
      return countWaMessagesThisMonth(tenantId);
    case PlanMetric.SMS_SEGMENTS_PER_MONTH:
      return 0; // no SMS schema yet
    case PlanMetric.AI_CREDITS_PER_MONTH:
      return countAiCreditsThisMonth(tenantId);
    case PlanMetric.CUSTOM_SENDING_DOMAINS:
      return countSendingDomains(tenantId);
    case PlanMetric.USER_SEATS:
      return countSeatsConsumed(tenantId);
    case PlanMetric.AI_AGENT_CONVERSATIONS_PER_MONTH:
      return countAgentConversationsThisMonth(tenantId);
    case PlanMetric.AUTOMATION_ENROLLMENTS_PER_MONTH:
      return countAutomationEnrollmentsThisMonth(tenantId);
    case PlanMetric.AGENT_REPLIES_PER_MONTH:
      return countAgentRepliesThisMonth(tenantId);
  }
}

/**
 * All-metrics view for the tenant subscription page. Parallel — cheap
 * because each branch is one indexed count.
 */
export async function getAllCurrentUsage(
  tenantId: string,
): Promise<Record<PlanMetric, number>> {
  const metrics: PlanMetric[] = [
    PlanMetric.CONTACTS,
    PlanMetric.EMAILS_PER_MONTH,
    PlanMetric.WA_MESSAGES_PER_MONTH,
    PlanMetric.SMS_SEGMENTS_PER_MONTH,
    PlanMetric.AI_CREDITS_PER_MONTH,
    PlanMetric.CUSTOM_SENDING_DOMAINS,
    PlanMetric.USER_SEATS,
    PlanMetric.AI_AGENT_CONVERSATIONS_PER_MONTH,
    PlanMetric.AUTOMATION_ENROLLMENTS_PER_MONTH,
    PlanMetric.AGENT_REPLIES_PER_MONTH,
  ];
  const values = await Promise.all(
    metrics.map((m) => getCurrentUsage(tenantId, m)),
  );
  return Object.fromEntries(metrics.map((m, i) => [m, values[i]])) as Record<
    PlanMetric,
    number
  >;
}
