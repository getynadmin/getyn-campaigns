/**
 * Phase 7 M3 — typed shape of the email agent's accumulated state.
 *
 * Stored in AgentConversation.conversationState (JSONB) and threaded
 * through the runtime as ctx.state. Each tool mutates one or two
 * slots; finalize_draft reads the whole thing.
 */

export interface PlanBlockState {
  slug: string;
  content: Record<string, unknown>;
  /** Optional internal note from the agent (e.g. "awaiting image"). */
  notes?: string;
}

export interface ImageRequest {
  blockIndex: number;
  description: string;
  /** Asset URL once the user provides one (set via the M5 image
   *  picker round-trip; M3 leaves this undefined). */
  resolvedAssetUrl?: string;
}

export interface EmailAgentState {
  goal?: string;
  audience?: {
    segmentId: string;
    segmentName: string;
  };
  subjectLine?: {
    subject: string;
    preheader?: string | null;
  };
  designPlan?: PlanBlockState[];
  imageRequests?: ImageRequest[];
}

/** Type-narrow a raw state blob into EmailAgentState. */
export function readEmailState(state: Record<string, unknown>): EmailAgentState {
  return state as EmailAgentState;
}
