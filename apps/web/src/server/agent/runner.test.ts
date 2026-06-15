/**
 * Phase 7 M7 — runner pure-helper coverage.
 *
 * The runner itself talks to Prisma + the Anthropic SDK, so it's not
 * unit-testable end-to-end without heavy mocks. The piece worth
 * locking down is the cost-cap directive: when the conversation has
 * spent over $0.50, the system prompt must instruct the agent to
 * finalize on its next turn.
 *
 * The actual `runConversationTurn` flow is exercised by the M8
 * smoke test against a real tenant.
 */
import { describe, expect, it } from 'vitest';

import { COST_CAP_CENTS, buildCostCapDirective } from './runner';

describe('buildCostCapDirective', () => {
  it('returns empty string under the cap', () => {
    expect(buildCostCapDirective(0)).toBe('');
    expect(buildCostCapDirective(COST_CAP_CENTS - 1)).toBe('');
  });

  it('returns a finalize directive at exactly the cap', () => {
    const directive = buildCostCapDirective(COST_CAP_CENTS);
    expect(directive).toContain('BUDGET CAP REACHED');
    expect(directive).toContain('finalize_draft');
  });

  it('includes the actual spend amount in the directive', () => {
    const directive = buildCostCapDirective(125);
    expect(directive).toContain('$1.25');
  });

  it('surfaces the user-facing copy the agent should repeat', () => {
    const directive = buildCostCapDirective(COST_CAP_CENTS);
    expect(directive).toContain('Let me create your draft now');
  });
});
