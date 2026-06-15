/**
 * Phase 7 M2 — agent SSE endpoint.
 *
 * POST /api/agent/{conversationId}/stream
 *   body: { userMessage: string }
 *   returns: text/event-stream of AgentStreamEvent JSON-encoded
 *            data: events.
 *
 * Auth: the caller's session must own the conversation. The chat UI
 * lives at /t/[slug]/agent/[conversationId] so we resolve the user via
 * the standard session cookie + tRPC's tenant scope is enforced when
 * we look up the AgentConversation row before streaming.
 *
 * Cancellation: the consuming client closes the stream via
 * AbortController (or just navigates away). The generator runs to
 * completion server-side because the model's stream is already in
 * flight by then — we'd need a wrap-with-AbortSignal to interrupt
 * mid-stream. Tracked for M6 polish.
 */
import { TRPCError } from '@trpc/server';

import { prisma } from '@getyn/db';

import { getCurrentUser } from '@/server/auth/session';
import { runConversationTurn } from '@/server/agent/runner';

import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel function timeout — Pro plan 300s, Hobby 60s. Tune per plan.

const encoder = new TextEncoder();

export async function POST(
  req: NextRequest,
  { params }: { params: { conversationId: string } },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  let userMessage = '';
  try {
    const body = (await req.json()) as { userMessage?: unknown };
    if (typeof body.userMessage !== 'string' || body.userMessage.trim() === '') {
      return new Response('userMessage required', { status: 400 });
    }
    userMessage = body.userMessage;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Ownership check — the user must be a member of the conversation's
  // tenant. We look up the conversation directly (not via withTenant)
  // because we don't have a tenant scope yet; the membership check
  // below does the equivalent.
  const convo = await prisma.agentConversation.findUnique({
    where: { id: params.conversationId },
    select: { tenantId: true, createdByUserId: true },
  });
  if (!convo) {
    return new Response('Conversation not found', { status: 404 });
  }
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId: user.id,
        tenantId: convo.tenantId,
      },
    },
    select: { id: true },
  });
  if (!membership) {
    return new Response('Forbidden', { status: 403 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (data: unknown): void => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller closed by client disconnect — swallow
        }
      };
      try {
        for await (const evt of runConversationTurn({
          conversationId: params.conversationId,
          userMessage,
        })) {
          write(evt);
        }
      } catch (err) {
        const message =
          err instanceof TRPCError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Agent stream failed.';
        write({ type: 'error', message });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed — fine
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
