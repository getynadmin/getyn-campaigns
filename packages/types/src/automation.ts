import { z } from 'zod';

/**
 * Phase 8 M2 — Zod schemas for the Automation.definition JSON.
 *
 * The visual builder produces `{ nodes, edges }`; the tRPC mutation
 * validates against `automationDefinitionSchema` before persisting.
 * Every mutation runs through this — a bad canvas can't corrupt the
 * DB.
 *
 * Node-level Draft/Live status lives on the node object (Message
 * nodes only). The engine (M3) reads it here and pauses enrollments
 * at DRAFT nodes.
 */

// -----------------------------------------------------------------
// Trigger — must be exactly one Trigger node. Discriminated on kind.
// -----------------------------------------------------------------

export const automationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual_enrollment') }),
  z.object({
    kind: z.literal('contact_added_to_segment'),
    segmentId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('tag_applied'),
    tagId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('date_field_matches'),
    /** Custom field key — matches against Contact.customFields[key]. */
    customFieldKey: z.string().min(1).max(64),
    /** How to compare — anniversary of the stored date, or exact match. */
    match: z.enum(['anniversary', 'exact']).default('anniversary'),
    /** UTC hour of day to fire (0-23). */
    hourUtc: z.number().int().min(0).max(23).default(9),
  }),
  z.object({ kind: z.literal('webhook') }), // stubbed
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

// -----------------------------------------------------------------
// Time delay units + delay config
// -----------------------------------------------------------------

export const delayUnitSchema = z.enum(['minutes', 'hours', 'days', 'weeks']);
export type DelayUnit = z.infer<typeof delayUnitSchema>;

// -----------------------------------------------------------------
// Conditional split conditions
// -----------------------------------------------------------------

export const splitConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('opened_previous_email'),
    /** Which prior Email node to check. When null, checks the most recent. */
    nodeId: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal('clicked_previous_email'),
    nodeId: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal('clicked_specific_link'),
    nodeId: z.string().nullable().default(null),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal('has_tag'),
    tagId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('custom_field_equals'),
    customFieldKey: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('time_since_enrollment'),
    op: z.enum(['gt', 'lt']),
    minutes: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('whatsapp_message_delivered'), nodeId: z.string().nullable().default(null) }),
  z.object({ kind: z.literal('whatsapp_message_read'),      nodeId: z.string().nullable().default(null) }),
  z.object({ kind: z.literal('whatsapp_message_replied'),   nodeId: z.string().nullable().default(null) }),
]);
export type SplitCondition = z.infer<typeof splitConditionSchema>;

// -----------------------------------------------------------------
// Per-node data schemas (data lives on ReactFlow's `node.data`)
// -----------------------------------------------------------------

const nodeStatusSchema = z.enum(['DRAFT', 'LIVE']).default('DRAFT');

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/**
 * Message node — Email. Body lives in Unlayer JSON; the engine
 * renders on send. Subject + preview are stored inline. Falls back
 * to a plaintext body when designJson is null (e.g. simple text
 * email created before hooking Unlayer).
 */
const emailNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('email'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('Email'),
    status: nodeStatusSchema,
    subject: z.string().max(200).default(''),
    previewText: z.string().max(200).default(''),
    /** Unlayer design JSON (opaque here — validated by Unlayer at edit). */
    designJson: z.unknown().nullable().default(null),
    /** Rendered HTML (produced by "Save design" in the composer). */
    renderedHtml: z.string().default(''),
    /** Auto-generated fallback; editable. */
    textBody: z.string().default(''),
  }),
});

const whatsappNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('whatsapp'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('WhatsApp'),
    status: nodeStatusSchema,
    /** WhatsAppTemplate.id — must be APPROVED to flip node LIVE. */
    templateId: z.string().nullable().default(null),
    /** WhatsAppPhoneNumber.id — sender number. */
    phoneNumberId: z.string().nullable().default(null),
    /** Variable substitutions — `{ "1": "{{contact.firstName}}", "2": "..." }`. */
    variables: z.record(z.string()).default({}),
  }),
});

const propertyUpdateNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('property_update'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('Update property'),
    action: z.enum(['set_custom_field', 'unset_custom_field']),
    customFieldKey: z.string().min(1).max(64),
    /** Only used for set_custom_field. */
    value: z.string().default(''),
  }),
});

const listUpdateNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('list_update'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('Update list'),
    action: z.enum([
      'add_tag',
      'remove_tag',
      'move_to_segment',
      'unsubscribe_email',
      'unsubscribe_whatsapp',
      'unsubscribe_sms',
    ]),
    /** For tag actions: Tag.id. For move_to_segment: Segment.id. Ignored for unsubscribe. */
    targetId: z.string().nullable().default(null),
  }),
});

const internalAlertNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('internal_alert'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('Internal alert'),
    /** Where to send: email address, membership userId, or webhook URL. */
    channel: z.enum(['email', 'user', 'webhook']),
    /** email → email string; user → userId; webhook → https URL. */
    target: z.string().min(1),
    /** Short template — merge tags `{{contact.email}}` etc. */
    message: z.string().max(500).default(''),
  }),
});

const triggerNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('trigger'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('When...'),
    trigger: automationTriggerSchema,
  }),
});

const timeDelayNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('delay'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('Wait'),
    mode: z.enum(['relative', 'absolute', 'weekday_time']).default('relative'),
    /** Used when mode='relative'. */
    amount: z.number().int().min(1).max(10_000).default(1),
    unit: delayUnitSchema.default('days'),
    /** Used when mode='absolute' — ISO. */
    absoluteAt: z.string().datetime().nullable().default(null),
    /** Used when mode='weekday_time' — 0=Sunday…6=Saturday. */
    weekday: z.number().int().min(0).max(6).nullable().default(null),
    /** Hour of day for weekday_time (0-23, UTC). */
    hourUtc: z.number().int().min(0).max(23).nullable().default(null),
  }),
});

const conditionalSplitNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('split'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('If / else'),
    condition: splitConditionSchema,
  }),
});

const exitNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('exit'),
  position: positionSchema,
  data: z.object({
    label: z.string().default('End'),
    reason: z.string().max(120).default(''),
  }),
});

export const automationNodeSchema = z.discriminatedUnion('type', [
  triggerNodeSchema,
  emailNodeSchema,
  whatsappNodeSchema,
  propertyUpdateNodeSchema,
  listUpdateNodeSchema,
  internalAlertNodeSchema,
  timeDelayNodeSchema,
  conditionalSplitNodeSchema,
  exitNodeSchema,
]);
export type AutomationNode = z.infer<typeof automationNodeSchema>;
export type AutomationNodeType = AutomationNode['type'];

export const automationEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /**
   * Conditional split emits two edges — one labelled 'yes' one 'no'.
   * Every other node emits at most one; leave sourceHandle null.
   */
  sourceHandle: z.enum(['yes', 'no']).nullable().default(null),
});
export type AutomationEdge = z.infer<typeof automationEdgeSchema>;

export const automationDefinitionSchema = z.object({
  nodes: z.array(automationNodeSchema).max(200),
  edges: z.array(automationEdgeSchema).max(400),
});
export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;

// -----------------------------------------------------------------
// Automation-level settings
// -----------------------------------------------------------------

export const automationSettingsSchema = z.object({
  /**
   * What happens when a contact replies to an outbound email in this
   * automation. Default STOP is the safest — most marketing flows
   * are "until customer responds."
   */
  onReply: z.enum(['STOP', 'CONTINUE', 'BRANCH']).default('STOP'),
  /**
   * Sender identity for every Email node in the workflow. Left null
   * on new automations; the engine falls back to the
   * NOTIFICATIONS_FROM env + tenant company name so activations
   * pre-configuration still send. Once configured, the tRPC
   * updateSettings mutation verifies fromEmail belongs to a
   * VERIFIED SendingDomain.
   */
  fromName: z.string().trim().max(120).nullable().default(null),
  fromEmail: z
    .string()
    .trim()
    .email()
    .max(200)
    .nullable()
    .default(null),
});
export type AutomationSettings = z.infer<typeof automationSettingsSchema>;

// -----------------------------------------------------------------
// Structural validation — the schema above is per-item; this catches
// graph-level problems (missing trigger, orphans, loops).
// -----------------------------------------------------------------

export interface AutomationDefinitionIssue {
  code:
    | 'no_trigger'
    | 'multiple_triggers'
    | 'no_exit_reachable'
    | 'orphan_node'
    | 'loop_detected'
    | 'edge_dangling'
    | 'no_live_message_node';
  message: string;
  nodeId?: string;
}

export function validateAutomationDefinition(
  def: AutomationDefinition,
  opts: { requireLiveMessageNode?: boolean } = {},
): AutomationDefinitionIssue[] {
  const issues: AutomationDefinitionIssue[] = [];
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));
  const triggers = def.nodes.filter((n) => n.type === 'trigger');

  if (triggers.length === 0) {
    issues.push({ code: 'no_trigger', message: 'Add a Trigger node to start the flow.' });
    return issues;
  }
  if (triggers.length > 1) {
    issues.push({ code: 'multiple_triggers', message: 'Only one Trigger node allowed.' });
  }

  // Dangling edges (source or target missing).
  for (const e of def.edges) {
    if (!nodesById.has(e.source) || !nodesById.has(e.target)) {
      issues.push({
        code: 'edge_dangling',
        message: 'An edge references a node that no longer exists.',
      });
    }
  }

  // Reachability from Trigger. Any node not reachable = orphan.
  const outgoing = new Map<string, string[]>();
  for (const e of def.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
  }
  const trigger = triggers[0]!;
  const reached = new Set<string>();
  const stack = [trigger.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const t of outgoing.get(id) ?? []) stack.push(t);
  }
  for (const n of def.nodes) {
    if (!reached.has(n.id) && n.id !== trigger.id) {
      issues.push({
        code: 'orphan_node',
        message: `Node "${n.data.label}" isn't connected to the flow.`,
        nodeId: n.id,
      });
    }
  }

  // Loop detection via DFS coloring.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of def.nodes) color.set(n.id, WHITE);
  let looped = false;
  function dfs(id: string): void {
    if (looped) return;
    color.set(id, GRAY);
    for (const t of outgoing.get(id) ?? []) {
      if (color.get(t) === GRAY) {
        looped = true;
        issues.push({
          code: 'loop_detected',
          message: `A cycle passes through node ${id}. Automations can't loop back to themselves.`,
          nodeId: id,
        });
        return;
      }
      if (color.get(t) === WHITE) dfs(t);
    }
    color.set(id, BLACK);
  }
  dfs(trigger.id);

  if (opts.requireLiveMessageNode) {
    const hasLiveMessage = def.nodes.some(
      (n) => (n.type === 'email' || n.type === 'whatsapp') && n.data.status === 'LIVE',
    );
    if (!hasLiveMessage) {
      issues.push({
        code: 'no_live_message_node',
        message:
          "Every automation needs at least one message node set to Live before it can activate — otherwise it'd send nothing.",
      });
    }
  }

  return issues;
}
