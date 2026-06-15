/**
 * Phase 7 M4 — accumulated state for the WhatsApp agent.
 *
 * Stored in AgentConversation.conversationState (JSONB) and threaded
 * through the runtime as ctx.state. Tools mutate one or two slots;
 * finalize_draft reads the whole thing.
 */
import type { TemplateVariable } from '@getyn/types';

export type WhatsAppTemplateStateStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED';

export interface WhatsAppAgentTemplateRef {
  templateId: string;
  templateName: string;
  language: string;
  status: WhatsAppTemplateStateStatus;
  /** Count of {{N}} variables in the BODY component — used to validate
   *  set_template_variables. */
  variableCount: number;
  /** Render-time body text WITH the {{N}} tokens so the preview pane
   *  (M5) can substitute on the client. */
  bodyText: string;
}

export interface WhatsAppAgentPhoneRef {
  phoneNumberId: string;
  phoneNumber: string;
  verifiedName: string;
}

export interface WhatsAppAgentState {
  goal?: string;
  audience?: {
    segmentId: string;
    segmentName: string;
  };
  template?: WhatsAppAgentTemplateRef;
  templateVariables?: TemplateVariable[];
  phoneNumber?: WhatsAppAgentPhoneRef;
}

export function readWaState(state: Record<string, unknown>): WhatsAppAgentState {
  return state as WhatsAppAgentState;
}
