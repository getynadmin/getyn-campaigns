/**
 * Phase 7 M2 — Prisma-backed MessageStore for the agent runtime.
 *
 * Adapts the runtime's MessageStore interface to AgentMessage +
 * AgentConversation rows. Every append goes through withTenant() so
 * RLS holds even when the runtime is invoked from background paths.
 *
 * History cap (per Phase 7 spec):
 *   - Last 50 messages OR
 *   - First 100k tokens approximated by content length
 *   - whichever cap hits first, oldest dropped
 */
import { AgentMessageRole, Prisma, prisma, withTenant } from '@getyn/db';
import type {
  FinalizeTurnArgs,
  HistoryMessage,
  MessageStore,
  PersistableMessage,
} from '@getyn/ai';

const HISTORY_MAX_MESSAGES = 50;
const HISTORY_MAX_TOKENS_APPROX = 100_000;
const CHARS_PER_TOKEN_APPROX = 4; // rough rule-of-thumb

const ROLE_MAP: Record<PersistableMessage['role'], AgentMessageRole> = {
  USER: AgentMessageRole.USER,
  ASSISTANT: AgentMessageRole.ASSISTANT,
  TOOL_CALL: AgentMessageRole.TOOL_CALL,
  TOOL_RESULT: AgentMessageRole.TOOL_RESULT,
  SYSTEM: AgentMessageRole.SYSTEM,
};

const REVERSE_ROLE: Record<AgentMessageRole, PersistableMessage['role']> = {
  USER: 'USER',
  ASSISTANT: 'ASSISTANT',
  TOOL_CALL: 'TOOL_CALL',
  TOOL_RESULT: 'TOOL_RESULT',
  SYSTEM: 'SYSTEM',
};

export function createConversationMessageStore(args: {
  conversationId: string;
  tenantId: string;
}): MessageStore {
  const { conversationId, tenantId } = args;
  return {
    async appendMessage(msg: PersistableMessage): Promise<void> {
      // tool_use_id rides along on the toolInput JSON so we don't
      // add a column; that field is opaque to RLS and audit.
      const toolInput = mergeToolUseId(msg.toolInput, msg.toolUseId);
      const toolOutput = mergeToolUseId(msg.toolOutput, msg.toolUseId);
      await withTenant(tenantId, (tx) =>
        tx.agentMessage.create({
          data: {
            conversationId,
            tenantId,
            role: ROLE_MAP[msg.role],
            content: msg.content ?? null,
            toolName: msg.toolName ?? null,
            toolInput:
              toolInput === undefined
                ? Prisma.DbNull
                : (toolInput as Prisma.InputJsonValue),
            toolOutput:
              toolOutput === undefined
                ? Prisma.DbNull
                : (toolOutput as Prisma.InputJsonValue),
            tokensInput: msg.tokensInput ?? null,
            tokensOutput: msg.tokensOutput ?? null,
            errorMessage: msg.errorMessage ?? null,
          },
        }),
      );
      // Bump conversation.lastMessageAt so the resume UI sorts right.
      // Done outside the appendMessage tx so this stays cheap.
      await prisma.agentConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });
    },

    async loadHistory(): Promise<HistoryMessage[]> {
      // Pull the most recent N (ordered desc) then reverse, so we
      // walk oldest→newest for the runtime's history conversion.
      // Cap by tokens-approx walking from newest backwards.
      const rows = await withTenant(tenantId, (tx) =>
        tx.agentMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_MAX_MESSAGES * 2, // generous fetch; we trim by token cap below
        }),
      );
      const trimmed: typeof rows = [];
      let tokenBudget = HISTORY_MAX_TOKENS_APPROX;
      for (const row of rows) {
        const approxTokens = Math.ceil(
          (row.content?.length ?? 0) / CHARS_PER_TOKEN_APPROX,
        );
        if (approxTokens > tokenBudget) break;
        trimmed.push(row);
        tokenBudget -= approxTokens;
        if (trimmed.length >= HISTORY_MAX_MESSAGES) break;
      }
      trimmed.reverse();
      return trimmed.map((r) => ({
        role: REVERSE_ROLE[r.role],
        content: r.content,
        toolName: r.toolName,
        toolUseId: extractToolUseId(r.toolInput) ?? extractToolUseId(r.toolOutput),
        toolInput: stripToolUseId(r.toolInput),
        toolOutput: stripToolUseId(r.toolOutput),
        errorMessage: r.errorMessage,
      }));
    },

    async finalizeTurn(args: FinalizeTurnArgs): Promise<void> {
      await prisma.agentConversation.update({
        where: { id: conversationId },
        data: {
          conversationState: args.stateSnapshot as Prisma.InputJsonValue,
          tokensUsed: { increment: args.addedTokens },
          costCents: { increment: Math.round(args.addedCostUsd * 100) },
          lastMessageAt: new Date(),
        },
      });
    },
  };
}

// ----------------------------------------------------------------------------
// tool_use_id smuggling helpers
//
// The Anthropic API needs a stable `tool_use_id` to match TOOL_USE
// blocks to TOOL_RESULT blocks across turns. We don't have a column
// for it in AgentMessage, so we slip it into the toolInput/toolOutput
// JSON under a reserved key. Strip on read so consumers see clean data.
// ----------------------------------------------------------------------------

const TOOL_USE_ID_KEY = '__tool_use_id__';

function mergeToolUseId(
  payload: unknown,
  toolUseId: string | null | undefined,
): unknown {
  if (!toolUseId) return payload;
  if (payload === undefined || payload === null) {
    return { [TOOL_USE_ID_KEY]: toolUseId };
  }
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), [TOOL_USE_ID_KEY]: toolUseId };
  }
  return { value: payload, [TOOL_USE_ID_KEY]: toolUseId };
}

function extractToolUseId(payload: unknown): string | undefined {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    TOOL_USE_ID_KEY in (payload as Record<string, unknown>)
  ) {
    const v = (payload as Record<string, unknown>)[TOOL_USE_ID_KEY];
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

function stripToolUseId(payload: unknown): unknown {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    TOOL_USE_ID_KEY in (payload as Record<string, unknown>)
  ) {
    const { [TOOL_USE_ID_KEY]: _, ...rest } = payload as Record<string, unknown>;
    void _;
    return rest;
  }
  return payload;
}
