/**
 * Phase 8 M8 — cumulative day counter.
 *
 * Verifies the client-side traversal that renders the "Day X" label
 * on each node card in the builder.
 */
import { describe, expect, it } from 'vitest';

import { computeDayLabels } from '@/components/automation/day-counter';
import type { AutomationDefinition } from '@getyn/types';

function edge(id: string, source: string, target: string, sourceHandle: 'yes' | 'no' | null = null) {
  return { id, source, target, sourceHandle };
}

const TRIGGER = {
  id: 'trigger-1',
  type: 'trigger' as const,
  position: { x: 0, y: 0 },
  data: { label: 'When...', trigger: { kind: 'manual_enrollment' as const } },
};

function relDelay(id: string, amount: number, unit: 'minutes' | 'hours' | 'days' | 'weeks' = 'days') {
  return {
    id,
    type: 'delay' as const,
    position: { x: 0, y: 0 },
    data: {
      label: 'Wait',
      mode: 'relative' as const,
      amount,
      unit,
      absoluteAt: null,
      weekday: null,
      hourUtc: null,
    },
  };
}

function email(id: string) {
  return {
    id,
    type: 'email' as const,
    position: { x: 0, y: 0 },
    data: {
      label: 'Email',
      status: 'LIVE' as const,
      subject: '',
      previewText: '',
      designJson: null,
      renderedHtml: '',
      textBody: '',
    },
  };
}

function exit(id: string) {
  return {
    id,
    type: 'exit' as const,
    position: { x: 0, y: 0 },
    data: { label: 'End', reason: '' },
  };
}

describe('computeDayLabels', () => {
  it('returns an empty map when there is no trigger', () => {
    const def: AutomationDefinition = { nodes: [exit('exit-1')], edges: [] };
    const labels = computeDayLabels(def);
    expect(labels.size).toBe(0);
  });

  it('assigns Day 0 to nodes immediately after Trigger', () => {
    const def: AutomationDefinition = {
      nodes: [TRIGGER, email('email-1'), exit('exit-1')],
      edges: [
        edge('e1', 'trigger-1', 'email-1'),
        edge('e2', 'email-1', 'exit-1'),
      ],
    };
    const labels = computeDayLabels(def);
    expect(labels.get('email-1')).toBe('Day 0');
    expect(labels.get('exit-1')).toBe('Day 0');
  });

  it('accumulates relative delays', () => {
    const def: AutomationDefinition = {
      nodes: [TRIGGER, relDelay('delay-3d', 3), email('email-1'), exit('exit-1')],
      edges: [
        edge('e1', 'trigger-1', 'delay-3d'),
        edge('e2', 'delay-3d', 'email-1'),
        edge('e3', 'email-1', 'exit-1'),
      ],
    };
    const labels = computeDayLabels(def);
    expect(labels.get('delay-3d')).toBe('Day 0');
    expect(labels.get('email-1')).toBe('Day 3');
    expect(labels.get('exit-1')).toBe('Day 3');
  });

  it('formats hour-precision delays', () => {
    const def: AutomationDefinition = {
      nodes: [TRIGGER, relDelay('delay-4h', 4, 'hours'), email('email-1')],
      edges: [
        edge('e1', 'trigger-1', 'delay-4h'),
        edge('e2', 'delay-4h', 'email-1'),
      ],
    };
    const labels = computeDayLabels(def);
    expect(labels.get('email-1')).toBe('Day 0 + 4h');
  });

  it('renders a range when two paths merge with different delays', () => {
    // Trigger → (delay 3d → merge)
    //         → (delay 7d → merge)
    const def: AutomationDefinition = {
      nodes: [
        TRIGGER,
        relDelay('delay-3d', 3),
        relDelay('delay-7d', 7),
        email('merge-email'),
      ],
      edges: [
        edge('e1', 'trigger-1', 'delay-3d'),
        edge('e2', 'trigger-1', 'delay-7d'),
        edge('e3', 'delay-3d', 'merge-email'),
        edge('e4', 'delay-7d', 'merge-email'),
      ],
    };
    const labels = computeDayLabels(def);
    // Range formatting is "Day X–Y" (en-dash).
    expect(labels.get('merge-email')).toContain('Day 3');
    expect(labels.get('merge-email')).toContain('Day 7');
  });

  it('shows an absolute date for absolute-mode delays', () => {
    const def: AutomationDefinition = {
      nodes: [
        TRIGGER,
        {
          id: 'delay-abs',
          type: 'delay',
          position: { x: 0, y: 0 },
          data: {
            label: 'Wait until',
            mode: 'absolute',
            amount: 1,
            unit: 'days',
            absoluteAt: '2026-12-25T09:00:00.000Z',
            weekday: null,
            hourUtc: null,
          },
        },
        email('email-1'),
      ],
      edges: [
        edge('e1', 'trigger-1', 'delay-abs'),
        edge('e2', 'delay-abs', 'email-1'),
      ],
    };
    const labels = computeDayLabels(def);
    // Rendered via toLocaleDateString — just check it's not the "Day X" form.
    const abs = labels.get('delay-abs');
    expect(abs).toBeDefined();
    expect(abs).not.toMatch(/^Day \d/);
  });

  it('does not label the Trigger node', () => {
    const def: AutomationDefinition = {
      nodes: [TRIGGER, email('email-1')],
      edges: [edge('e1', 'trigger-1', 'email-1')],
    };
    const labels = computeDayLabels(def);
    expect(labels.get('trigger-1')).toBeUndefined();
  });
});
