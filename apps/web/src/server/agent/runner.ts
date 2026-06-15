/**
 * Phase 7 M2 — agent runner glue.
 *
 * Wires the @getyn/ai runtime to the Prisma message store + context
 * loader + per-channel toolset. Single entry point: `runConversationTurn`
 * returns an async generator of stream events the SSE endpoint pipes
 * to the client.
 */
import { prisma } from '@getyn/db';
import {
  runAgentTurn,
  type AgentStreamEvent,
  type ToolDefinition,
} from '@getyn/ai';

import { setGoalTool } from './tools/set-goal';
import {
  loadAgentContext,
  renderSystemPrompt,
} from './context-loader';
import { createConversationMessageStore } from './message-store';

/**
 * In M2 every conversation gets the same trivial toolset
 * (just `set_goal`). M3 will expand the EMAIL list and M4 will add
 * the WHATSAPP list.
 */
function toolsForChannel(channel: 'EMAIL' | 'WHATSAPP'): ToolDefinition[] {
  void channel;
  return [setGoalTool as ToolDefinition];
}

const FINALIZE_TOOL_NAMES = ['finalize_draft'];

export async function* runConversationTurn(args: {
  conversationId: string;
  userMessage: string;
}): AsyncGenerator<AgentStreamEvent> {
  const convo = await prisma.agentConversation.findUnique({
    where: { id: args.conversationId },
    select: {
      id: true,
      tenantId: true,
      createdByUserId: true,
      channel: true,
      status: true,
      conversationState: true,
    },
  });
  if (!convo) {
    yield { type: 'error', message: 'Conversation not found.' };
    return;
  }
  if (convo.status !== 'ACTIVE') {
    yield {
      type: 'error',
      message: `Conversation is ${convo.status}, no further turns accepted.`,
    };
    return;
  }

  const context = await loadAgentContext({
    tenantId: convo.tenantId,
    channel: convo.channel,
  });
  const systemPrompt = renderSystemPrompt({
    channel: convo.channel,
    context,
  });

  const store = createConversationMessageStore({
    conversationId: convo.id,
    tenantId: convo.tenantId,
  });

  const initialState =
    (convo.conversationState as Record<string, unknown> | null) ?? {};

  yield* runAgentTurn({
    conversationId: convo.id,
    tenantId: convo.tenantId,
    userId: convo.createdByUserId,
    systemPrompt,
    tools: toolsForChannel(convo.channel),
    userMessage: args.userMessage,
    store,
    initialState,
    finalizeToolNames: FINALIZE_TOOL_NAMES,
  });

  // After the turn streams, sync the goal from accumulated state to
  // AgentConversation.goal so the resume list has a readable label
  // before any draft is created.
  const refreshed = await prisma.agentConversation.findUnique({
    where: { id: convo.id },
    select: { conversationState: true, goal: true, title: true },
  });
  const stateGoal =
    (refreshed?.conversationState as Record<string, unknown> | null)?.goal;
  if (typeof stateGoal === 'string' && stateGoal !== refreshed?.goal) {
    await prisma.agentConversation.update({
      where: { id: convo.id },
      data: {
        goal: stateGoal,
        title: refreshed?.title ?? truncateTitle(stateGoal),
      },
    });
  }
}

function truncateTitle(s: string): string {
  return s.length <= 60 ? s : s.slice(0, 57) + '…';
}
