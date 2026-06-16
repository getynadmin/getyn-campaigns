/**
 * Phase 7 M2 — agent runtime.
 *
 * Streaming tool-use loop that drives the email and WhatsApp agents.
 * Channel-specific behaviour lives in the toolset + system prompt
 * passed by the caller — this file knows nothing about Campaigns
 * tables.
 *
 * # Flow per user message
 *
 *   1. Caller appends a USER message to the store and invokes
 *      runAgentTurn() with the new userMessage.
 *   2. Runtime loads history, converts to Anthropic's message format,
 *      and starts a streamed messages.create() call.
 *   3. Text deltas yield `token` events to the caller (SSE → UI).
 *   4. Tool-use blocks accumulate input JSON, then run the
 *      registered handler with Zod-validated input.
 *      - Each call yields `tool-call-start` then `tool-call-result`.
 *      - Each call persists TOOL_CALL + TOOL_RESULT rows.
 *   5. If the message stops with `stop_reason = "tool_use"`, the loop
 *      feeds tool results back and re-invokes the model. Otherwise
 *      the turn ends.
 *   6. The runtime hard-caps the inner loop at MAX_INNER_TURNS so a
 *      misbehaving model can't burn tokens forever.
 *   7. When a `finalizeToolNames` tool runs successfully, the loop
 *      exits with reason='finalize'.
 *
 * # Persistence boundary
 *
 * The MessageStore interface is the only place this file touches the
 * outside world — caller wires Prisma. Keeps the runtime testable
 * with an in-memory fake (M7 will cover that).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { z, ZodSchema, ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ACTIVE_MODEL, computeCost, getAnthropicClient } from './client';

const MAX_INNER_TURNS = 25;
const MAX_TOKENS = 4_096;

/** Phase 7 M6 — same-tool consecutive failure cap within a turn.
 *  After 2 errors in a row from the same tool, the runtime injects a
 *  warning into the next message so Claude steps back to ask the
 *  user instead of looping. */
const MAX_TOOL_RETRIES = 2;

// ----------------------------------------------------------------------------
// Tool registry
// ----------------------------------------------------------------------------

export interface ToolContext {
  conversationId: string;
  tenantId: string;
  userId: string;
  /** Mutable accumulated state. Tool handlers read prior turns' state
   *  and may patch via updateState(). Persisted at the end of the
   *  turn via store.finalizeTurn(). */
  state: Record<string, unknown>;
  updateState(patch: Record<string, unknown>): void;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodSchema<TInput>;
  outputSchema?: ZodSchema<TOutput>;
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

/**
 * Tool definition helper that infers TInput/TOutput from the Zod
 * schemas you pass in. Without this, TypeScript falls back to
 * `unknown` for the handler argument because ZodSchema is invariant
 * over its inferred type.
 *
 *   const tool = defineTool({
 *     name: 'set_goal',
 *     inputSchema: z.object({ goal: z.string() }),
 *     outputSchema: z.object({ ok: z.literal(true) }),
 *     async handler(input, ctx) { ... }  // input: { goal: string }
 *   });
 */
export function defineTool<
  TInputSchema extends ZodTypeAny,
  TOutputSchema extends ZodTypeAny,
>(spec: {
  name: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema?: TOutputSchema;
  handler: (
    input: z.infer<TInputSchema>,
    ctx: ToolContext,
  ) => Promise<z.infer<TOutputSchema>>;
}): ToolDefinition<z.infer<TInputSchema>, z.infer<TOutputSchema>> {
  return spec as ToolDefinition<
    z.infer<TInputSchema>,
    z.infer<TOutputSchema>
  >;
}

// ----------------------------------------------------------------------------
// Store boundary
// ----------------------------------------------------------------------------

export type StoredRole =
  | 'USER'
  | 'ASSISTANT'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'SYSTEM';

export interface HistoryMessage {
  role: StoredRole;
  content: string | null;
  toolName?: string | null;
  toolUseId?: string | null;
  toolInput?: unknown;
  toolOutput?: unknown;
  errorMessage?: string | null;
}

export interface PersistableMessage extends HistoryMessage {
  tokensInput?: number | null;
  tokensOutput?: number | null;
}

export interface FinalizeTurnArgs {
  stateSnapshot: Record<string, unknown>;
  addedTokens: number;
  addedCostUsd: number;
}

export interface MessageStore {
  /** Persist a single message turn (user, assistant text, tool call,
   *  tool result, …). Called incrementally as the runtime streams. */
  appendMessage(msg: PersistableMessage): Promise<void>;
  /** Load the conversation's prior messages so the model has context.
   *  Caller is responsible for the cap (last 50 / 100k tokens per
   *  Phase 7 spec). */
  loadHistory(): Promise<HistoryMessage[]>;
  /** Update conversation roll-ups (state snapshot, tokens, cost) at
   *  the end of every turn. */
  finalizeTurn(args: FinalizeTurnArgs): Promise<void>;
}

// ----------------------------------------------------------------------------
// Stream events (what the runtime yields)
// ----------------------------------------------------------------------------

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool-call-start'; name: string; id: string }
  | { type: 'tool-call-input-delta'; id: string; jsonDelta: string }
  | {
      type: 'tool-call-result';
      name: string;
      id: string;
      output: unknown;
      error?: string;
    }
  | { type: 'turn-complete'; reason: 'end_turn' | 'finalize' | 'max_turns' }
  | { type: 'error'; message: string };

// ----------------------------------------------------------------------------
// runAgentTurn — the main entry point
// ----------------------------------------------------------------------------

export interface RunAgentTurnArgs {
  conversationId: string;
  tenantId: string;
  userId: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  /** Latest user message — gets appended to history before model call. */
  userMessage: string;
  store: MessageStore;
  /** State accumulated across prior turns; tool handlers mutate via
   *  ctx.updateState. Persisted at end of turn. */
  initialState: Record<string, unknown>;
  /** Tools whose successful invocation signals "we're done — go
   *  hand off to the UI." Common case: `['finalize_draft']`. */
  finalizeToolNames?: string[];
  /** Explicit Anthropic API key — when supplied, overrides the
   *  process-wide env-var. Phase 7 + Phase 5.6 admin path: the
   *  runner resolves the key from the `anthropic_llm` IntegrationCredential
   *  row (DB) before falling back to ANTHROPIC_API_KEY env. */
  apiKey?: string;
}

export async function* runAgentTurn(
  args: RunAgentTurnArgs,
): AsyncGenerator<AgentStreamEvent> {
  const client = getAnthropicClient(args.apiKey);
  const finalizeSet = new Set(args.finalizeToolNames ?? []);
  const state = { ...args.initialState };
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let finalized = false;
  let reachedEndTurn = false;
  // Phase 7 M6 — per-tool consecutive failure tracker for this turn.
  // The runtime injects an explicit hint when a tool fails twice in
  // a row so Claude steps back instead of looping.
  const toolFailures = new Map<string, number>();

  // 1) Persist the user message + load history.
  await args.store.appendMessage({ role: 'USER', content: args.userMessage });
  const history = await args.store.loadHistory();
  const messages = historyToAnthropic(history);

  const anthropicTools = args.tools.map(toAnthropicTool);

  // 2) Inner loop — runs once per model invocation. The model may
  //    decide to call zero or more tools, then either ask for more
  //    (stop_reason = "tool_use") or finish (end_turn).
  for (let iteration = 0; iteration < MAX_INNER_TURNS; iteration++) {
    const stream = client.messages.stream({
      model: ACTIVE_MODEL,
      max_tokens: MAX_TOKENS,
      system: args.systemPrompt,
      tools: anthropicTools,
      messages,
    });

    let assistantText = '';
    // Track tool_use blocks indexed by content-block index.
    const toolUses: Record<
      number,
      { id: string; name: string; jsonBuffer: string }
    > = {};

    for await (const evt of stream) {
      if (evt.type === 'message_start') {
        totalTokensIn += evt.message.usage.input_tokens ?? 0;
        // output_tokens reports cumulatively in message_delta below
      } else if (evt.type === 'content_block_start') {
        if (evt.content_block.type === 'tool_use') {
          toolUses[evt.index] = {
            id: evt.content_block.id,
            name: evt.content_block.name,
            jsonBuffer: '',
          };
          yield {
            type: 'tool-call-start',
            id: evt.content_block.id,
            name: evt.content_block.name,
          };
        }
        // text blocks need no setup
      } else if (evt.type === 'content_block_delta') {
        if (evt.delta.type === 'text_delta') {
          yield { type: 'token', text: evt.delta.text };
          assistantText += evt.delta.text;
        } else if (evt.delta.type === 'input_json_delta') {
          const tool = toolUses[evt.index];
          if (tool) {
            tool.jsonBuffer += evt.delta.partial_json;
            yield {
              type: 'tool-call-input-delta',
              id: tool.id,
              jsonDelta: evt.delta.partial_json,
            };
          }
        }
      } else if (evt.type === 'message_delta') {
        if (evt.usage.output_tokens) {
          totalTokensOut += evt.usage.output_tokens;
        }
      }
    }

    const finalMessage = await stream.finalMessage();

    // 3) Persist the assistant's text (if any). Tool-use blocks are
    //    persisted separately as TOOL_CALL / TOOL_RESULT rows below.
    if (assistantText.trim().length > 0) {
      await args.store.appendMessage({
        role: 'ASSISTANT',
        content: assistantText,
        tokensInput: iteration === 0 ? totalTokensIn : 0,
        tokensOutput: totalTokensOut, // cumulative; close enough for this
      });
    }

    // 4) Process tool_use blocks in order. We feed all results back
    //    in a single user message at the end (Anthropic spec).
    const toolUseList = finalMessage.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    if (toolUseList.length === 0) {
      // No tools called — end of turn.
      reachedEndTurn = true;
      break;
    }

    // Add the assistant message (text + tool_use blocks) to history
    // for the next iteration.
    messages.push({ role: 'assistant', content: finalMessage.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const use of toolUseList) {
      const def = args.tools.find((t) => t.name === use.name);
      const ctx: ToolContext = {
        conversationId: args.conversationId,
        tenantId: args.tenantId,
        userId: args.userId,
        state,
        updateState(patch) {
          Object.assign(state, patch);
        },
      };

      if (!def) {
        const baseError = `Unknown tool: ${use.name}`;
        const errorMessage = withRetryHint(baseError, use.name, toolFailures);
        await args.store.appendMessage({
          role: 'TOOL_CALL',
          content: null,
          toolName: use.name,
          toolUseId: use.id,
          toolInput: use.input,
          errorMessage,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: errorMessage,
          is_error: true,
        });
        yield {
          type: 'tool-call-result',
          name: use.name,
          id: use.id,
          output: null,
          error: errorMessage,
        };
        continue;
      }

      // Validate input via Zod.
      const parsed = def.inputSchema.safeParse(use.input);
      if (!parsed.success) {
        const baseError = `Tool input invalid: ${parsed.error.message}`;
        const errorMessage = withRetryHint(baseError, use.name, toolFailures);
        await args.store.appendMessage({
          role: 'TOOL_CALL',
          content: null,
          toolName: use.name,
          toolUseId: use.id,
          toolInput: use.input,
          errorMessage,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: errorMessage,
          is_error: true,
        });
        yield {
          type: 'tool-call-result',
          name: use.name,
          id: use.id,
          output: null,
          error: errorMessage,
        };
        continue;
      }

      // Persist the call.
      await args.store.appendMessage({
        role: 'TOOL_CALL',
        content: null,
        toolName: use.name,
        toolUseId: use.id,
        toolInput: parsed.data,
      });

      try {
        const output = await def.handler(parsed.data, ctx);
        // Successful call resets this tool's failure streak.
        toolFailures.delete(use.name);
        await args.store.appendMessage({
          role: 'TOOL_RESULT',
          content: null,
          toolName: use.name,
          toolUseId: use.id,
          toolOutput: output as unknown,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output ?? null),
        });
        yield {
          type: 'tool-call-result',
          name: use.name,
          id: use.id,
          output,
        };
        if (finalizeSet.has(use.name)) {
          finalized = true;
        }
      } catch (err) {
        const baseError =
          err instanceof Error ? err.message : 'Tool handler threw.';
        const errorMessage = withRetryHint(baseError, use.name, toolFailures);
        await args.store.appendMessage({
          role: 'TOOL_RESULT',
          content: null,
          toolName: use.name,
          toolUseId: use.id,
          errorMessage,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: errorMessage,
          is_error: true,
        });
        yield {
          type: 'tool-call-result',
          name: use.name,
          id: use.id,
          output: null,
          error: errorMessage,
        };
      }
    }

    if (finalized) break;

    // Feed tool results back for the next iteration.
    messages.push({ role: 'user', content: toolResults });
  }

  // 5) Wrap up.
  const cost = computeCost(totalTokensIn, totalTokensOut);
  await args.store.finalizeTurn({
    stateSnapshot: state,
    addedTokens: totalTokensIn + totalTokensOut,
    addedCostUsd: cost.costUsd,
  });

  if (finalized) {
    yield { type: 'turn-complete', reason: 'finalize' };
  } else if (reachedEndTurn) {
    yield { type: 'turn-complete', reason: 'end_turn' };
  } else {
    yield { type: 'turn-complete', reason: 'max_turns' };
  }
}

// ----------------------------------------------------------------------------
// History conversion
// ----------------------------------------------------------------------------

/**
 * Convert our row-shaped history into Anthropic's MessageParam list.
 * Adjacent TOOL_CALL + TOOL_RESULT pairs collapse into a single
 * assistant message (with tool_use block) + user message (with
 * tool_result block) — the format Anthropic expects on follow-up
 * turns.
 */
// Anthropic's MessageParam.content list takes a union of the
// *Param block types — no single union alias exists on the SDK so
// we spell it out here.
type AnyBlockParam =
  | Anthropic.Messages.TextBlockParam
  | Anthropic.Messages.ImageBlockParam
  | Anthropic.Messages.ToolUseBlockParam
  | Anthropic.Messages.ToolResultBlockParam;

function historyToAnthropic(
  history: HistoryMessage[],
): Anthropic.Messages.MessageParam[] {
  const out: Anthropic.Messages.MessageParam[] = [];
  // Buffer pending tool_use / tool_result blocks since they need to
  // sit inside an assistant/user message respectively.
  let pendingAssistantBlocks: AnyBlockParam[] = [];
  let pendingUserBlocks: AnyBlockParam[] = [];
  // tool_use ids emitted so far. Anthropic rejects any tool_result
  // whose id doesn't match a tool_use in the IMMEDIATELY preceding
  // assistant message — we track all known ids across the whole
  // conversation as a defensive filter against orphans introduced by
  // history truncation, mid-turn crashes, or persistence bugs.
  const knownToolUseIds = new Set<string>();
  // tool_use ids that haven't been answered yet in this slice. Used
  // to drop trailing tool_use blocks at the very end (would also
  // confuse Anthropic — it'd retry).
  let openToolUseIds = new Set<string>();

  const flushAssistant = () => {
    if (pendingAssistantBlocks.length > 0) {
      out.push({ role: 'assistant', content: pendingAssistantBlocks });
      pendingAssistantBlocks = [];
    }
  };
  const flushUser = () => {
    if (pendingUserBlocks.length > 0) {
      out.push({ role: 'user', content: pendingUserBlocks });
      pendingUserBlocks = [];
    }
  };

  for (const msg of history) {
    if (msg.role === 'SYSTEM') continue; // system prompt threaded separately
    if (msg.role === 'USER') {
      // If we have open tool_uses with no matching tool_results, drop
      // the partial assistant turn — Anthropic would reject the
      // user-message follow-up otherwise. Better to lose context for
      // a half-finished turn than crash the whole conversation.
      if (openToolUseIds.size > 0) {
        pendingAssistantBlocks = [];
        openToolUseIds = new Set();
      }
      flushAssistant();
      flushUser();
      out.push({ role: 'user', content: msg.content ?? '' });
    } else if (msg.role === 'ASSISTANT') {
      flushUser();
      // Text from the model.
      if (msg.content && msg.content.trim().length > 0) {
        pendingAssistantBlocks.push({ type: 'text', text: msg.content });
      }
    } else if (msg.role === 'TOOL_CALL') {
      flushUser();
      if (msg.toolUseId && msg.toolName) {
        knownToolUseIds.add(msg.toolUseId);
        openToolUseIds.add(msg.toolUseId);
        pendingAssistantBlocks.push({
          type: 'tool_use',
          id: msg.toolUseId,
          name: msg.toolName,
          input: (msg.toolInput ?? {}) as Record<string, unknown>,
        });
      }
    } else if (msg.role === 'TOOL_RESULT') {
      // Drop orphan tool_results — Anthropic's #1 cause of
      // "messages.N.content.M: unexpected tool_use_id" errors.
      if (!msg.toolUseId || !knownToolUseIds.has(msg.toolUseId)) continue;
      flushAssistant();
      openToolUseIds.delete(msg.toolUseId);
      pendingUserBlocks.push({
        type: 'tool_result',
        tool_use_id: msg.toolUseId,
        content: JSON.stringify(
          msg.toolOutput ?? msg.errorMessage ?? null,
        ),
        is_error: Boolean(msg.errorMessage),
      });
    }
  }
  // If the final turn has open tool_uses with no matching results,
  // drop the trailing assistant tool_use block so the next call
  // doesn't ask Anthropic to "continue" an unanswered tool call.
  if (openToolUseIds.size > 0) {
    pendingAssistantBlocks = pendingAssistantBlocks.filter(
      (b) => b.type !== 'tool_use' || !openToolUseIds.has(b.id),
    );
  }
  flushAssistant();
  flushUser();
  return out;
}

// ----------------------------------------------------------------------------
// Tool definition → Anthropic format
// ----------------------------------------------------------------------------

function toAnthropicTool(def: ToolDefinition): Anthropic.Messages.Tool {
  const schema = zodToJsonSchema(def.inputSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as {
    type?: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: 'object',
      properties: (schema.properties ?? {}) as Record<
        string,
        Anthropic.Messages.Tool.InputSchema
      >,
      required: schema.required,
    } as Anthropic.Messages.Tool.InputSchema,
  };
}

/**
 * Phase 7 M6 — tool retry backstop.
 *
 * Tracks consecutive failures of the same tool within a turn. After
 * MAX_TOOL_RETRIES failures in a row we append an explicit hint to
 * the tool_result content so Claude reads the cumulative count and
 * is steered toward asking the user for clarification instead of
 * retrying the same call a third time.
 *
 * Reset on success (see the try-block in runAgentTurn).
 */
function withRetryHint(
  baseError: string,
  toolName: string,
  failures: Map<string, number>,
): string {
  const next = (failures.get(toolName) ?? 0) + 1;
  failures.set(toolName, next);
  if (next < MAX_TOOL_RETRIES) return baseError;
  return (
    baseError +
    `\n\nNOTE: this is the ${next}${ordinalSuffix(next)} consecutive failure of \`${toolName}\` in this turn — don't retry the same call. Stop and ask the user for clarification, or pick a different tool.`
  );
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
