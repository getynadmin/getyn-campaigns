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

import {
  loadAgentContext,
  renderSystemPrompt,
} from './context-loader';
import { createConversationMessageStore } from './message-store';
import { emailAgentTools } from './tools/email';
import { whatsAppAgentTools } from './tools/whatsapp';

/**
 * Phase 7 M6 — hard cost cap per conversation.
 *
 * Once cumulative Claude spend on a conversation reaches this many
 * cents, the runner appends a directive to the system prompt telling
 * the agent to skip further refinement and call finalize_draft
 * immediately. The agent's drafts may be rougher than usual, but
 * the tenant doesn't keep racking up tokens.
 */
const COST_CAP_CENTS = 50;

/**
 * Channel-scoped tool registration. Both lists include set_goal (the
 * trivial shared opener) and a finalize_draft variant; the runtime's
 * finalizeToolNames cap catches either.
 */
function toolsForChannel(channel: 'EMAIL' | 'WHATSAPP'): ToolDefinition[] {
  if (channel === 'EMAIL') return emailAgentTools;
  return whatsAppAgentTools;
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
      costCents: true,
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
  const overBudget = convo.costCents >= COST_CAP_CENTS;
  const systemPrompt =
    renderSystemPrompt({
      channel: convo.channel,
      context,
    }) +
    (overBudget
      ? `\n\n# BUDGET CAP REACHED\n\nThis conversation has spent $${(
          convo.costCents / 100
        ).toFixed(
          2,
        )} in Claude API tokens already. STOP refining. Call \`finalize_draft\` on your very next turn with whatever you have. Tell the user briefly: "Let me create your draft now — you can refine it in the editor."`
      : '');

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
