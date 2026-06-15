import type { ToolDefinition } from '@getyn/ai';

import { setGoalTool } from '../set-goal';
import {
  addBlockTool,
  removeBlockTool,
  reorderBlocksTool,
} from './add-remove-reorder';
import { finalizeDraftTool } from './finalize-draft';
import { proposeDesignPlanTool } from './propose-design-plan';
import { requestImageTool } from './request-image';
import { setAudienceTool } from './set-audience';
import { setSubjectLineTool } from './set-subject-line';
import { updateBlockContentTool } from './update-block-content';

/**
 * The full email-agent toolset. Order matches the order Claude is
 * likely to call them in a typical conversation:
 *   1. set_goal (shared)
 *   2. set_audience
 *   3. set_subject_line
 *   4. propose_design_plan
 *   5. update_block_content / add_block / remove_block / reorder_blocks
 *      / request_image (refinements)
 *   6. finalize_draft
 */
export const emailAgentTools: ToolDefinition[] = [
  setGoalTool as ToolDefinition,
  setAudienceTool as ToolDefinition,
  setSubjectLineTool as ToolDefinition,
  proposeDesignPlanTool as ToolDefinition,
  updateBlockContentTool as ToolDefinition,
  addBlockTool as ToolDefinition,
  removeBlockTool as ToolDefinition,
  reorderBlocksTool as ToolDefinition,
  requestImageTool as ToolDefinition,
  finalizeDraftTool as ToolDefinition,
];
