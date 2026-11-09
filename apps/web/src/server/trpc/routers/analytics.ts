import { z } from 'zod';

import { prisma, withTenant } from '@getyn/db';

import { createTRPCRouter, tenantProcedure } from '../trpc';

/**
 * Analytics roll-ups for /t/<slug>/analytics. Each procedure answers
 * one report tab. Everything is scoped to the current tenant via
 * `withTenant` RLS; no cross-tenant leakage possible. Queries stay
 * cheap — status group-bys, counts, and small day-bucket raw SQL —
 * no heavy joins.
 */

const dateRangeSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    days: z.number().int().min(1).max(365).optional(),
  })
  .default({ days: 30 });

function resolveRange(input: {
  from?: string;
  to?: string;
  days?: number;
}): { from: Date; to: Date } {
  const to = input.to ? new Date(input.to) : new Date();
  if (input.from) return { from: new Date(input.from), to };
  const days = input.days ?? 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export const analyticsRouter = createTRPCRouter({
  // ───────────────────────────────────────────────────────────────
  // Overview — top-of-page roll-up for the "Overview" tab.
  // Sends/opens/clicks last N days (default 30), top-5 campaigns,
  // agent activity totals.
  // ───────────────────────────────────────────────────────────────
  overview: tenantProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { from, to } = resolveRange(input);

      return withTenant(tenantId, async (tx) => {
        const [sendsAgg, emailCampaigns, waCampaigns, agentConvs, enrollments] =
          await Promise.all([
            tx.campaignSend.groupBy({
              by: ['status'],
              where: { tenantId, sentAt: { gte: from, lte: to } },
              _count: { _all: true },
            }),
            tx.campaign.findMany({
              where: { tenantId, type: 'EMAIL', sentAt: { gte: from, lte: to } },
              select: {
                id: true,
                name: true,
                sentAt: true,
                emailCampaign: { select: { subject: true } },
              },
              orderBy: { sentAt: 'desc' },
              take: 50,
            }),
            tx.campaign.findMany({
              where: { tenantId, type: 'WHATSAPP', createdAt: { gte: from, lte: to } },
              select: { id: true, name: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 20,
            }),
            tx.agentConversation.groupBy({
              by: ['status'],
              where: { tenantId, createdAt: { gte: from, lte: to } },
              _count: { _all: true },
            }),
            tx.automationEnrollment.count({
              where: { tenantId, enrolledAt: { gte: from, lte: to } },
            }),
          ]);

        const sendCounts: Record<string, number> = {};
        for (const s of sendsAgg) sendCounts[s.status] = s._count._all;

        const sent =
          (sendCounts.SENT ?? 0) +
          (sendCounts.DELIVERED ?? 0) +
          (sendCounts.OPENED ?? 0) +
          (sendCounts.CLICKED ?? 0);
        const delivered =
          (sendCounts.DELIVERED ?? 0) +
          (sendCounts.OPENED ?? 0) +
          (sendCounts.CLICKED ?? 0);
        const opened = (sendCounts.OPENED ?? 0) + (sendCounts.CLICKED ?? 0);
        const clicked = sendCounts.CLICKED ?? 0;
        const bounced = sendCounts.BOUNCED ?? 0;
        const complained = sendCounts.COMPLAINED ?? 0;

        // Day-bucket sends/opens/clicks — small enough to raw-SQL.
        const trend = (await tx.$queryRawUnsafe(
          `SELECT
             date_trunc('day', "sentAt")::date AS day,
             COUNT(*) FILTER (WHERE "status" IN ('SENT','DELIVERED','OPENED','CLICKED')) AS sent,
             COUNT(*) FILTER (WHERE "status" IN ('OPENED','CLICKED')) AS opened,
             COUNT(*) FILTER (WHERE "status" = 'CLICKED') AS clicked
           FROM "CampaignSend"
           WHERE "tenantId" = $1 AND "sentAt" >= $2 AND "sentAt" <= $3
           GROUP BY 1
           ORDER BY 1 ASC`,
          tenantId,
          from,
          to,
        )) as Array<{
          day: Date;
          sent: bigint | number;
          opened: bigint | number;
          clicked: bigint | number;
        }>;

        // Top-5 campaigns by clicks over the range.
        const topByClicks = await tx.campaignSend.groupBy({
          by: ['campaignId'],
          where: {
            tenantId,
            sentAt: { gte: from, lte: to },
            status: 'CLICKED',
          },
          _count: { _all: true },
          orderBy: { _count: { campaignId: 'desc' } },
          take: 5,
        });
        const topIds = topByClicks.map((r) => r.campaignId);
        const topMeta = topIds.length
          ? await tx.campaign.findMany({
              where: { tenantId, id: { in: topIds } },
              select: { id: true, name: true },
            })
          : [];
        const topMetaById = new Map(topMeta.map((c) => [c.id, c.name]));

        const agentCounts: Record<string, number> = {};
        for (const a of agentConvs) agentCounts[a.status] = a._count._all;

        return {
          range: { from, to },
          email: {
            sent,
            delivered,
            opened,
            clicked,
            bounced,
            complained,
            openRate: sent === 0 ? 0 : opened / sent,
            clickRate: sent === 0 ? 0 : clicked / sent,
            bounceRate: sent === 0 ? 0 : bounced / sent,
          },
          trend: trend.map((t) => ({
            day: t.day instanceof Date ? t.day.toISOString() : String(t.day),
            sent: Number(t.sent),
            opened: Number(t.opened),
            clicked: Number(t.clicked),
          })),
          topCampaigns: topByClicks.map((r) => ({
            campaignId: r.campaignId,
            name: topMetaById.get(r.campaignId) ?? '(removed)',
            clicks: r._count._all,
          })),
          campaignCounts: {
            emailCampaigns: emailCampaigns.length,
            whatsappCampaigns: waCampaigns.length,
            automationEnrollments: enrollments,
          },
          agents: {
            total: Object.values(agentCounts).reduce((a, b) => a + b, 0),
            active: agentCounts.ACTIVE ?? 0,
            completed: agentCounts.COMPLETED_DRAFT_CREATED ?? 0,
            abandoned: agentCounts.ABANDONED ?? 0,
            failed: agentCounts.FAILED ?? 0,
          },
        };
      });
    }),

  // ───────────────────────────────────────────────────────────────
  // Email campaigns — per-campaign table for the Email tab.
  // ───────────────────────────────────────────────────────────────
  emailCampaigns: tenantProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { from, to } = resolveRange(input);

      return withTenant(tenantId, async (tx) => {
        const campaigns = await tx.campaign.findMany({
          where: {
            tenantId,
            type: 'EMAIL',
            OR: [{ sentAt: { gte: from, lte: to } }, { sentAt: null }],
          },
          select: {
            id: true,
            name: true,
            status: true,
            sentAt: true,
            createdAt: true,
            emailCampaign: { select: { subject: true } },
          },
          orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
          take: 100,
        });

        const ids = campaigns.map((c) => c.id);
        const sends = ids.length
          ? await tx.campaignSend.groupBy({
              by: ['campaignId', 'status'],
              where: { tenantId, campaignId: { in: ids } },
              _count: { _all: true },
            })
          : [];
        const unsubs = ids.length
          ? await tx.campaignEvent.groupBy({
              by: ['campaignId'],
              where: {
                tenantId,
                campaignId: { in: ids },
                type: 'UNSUBSCRIBED',
              },
              _count: { _all: true },
            })
          : [];

        const perCampaign = new Map<
          string,
          {
            sent: number;
            delivered: number;
            opened: number;
            clicked: number;
            bounced: number;
            complained: number;
            unsubscribed: number;
          }
        >();
        for (const c of campaigns) {
          perCampaign.set(c.id, {
            sent: 0,
            delivered: 0,
            opened: 0,
            clicked: 0,
            bounced: 0,
            complained: 0,
            unsubscribed: 0,
          });
        }
        for (const row of sends) {
          const bucket = perCampaign.get(row.campaignId);
          if (!bucket) continue;
          const n = row._count._all;
          if (
            row.status === 'SENT' ||
            row.status === 'DELIVERED' ||
            row.status === 'OPENED' ||
            row.status === 'CLICKED'
          ) {
            bucket.sent += n;
          }
          if (
            row.status === 'DELIVERED' ||
            row.status === 'OPENED' ||
            row.status === 'CLICKED'
          ) {
            bucket.delivered += n;
          }
          if (row.status === 'OPENED' || row.status === 'CLICKED') {
            bucket.opened += n;
          }
          if (row.status === 'CLICKED') bucket.clicked += n;
          if (row.status === 'BOUNCED') bucket.bounced += n;
          if (row.status === 'COMPLAINED') bucket.complained += n;
        }
        for (const u of unsubs) {
          if (!u.campaignId) continue;
          const bucket = perCampaign.get(u.campaignId);
          if (bucket) bucket.unsubscribed = u._count._all;
        }

        return campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          subject: c.emailCampaign?.subject ?? null,
          status: c.status,
          sentAt: c.sentAt,
          ...(perCampaign.get(c.id) ?? {
            sent: 0,
            delivered: 0,
            opened: 0,
            clicked: 0,
            bounced: 0,
            complained: 0,
            unsubscribed: 0,
          }),
        }));
      });
    }),

  // ───────────────────────────────────────────────────────────────
  // WhatsApp campaigns — per-campaign funnel.
  // ───────────────────────────────────────────────────────────────
  whatsappCampaigns: tenantProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { from, to } = resolveRange(input);

      return withTenant(tenantId, async (tx) => {
        const campaigns = await tx.campaign.findMany({
          where: { tenantId, type: 'WHATSAPP', createdAt: { gte: from, lte: to } },
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            sentAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        });
        const ids = campaigns.map((c) => c.id);
        const sends = ids.length
          ? await tx.whatsAppCampaignSend.groupBy({
              by: ['campaignId', 'status'],
              where: { tenantId, campaignId: { in: ids } },
              _count: { _all: true },
            })
          : [];
        const perCampaign = new Map<
          string,
          { queued: number; sent: number; delivered: number; read: number; failed: number }
        >();
        for (const c of campaigns) {
          perCampaign.set(c.id, {
            queued: 0,
            sent: 0,
            delivered: 0,
            read: 0,
            failed: 0,
          });
        }
        for (const row of sends) {
          const bucket = perCampaign.get(row.campaignId);
          if (!bucket) continue;
          const n = row._count._all;
          const s = row.status;
          if (s === 'QUEUED') bucket.queued += n;
          else if (s === 'SENT') bucket.sent += n;
          else if (s === 'DELIVERED') bucket.delivered += n;
          else if (s === 'READ') bucket.read += n;
          else if (s === 'FAILED') bucket.failed += n;
        }
        return campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          createdAt: c.createdAt,
          sentAt: c.sentAt,
          ...(perCampaign.get(c.id) ?? {
            queued: 0,
            sent: 0,
            delivered: 0,
            read: 0,
            failed: 0,
          }),
        }));
      });
    }),

  // ───────────────────────────────────────────────────────────────
  // Drip / Flows — per-automation enrollments + step completion.
  // ───────────────────────────────────────────────────────────────
  automations: tenantProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { from, to } = resolveRange(input);

      return withTenant(tenantId, async (tx) => {
        const automations = await tx.automation.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        });
        const ids = automations.map((a) => a.id);
        const enrollments = ids.length
          ? await tx.automationEnrollment.groupBy({
              by: ['automationId', 'status'],
              where: {
                tenantId,
                automationId: { in: ids },
                enrolledAt: { gte: from, lte: to },
              },
              _count: { _all: true },
            })
          : [];
        const perAuto = new Map<
          string,
          { active: number; completed: number; exited: number; failed: number; total: number }
        >();
        for (const a of automations) {
          perAuto.set(a.id, { active: 0, completed: 0, exited: 0, failed: 0, total: 0 });
        }
        for (const row of enrollments) {
          const bucket = perAuto.get(row.automationId);
          if (!bucket) continue;
          const n = row._count._all;
          bucket.total += n;
          if (row.status === 'ACTIVE') bucket.active += n;
          else if (row.status === 'COMPLETED') bucket.completed += n;
          else if (row.status === 'EXITED') bucket.exited += n;
          else if (row.status === 'FAILED') bucket.failed += n;
        }
        return automations.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          ...(perAuto.get(a.id) ?? {
            active: 0,
            completed: 0,
            exited: 0,
            failed: 0,
            total: 0,
          }),
        }));
      });
    }),

  // ───────────────────────────────────────────────────────────────
  // Agents — autonomous email + WhatsApp agent activity.
  // ───────────────────────────────────────────────────────────────
  agents: tenantProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { from, to } = resolveRange(input);

      return withTenant(tenantId, async (tx) => {
        const [byStatus, byChannel, pending] = await Promise.all([
          tx.agentConversation.groupBy({
            by: ['status'],
            where: { tenantId, createdAt: { gte: from, lte: to } },
            _count: { _all: true },
          }),
          tx.agentConversation.groupBy({
            by: ['channel'],
            where: { tenantId, createdAt: { gte: from, lte: to } },
            _count: { _all: true },
          }),
          // "Pending approvals" is the Email Agent's enrollments that
          // are halted waiting for a human review — the closest analog
          // to a "work queue aging" count for the agent tab.
          tx.emailAgentEnrollment.count({
            where: {
              tenantId,
              status: 'PAUSED_AWAITING_APPROVAL',
            },
          }),
        ]);

        const statusMap: Record<string, number> = {};
        for (const s of byStatus) statusMap[s.status] = s._count._all;
        const channelMap: Record<string, number> = {};
        for (const c of byChannel) {
          // AgentConversation.channel is nullable (AUDIENCE kind has
          // no channel). Bucket those under "other" rather than key
          // the map with null.
          channelMap[c.channel ?? 'other'] = c._count._all;
        }

        return {
          range: { from, to },
          totalConversations: Object.values(statusMap).reduce((a, b) => a + b, 0),
          byStatus: statusMap,
          byChannel: channelMap,
          pendingApprovals: pending,
        };
      });
    }),

  // ───────────────────────────────────────────────────────────────
  // Audience — contact growth, segments, suppression.
  // ───────────────────────────────────────────────────────────────
  audience: tenantProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { from, to } = resolveRange(input);

      return withTenant(tenantId, async (tx) => {
        const [total, newThisPeriod, suppressed, segments, tagCounts] =
          await Promise.all([
            tx.contact.count({ where: { tenantId } }),
            tx.contact.count({
              where: { tenantId, createdAt: { gte: from, lte: to } },
            }),
            tx.suppressionEntry.count({ where: { tenantId } }),
            tx.segment.findMany({
              where: { tenantId },
              select: { id: true, name: true, cachedCount: true },
              orderBy: { cachedCount: 'desc' },
              take: 10,
            }),
            // Top 10 tags by contact count — Tag holds tenantId so we
            // can filter here and include ContactTag count without
            // needing a tenantId on the join table itself.
            tx.tag.findMany({
              where: { tenantId },
              select: {
                id: true,
                name: true,
                _count: { select: { contacts: true } },
              },
              orderBy: { contacts: { _count: 'desc' } },
              take: 10,
            }),
          ]);

        const trend = (await tx.$queryRawUnsafe(
          `SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*) AS c
             FROM "Contact"
            WHERE "tenantId" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3
            GROUP BY 1 ORDER BY 1 ASC`,
          tenantId,
          from,
          to,
        )) as Array<{ day: Date; c: bigint | number }>;

        return {
          range: { from, to },
          totalContacts: total,
          newContacts: newThisPeriod,
          suppressed,
          topSegments: segments.map((s) => ({
            id: s.id,
            name: s.name,
            count: s.cachedCount ?? 0,
          })),
          topTags: tagCounts.map((row) => ({
            id: row.id,
            name: row.name,
            count: row._count.contacts,
          })),
          trend: trend.map((t) => ({
            day: t.day instanceof Date ? t.day.toISOString() : String(t.day),
            count: Number(t.c),
          })),
        };
      });
    }),

  // ───────────────────────────────────────────────────────────────
  // Deliverability — bounce / complaint / sending-domain health.
  // ───────────────────────────────────────────────────────────────
  deliverability: tenantProcedure
    .input(dateRangeSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const { from, to } = resolveRange(input);

      return withTenant(tenantId, async (tx) => {
        const [grouped, domains] = await Promise.all([
          tx.campaignSend.groupBy({
            by: ['status'],
            where: { tenantId, sentAt: { gte: from, lte: to } },
            _count: { _all: true },
          }),
          tx.sendingDomain.findMany({
            where: { tenantId },
            select: {
              id: true,
              domain: true,
              status: true,
              verifiedAt: true,
              lastCheckedAt: true,
            },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
        const c: Record<string, number> = {};
        for (const row of grouped) c[row.status] = row._count._all;
        const sent =
          (c.SENT ?? 0) + (c.DELIVERED ?? 0) + (c.OPENED ?? 0) + (c.CLICKED ?? 0);
        const bounced = c.BOUNCED ?? 0;
        const complained = c.COMPLAINED ?? 0;
        return {
          range: { from, to },
          sent,
          bounced,
          complained,
          bounceRate: sent === 0 ? 0 : bounced / sent,
          complaintRate: sent === 0 ? 0 : complained / sent,
          domains,
        };
      });
    }),
});
