import type { ToolDefinition } from '@getyn/ai';

import { setGoalTool } from '../set-goal';
// The shape of set_audience is identical for both channels — same
// state slot, same validation — so we just re-export the email
// implementation rather than duplicating it.
import { setAudienceTool } from '../email/set-audience';
import { draftNewTemplateTool } from './draft-new-template';
import { finalizeWhatsAppDraftTool } from './finalize-draft';
import { listApprovedTemplatesTool } from './list-approved-templates';
import { pickExistingTemplateTool } from './pick-existing-template';
import { setPhoneNumberTool } from './set-phone-number';
import { setTemplateVariablesTool } from './set-template-variables';

/**
 * Full WhatsApp-agent toolset. Typical sequence:
 *   1. set_goal (shared)
 *   2. set_audience (shared shape)
 *   3. list_approved_templates → pick_existing_template
 *      OR draft_new_template (which lands a DRAFT for Meta approval)
 *   4. set_template_variables (only if template has {{N}} slots)
 *   5. set_phone_number (auto-call if only one connected)
 *   6. finalize_draft
 */
export const whatsAppAgentTools: ToolDefinition[] = [
  setGoalTool as ToolDefinition,
  setAudienceTool as ToolDefinition,
  listApprovedTemplatesTool as ToolDefinition,
  pickExistingTemplateTool as ToolDefinition,
  draftNewTemplateTool as ToolDefinition,
  setTemplateVariablesTool as ToolDefinition,
  setPhoneNumberTool as ToolDefinition,
  finalizeWhatsAppDraftTool as ToolDefinition,
];
