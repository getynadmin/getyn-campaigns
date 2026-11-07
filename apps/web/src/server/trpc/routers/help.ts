import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AiNotConfiguredError, helpAnswer, type HelpDoc } from '@getyn/ai';

import { categories } from '@/lib/docs/articles';
import { getAnthropicCredentials } from '@/server/integrations/anthropic';

import { createTRPCRouter, protectedProcedure } from '../trpc';

/**
 * Help assistant router. Logged-in only; does NOT consume AI credits
 * (help is a product-support surface, not a billable generation).
 * Rate-limited per-user to 30 questions / rolling hour via a simple
 * in-memory counter — it's chat, not a batch pipeline, so losing the
 * counter on restart is fine.
 */

const BUCKET_WINDOW_MS = 60 * 60 * 1000;
const PER_USER_HOURLY_LIMIT = 30;
const recentByUser = new Map<string, number[]>();

function withinLimit(userId: string): boolean {
  const now = Date.now();
  const list = (recentByUser.get(userId) ?? []).filter(
    (t) => now - t < BUCKET_WINDOW_MS,
  );
  if (list.length >= PER_USER_HOURLY_LIMIT) {
    recentByUser.set(userId, list);
    return false;
  }
  list.push(now);
  recentByUser.set(userId, list);
  return true;
}

function flattenDocs(): HelpDoc[] {
  return categories.flatMap((c) =>
    c.articles.map((a) => ({
      slug: `${c.slug}/${a.slug}`,
      title: a.title,
      category: c.title,
    })),
  );
}

export const helpRouter = createTRPCRouter({
  ask: protectedProcedure
    .input(
      z.object({
        question: z.string().trim().min(2).max(2000),
        history: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string().max(4000),
            }),
          )
          .max(16)
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!withinLimit(ctx.user.id)) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `You've hit the help assistant limit (${PER_USER_HOURLY_LIMIT}/hour). Try again shortly.`,
        });
      }

      const anthropic = await getAnthropicCredentials();

      try {
        const result = await helpAnswer(
          {
            question: input.question,
            history: input.history,
            availableDocs: flattenDocs(),
          },
          anthropic.apiKey ? { apiKey: anthropic.apiKey } : {},
        );
        return {
          answer: result.answer,
          citations: result.citations,
        };
      } catch (err) {
        if (err instanceof AiNotConfiguredError) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'The help assistant is temporarily unavailable. Try the docs at /docs in the meantime.',
          });
        }
        throw err;
      }
    }),
});
