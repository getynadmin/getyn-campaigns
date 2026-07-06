/**
 * Phase 8 M8 — automation graph validator.
 *
 * Covers the four hard failures we surface on activate:
 *   no_trigger, orphan_node, loop_detected, no_live_message_node.
 * Structural per-node validation is Zod's job — this file targets
 * the graph-level checks that `validateAutomationDefinition` runs.
 */
import { describe, expect, it } from 'vitest';

import {
  validateAutomationDefinition,
  type AutomationDefinition,
} from '@getyn/types';

function baseTrigger(x = 0, y = 0) {
  return {
    id: 'trigger-1',
    type: 'trigger' as const,
    position: { x, y },
    data: {
      label: 'When...',
      trigger: { kind: 'manual_enrollment' as const },
    },
  };
}

function baseExit(id = 'exit-1', x = 0, y = 0) {
  return {
    id,
    type: 'exit' as const,
    position: { x, y },
    data: { label: 'End', reason: '' },
  };
}

function edge(id: string, source: string, target: string, sourceHandle: 'yes' | 'no' | null = null) {
  return { id, source, target, sourceHandle };
}

describe('validateAutomationDefinition', () => {
  it('flags missing trigger', () => {
    const def: AutomationDefinition = { nodes: [baseExit()], edges: [] };
    const issues = validateAutomationDefinition(def);
    expect(issues.some((i) => i.code === 'no_trigger')).toBe(true);
  });

  it('flags multiple triggers', () => {
    const def: AutomationDefinition = {
      nodes: [
        baseTrigger(0, 0),
        { ...baseTrigger(200, 0), id: 'trigger-2' },
        baseExit(),
      ],
      edges: [edge('e1', 'trigger-1', 'exit-1')],
    };
    const issues = validateAutomationDefinition(def);
    expect(issues.some((i) => i.code === 'multiple_triggers')).toBe(true);
  });

  it('flags an orphan node not reachable from Trigger', () => {
    const def: AutomationDefinition = {
      nodes: [
        baseTrigger(),
        baseExit('exit-1', 0, 200),
        // Orphan email node — not connected to anything.
        {
          id: 'orphan-email',
          type: 'email',
          position: { x: 400, y: 0 },
          data: {
            label: 'Loose email',
            status: 'DRAFT',
            subject: '',
            previewText: '',
            designJson: null,
            renderedHtml: '',
            textBody: '',
          },
        },
      ],
      edges: [edge('e1', 'trigger-1', 'exit-1')],
    };
    const issues = validateAutomationDefinition(def);
    const orphan = issues.find((i) => i.code === 'orphan_node');
    expect(orphan).toBeDefined();
    expect(orphan!.nodeId).toBe('orphan-email');
  });

  it('detects a cycle', () => {
    const def: AutomationDefinition = {
      nodes: [
        baseTrigger(),
        {
          id: 'delay-1',
          type: 'delay',
          position: { x: 0, y: 100 },
          data: {
            label: 'Wait',
            mode: 'relative',
            amount: 1,
            unit: 'days',
            absoluteAt: null,
            weekday: null,
            hourUtc: null,
          },
        },
      ],
      edges: [
        edge('e1', 'trigger-1', 'delay-1'),
        // Loop delay back to itself (via trigger for a longer cycle).
        edge('e2', 'delay-1', 'trigger-1'),
      ],
    };
    const issues = validateAutomationDefinition(def);
    expect(issues.some((i) => i.code === 'loop_detected')).toBe(true);
  });

  it('flags no LIVE message node when requireLiveMessageNode=true', () => {
    const def: AutomationDefinition = {
      nodes: [
        baseTrigger(),
        {
          id: 'email-1',
          type: 'email',
          position: { x: 0, y: 100 },
          data: {
            label: 'Draft email',
            status: 'DRAFT',
            subject: 'Hi',
            previewText: '',
            designJson: null,
            renderedHtml: '<p>hi</p>',
            textBody: 'hi',
          },
        },
        baseExit('exit-1', 0, 200),
      ],
      edges: [
        edge('e1', 'trigger-1', 'email-1'),
        edge('e2', 'email-1', 'exit-1'),
      ],
    };
    const issues = validateAutomationDefinition(def, { requireLiveMessageNode: true });
    expect(issues.some((i) => i.code === 'no_live_message_node')).toBe(true);
  });

  it('passes on a canonical Trigger → LIVE Email → Exit graph', () => {
    const def: AutomationDefinition = {
      nodes: [
        baseTrigger(),
        {
          id: 'email-1',
          type: 'email',
          position: { x: 0, y: 100 },
          data: {
            label: 'Welcome',
            status: 'LIVE',
            subject: 'Hi',
            previewText: '',
            designJson: null,
            renderedHtml: '<p>hi</p>',
            textBody: 'hi',
          },
        },
        baseExit('exit-1', 0, 200),
      ],
      edges: [
        edge('e1', 'trigger-1', 'email-1'),
        edge('e2', 'email-1', 'exit-1'),
      ],
    };
    const issues = validateAutomationDefinition(def, { requireLiveMessageNode: true });
    expect(issues).toEqual([]);
  });

  it('flags a dangling edge (source or target missing)', () => {
    const def: AutomationDefinition = {
      nodes: [baseTrigger(), baseExit()],
      edges: [edge('e1', 'trigger-1', 'missing-target')],
    };
    const issues = validateAutomationDefinition(def);
    expect(issues.some((i) => i.code === 'edge_dangling')).toBe(true);
  });
});
