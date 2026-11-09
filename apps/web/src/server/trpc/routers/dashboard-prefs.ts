import { z } from 'zod';

import { prisma, withTenant } from '@getyn/db';

import { createTRPCRouter, tenantProcedure } from '../trpc';

/**
 * Per-user-per-tenant dashboard prefs: onboarding checklist state
 * (dismissed / collapsed / which steps were skipped) and the
 * customisable dashboard layout (which widgets live under which tab,
 * in what order).
 *
 * Rows are created lazily on first mutation — a user who's never
 * touched their dashboard gets `null` back and the UI falls through
 * to the defaults.
 */

const layoutSchema = z.object({
  tabs: z.record(
    z.string(),
    z.object({
      order: z.array(z.string()),
      hidden: z.array(z.string()),
    }),
  ),
});

export type DashboardLayout = z.infer<typeof layoutSchema>;

async function ensureRow(userId: string, tenantId: string): Promise<void> {
  // Upsert without touching user-controlled fields — uses the unique
  // (userId, tenantId) index so concurrent writes don't collide.
  await prisma.tenantUserPreference.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId },
    update: {},
  });
}

export const dashboardPrefsRouter = createTRPCRouter({
  get: tenantProcedure.query(async ({ ctx }) => {
    const row = await prisma.tenantUserPreference.findUnique({
      where: {
        userId_tenantId: {
          userId: ctx.user.id,
          tenantId: ctx.tenantContext.tenant.id,
        },
      },
    });
    return {
      onboardingDismissed: row?.onboardingDismissed ?? false,
      onboardingCollapsed: row?.onboardingCollapsed ?? false,
      onboardingSkipped: (row?.onboardingSkipped as string[] | null) ?? [],
      dashboardLayout: (row?.dashboardLayout as DashboardLayout | null) ?? null,
    };
  }),

  setOnboardingCollapsed: tenantProcedure
    .input(z.object({ collapsed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ensureRow(ctx.user.id, ctx.tenantContext.tenant.id);
      await prisma.tenantUserPreference.update({
        where: {
          userId_tenantId: {
            userId: ctx.user.id,
            tenantId: ctx.tenantContext.tenant.id,
          },
        },
        data: { onboardingCollapsed: input.collapsed },
      });
      return { ok: true as const };
    }),

  dismissOnboarding: tenantProcedure.mutation(async ({ ctx }) => {
    await ensureRow(ctx.user.id, ctx.tenantContext.tenant.id);
    await prisma.tenantUserPreference.update({
      where: {
        userId_tenantId: {
          userId: ctx.user.id,
          tenantId: ctx.tenantContext.tenant.id,
        },
      },
      data: { onboardingDismissed: true },
    });
    return { ok: true as const };
  }),

  reinstateOnboarding: tenantProcedure.mutation(async ({ ctx }) => {
    await ensureRow(ctx.user.id, ctx.tenantContext.tenant.id);
    await prisma.tenantUserPreference.update({
      where: {
        userId_tenantId: {
          userId: ctx.user.id,
          tenantId: ctx.tenantContext.tenant.id,
        },
      },
      data: {
        onboardingDismissed: false,
        onboardingCollapsed: false,
        onboardingSkipped: [],
      },
    });
    return { ok: true as const };
  }),

  skipOnboardingStep: tenantProcedure
    .input(z.object({ key: z.string().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      await ensureRow(ctx.user.id, ctx.tenantContext.tenant.id);
      const row = await prisma.tenantUserPreference.findUnique({
        where: {
          userId_tenantId: {
            userId: ctx.user.id,
            tenantId: ctx.tenantContext.tenant.id,
          },
        },
      });
      const current = (row?.onboardingSkipped as string[] | null) ?? [];
      if (current.includes(input.key)) return { ok: true as const };
      await prisma.tenantUserPreference.update({
        where: {
          userId_tenantId: {
            userId: ctx.user.id,
            tenantId: ctx.tenantContext.tenant.id,
          },
        },
        data: { onboardingSkipped: [...current, input.key] },
      });
      return { ok: true as const };
    }),

  setDashboardLayout: tenantProcedure
    .input(layoutSchema)
    .mutation(async ({ ctx, input }) => {
      await ensureRow(ctx.user.id, ctx.tenantContext.tenant.id);
      await prisma.tenantUserPreference.update({
        where: {
          userId_tenantId: {
            userId: ctx.user.id,
            tenantId: ctx.tenantContext.tenant.id,
          },
        },
        // JSON cast keeps Prisma happy — layoutSchema has already validated shape.
        data: { dashboardLayout: input as unknown as object },
      });
      return { ok: true as const };
    }),

  /**
   * One-shot channel + onboarding signal pack used by the dashboard
   * widgets (channel health, onboarding step completeness). Reads
   * sending domains + WhatsApp account + platform SMS integration
   * in a single tenant-scoped query so widgets don't each hit the DB.
   */
  channelStatus: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const [verifiedDomains, wabaConnected, smsIntegration] = await Promise.all([
      withTenant(tenantId, (tx) =>
        tx.sendingDomain.count({ where: { tenantId, status: 'VERIFIED' } }),
      ),
      withTenant(tenantId, (tx) =>
        tx.whatsAppAccount.findFirst({
          where: { tenantId, status: 'CONNECTED' },
          select: { id: true },
        }),
      ),
      // Platform-level SMS — Twilio integration row (admin configured).
      prisma.integrationCredential
        .findFirst({
          where: { provider: 'twilio', enabled: true },
          select: { id: true },
        })
        .catch(() => null),
    ]);
    return {
      email: {
        connected: verifiedDomains > 0,
        verifiedDomains,
      },
      whatsapp: { connected: !!wabaConnected },
      sms: { connected: !!smsIntegration },
    };
  }),

  /**
   * Latest 20 activity items for the Recent activity widget. Pulls
   * recent campaign sends, agent conversations, and automation
   * enrolments, merges them in-memory, trims to 20.
   */
  recentActivity: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const [campaigns, approvals, enrolments] = await Promise.all([
        tx.campaign.findMany({
          where: { tenantId, sentAt: { not: null } },
          select: { id: true, name: true, type: true, sentAt: true },
          orderBy: { sentAt: 'desc' },
          take: 10,
        }),
        tx.emailAgentMessage.findMany({
          where: { tenantId, status: 'DRAFT_AWAITING_APPROVAL' },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        tx.automationEnrollment.findMany({
          where: { tenantId },
          select: {
            id: true,
            enrolledAt: true,
            automation: { select: { name: true } },
          },
          orderBy: { enrolledAt: 'desc' },
          take: 10,
        }),
      ]);
      const items = [
        ...campaigns.map((c) => ({
          id: `c-${c.id}`,
          kind: 'campaign_sent' as const,
          at: c.sentAt as Date,
          title: c.name,
          sub: `${c.type.toLowerCase()} campaign sent`,
        })),
        ...approvals.map((a) => ({
          id: `a-${a.id}`,
          kind: 'approval' as const,
          at: a.createdAt,
          title: 'Agent reply awaiting approval',
          sub: 'Email Agent',
        })),
        ...enrolments.map((e) => ({
          id: `e-${e.id}`,
          kind: 'enrolment' as const,
          at: e.enrolledAt,
          title: e.automation?.name ?? 'Automation',
          sub: 'New enrolment',
        })),
      ];
      items.sort((a, b) => b.at.getTime() - a.at.getTime());
      return items.slice(0, 20).map((i) => ({
        ...i,
        at: i.at.toISOString(),
      }));
    });
  }),

  /**
   * KPI tile numbers: contacts (total), campaigns sent in window,
   * avg open rate + click rate over the window, with deltas vs the
   * prior equal-length window.
   */
  kpis: tenantProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const to = new Date();
      const from = new Date(to.getTime() - input.days * 86_400_000);
      const prevFrom = new Date(from.getTime() - input.days * 86_400_000);
      return withTenant(tenantId, async (tx) => {
        const [contacts, campaignsCur, campaignsPrev, sendsCur, sendsPrev] =
          await Promise.all([
            tx.contact.count({ where: { tenantId, deletedAt: null } }),
            tx.campaign.count({
              where: { tenantId, sentAt: { gte: from, lte: to } },
            }),
            tx.campaign.count({
              where: { tenantId, sentAt: { gte: prevFrom, lt: from } },
            }),
            tx.campaignSend.groupBy({
              by: ['status'],
              where: { tenantId, sentAt: { gte: from, lte: to } },
              _count: { _all: true },
            }),
            tx.campaignSend.groupBy({
              by: ['status'],
              where: { tenantId, sentAt: { gte: prevFrom, lt: from } },
              _count: { _all: true },
            }),
          ]);
        const rate = (
          rows: { status: string; _count: { _all: number } }[],
        ): { open: number; click: number } => {
          const m: Record<string, number> = {};
          for (const r of rows) m[r.status] = r._count._all;
          const sent =
            (m.SENT ?? 0) + (m.DELIVERED ?? 0) + (m.OPENED ?? 0) + (m.CLICKED ?? 0);
          const opened = (m.OPENED ?? 0) + (m.CLICKED ?? 0);
          const clicked = m.CLICKED ?? 0;
          return {
            open: sent === 0 ? 0 : opened / sent,
            click: sent === 0 ? 0 : clicked / sent,
          };
        };
        const cur = rate(sendsCur);
        const prev = rate(sendsPrev);
        return {
          contacts,
          campaignsSent: campaignsCur,
          campaignsSentDelta: campaignsPrev === 0
            ? null
            : (campaignsCur - campaignsPrev) / campaignsPrev,
          openRate: cur.open,
          openRateDelta: prev.open === 0 ? null : (cur.open - prev.open) / prev.open,
          clickRate: cur.click,
          clickRateDelta:
            prev.click === 0 ? null : (cur.click - prev.click) / prev.click,
        };
      });
    }),

  resetDashboardLayout: tenantProcedure.mutation(async ({ ctx }) => {
    await ensureRow(ctx.user.id, ctx.tenantContext.tenant.id);
    await prisma.tenantUserPreference.update({
      where: {
        userId_tenantId: {
          userId: ctx.user.id,
          tenantId: ctx.tenantContext.tenant.id,
        },
      },
      data: { dashboardLayout: null as unknown as object },
    });
    return { ok: true as const };
  }),
});
