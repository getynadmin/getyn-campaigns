import { TRPCError } from '@trpc/server';

import {
  AiNotConfiguredError,
  draftWhatsAppTemplate,
  isAiConfigured,
} from '@getyn/ai';
import { Role, prisma, withTenant } from '@getyn/db';
import { aiDraftTemplateSchema } from '@getyn/types';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * AI router (Phase 4 M7).
 *
 * For now, one feature: draft a WhatsApp template from a brief.
 * Phase 5 expands this with subject lines, reply suggestions,
 * segment naming, etc. — same router file, additional procedures.
 *
 * # Rate limiting
 * 10 generations per tenant per rolling hour. Counted from the
 * AiGeneration audit table. Unauthenticated bypass is impossible
 * because every entry point goes through tenantProcedure.
 *
 * # Audit
 * Every successful AND failed-after-fallback generation writes one
 * AiGeneration row capturing: feature, brief, response, tokens, cost.
 * Phase 5 adds plan-based credit ledgers; the row shape supports
 * billing rollups already.
 *
 * # Permissions
 * OWNER / ADMIN / EDITOR can draft. VIEWER cannot — same gate as
 * authoring templates manually.
 */

const HOURLY_LIMIT_PER_TENANT = 10;

export const aiRouter = createTRPCRouter({
  /**
   * `isAvailable` — light check the editor uses to decide whether
   * to render the "Draft with AI" button. Returns false when the
   * server is missing ANTHROPIC_API_KEY (the feature is gracefully
   * disabled rather than crashing the editor).
   */
  isAvailable: tenantProcedure.query(() => ({
    available: isAiConfigured(),
  })),

  draftWhatsAppTemplate: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(aiDraftTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      // Rate limit — count completed generations in the last hour.
      // Reads via withTenant so RLS keeps tenants isolated.
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await withTenant(tenantId, (tx) =>
        tx.aiGeneration.count({
          where: {
            tenantId,
            feature: 'wa_template_draft',
            createdAt: { gte: since },
          },
        }),
      );
      if (recent >= HOURLY_LIMIT_PER_TENANT) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Hourly AI limit reached (${HOURLY_LIMIT_PER_TENANT}/hour). Try again in a bit.`,
        });
      }

      // Pull tenant business context to feed Claude. Light optional
      // signal; falls through to undefined when not present.
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });

      let result;
      try {
        result = await draftWhatsAppTemplate({
          brief: input.brief,
          category: input.category,
          language: input.language,
          tone: input.tone,
          tenantName: tenant?.name,
        });
      } catch (err) {
        if (err instanceof AiNotConfiguredError) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'AI features are not configured on the server (missing ANTHROPIC_API_KEY).',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            err instanceof Error ? `AI generation failed: ${err.message}` : 'AI generation failed.',
          cause: err,
        });
      }

      // Persist audit row. Failures here MUST NOT eat the result —
      // the user already paid for the tokens; logging is best-effort.
      try {
        await withTenant(tenantId, (tx) =>
          tx.aiGeneration.create({
            data: {
              tenantId,
              userId,
              feature: 'wa_template_draft',
              prompt: input.brief,
              response: result.raw,
              tokensUsed: result.cost.totalTokens,
              cost: result.cost.costUsd,
            },
          }),
        );
      } catch (auditErr) {
        // Non-fatal — Sentry sees the worker errors via the
        // global capture; here we just continue.
        console.warn(
          '[ai.draftWhatsAppTemplate] audit insert failed:',
          auditErr instanceof Error ? auditErr.message : auditErr,
        );
      }

      return {
        components: result.components,
        rationale: result.rationale,
        issues: result.issues,
        attempts: result.attempts,
        cost: result.cost,
      };
    }),
});
