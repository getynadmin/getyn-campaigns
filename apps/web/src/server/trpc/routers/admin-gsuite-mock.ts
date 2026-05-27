import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';

import { z } from 'zod';

import type { Prisma } from '@getyn/db';
import { gsuiteEventTypeSchema } from '@getyn/types';

import { withAdminContext } from '@/server/admin/with-admin-context';
import { enqueueGsuiteWebhookEvent } from '@/server/queues';

import { createAdminRouter, staffProcedure } from '../admin-trpc';

/**
 * Phase 5 M4 — synthetic G-Suite event firing (staff-only).
 *
 * Lets ops drive the deactivation lifecycle without a real G-Suite
 * webhook. Persists a GSuiteWebhookEvent row with a synthetic id +
 * dispatches via the same worker handler the real receiver uses.
 *
 * Every fire writes a StaffAuditLog row capturing actor + target +
 * eventType + reason. The mock-fired events are visible in the
 * regular webhook log alongside real ones; they're distinguished
 * by the `mock_fired_by` field in their rawPayload.
 *
 * # Why this surface exists in the codebase, not just tests
 * Phase 5 M3 is blocked on the G-Suite team confirming the
 * contract. Until then, the only way to exercise the deactivation
 * lifecycle end-to-end is to manually fire each event. This router
 * gives ops that lever — same audit + same processing path as the
 * real webhook would take.
 */
export const adminGsuiteMockRouter = createAdminRouter({
  fire: staffProcedure
    .input(
      z.object({
        tenantId: z.string().min(1).max(64),
        eventType: gsuiteEventTypeSchema,
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: input.tenantId },
          select: { id: true, gSuiteTenantId: true, slug: true },
        });
        if (!tenant) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found.' });
        }

        // Synthetic G-Suite event id — distinct from real-event ids
        // so a future real event with the same id can't collide.
        // The `evt_mock_` prefix is searchable in the audit + webhook
        // logs.
        const syntheticId = `evt_mock_${randomUUID()}`;

        // Build a payload shape that mirrors the real-webhook
        // contract. Each eventType gets its expected fields so the
        // worker's branch logic exercises the same code paths.
        const payload = buildMockPayload(input.eventType);

        const row = await tx.gSuiteWebhookEvent.create({
          data: {
            gSuiteEventId: syntheticId,
            eventType: input.eventType,
            tenantId: tenant.id,
            rawPayload: {
              eventId: syntheticId,
              eventType: input.eventType,
              tenantId: tenant.gSuiteTenantId ?? tenant.id,
              occurredAt: new Date().toISOString(),
              payload,
              mock_fired_by: ctx.staff.staffEmail,
            } as Prisma.JsonObject,
          },
        });

        // Enqueue outside the transaction would be cleaner but
        // we're inside withAdminContext's tx; the BullMQ producer
        // talks to Redis, not Postgres, so it doesn't matter
        // transactionally.
        await enqueueGsuiteWebhookEvent({ webhookEventId: row.id });

        return {
          result: { eventId: syntheticId, webhookEventId: row.id },
          audit: {
            action: `admin.gsuite_mock.${input.eventType}`,
            targetTenantId: tenant.id,
            reason: input.reason,
            afterSnapshot: { syntheticId, eventType: input.eventType },
          },
        };
      });
    }),
});

/**
 * Per-eventType payload skeletons. Reflects what the kickoff
 * contract assumes — when G-Suite ships the real spec we tighten
 * this to match exact field names.
 */
function buildMockPayload(eventType: string): Record<string, unknown> {
  switch (eventType) {
    case 'subscription.canceled':
      return { cancelAt: new Date().toISOString() };
    case 'tenant.deleted':
      return { deleteConfirmedAt: new Date().toISOString() };
    case 'subscription.updated':
      return { planSlug: 'growth' };
    case 'tenant.suspended':
      return { reason: 'staff_mock' };
    case 'tenant.reactivated':
      return { reactivatedAt: new Date().toISOString() };
    default:
      return {};
  }
}
