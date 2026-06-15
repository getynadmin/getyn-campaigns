/**
 * Phase 7 M4 — set_template_variables guards.
 *
 * Tool is a pure state mutation; tests cover the validation paths.
 * Mocks @getyn/ai's defineTool helper to extract the handler directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@getyn/db', () => ({}));

import { setTemplateVariablesTool } from './set-template-variables';
import type { WhatsAppAgentState } from './state';

afterEach(() => vi.clearAllMocks());

function makeCtx(state: WhatsAppAgentState) {
  return {
    conversationId: 'c1',
    tenantId: 't1',
    userId: 'u1',
    state: state as unknown as Record<string, unknown>,
    updateState(patch: Record<string, unknown>) {
      Object.assign(state, patch);
    },
  };
}

describe('setTemplateVariablesTool', () => {
  it('rejects when no template has been picked yet', async () => {
    const ctx = makeCtx({});
    await expect(
      setTemplateVariablesTool.handler({ values: [] }, ctx),
    ).rejects.toThrow(/Pick or draft a template first/);
  });

  it('rejects when value count does not match the template variable count', async () => {
    const ctx = makeCtx({
      template: {
        templateId: 't',
        templateName: 'order_ship',
        language: 'en_US',
        status: 'APPROVED',
        variableCount: 2,
        bodyText: 'Hi {{1}}, your order {{2}} has shipped.',
      },
    });
    await expect(
      setTemplateVariablesTool.handler(
        {
          values: [{ index: 1, type: 'merge', value: 'contact.firstName' }],
        },
        ctx,
      ),
    ).rejects.toThrow(/expects 2 variable/);
  });

  it('rejects duplicate indices', async () => {
    const ctx = makeCtx({
      template: {
        templateId: 't',
        templateName: 'x',
        language: 'en_US',
        status: 'APPROVED',
        variableCount: 2,
        bodyText: '{{1}} {{2}}',
      },
    });
    await expect(
      setTemplateVariablesTool.handler(
        {
          values: [
            { index: 1, type: 'static', value: 'a' },
            { index: 1, type: 'static', value: 'b' },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow(/provided twice/);
  });

  it('rejects an index outside the variable range', async () => {
    const ctx = makeCtx({
      template: {
        templateId: 't',
        templateName: 'x',
        language: 'en_US',
        status: 'APPROVED',
        variableCount: 1,
        bodyText: 'Hi {{1}}',
      },
    });
    await expect(
      setTemplateVariablesTool.handler(
        { values: [{ index: 2, type: 'static', value: 'oops' }] },
        ctx,
      ),
    ).rejects.toThrow(/out of range/);
  });

  it('sorts values by index and strips the index field on success', async () => {
    const state: WhatsAppAgentState = {
      template: {
        templateId: 't',
        templateName: 'x',
        language: 'en_US',
        status: 'APPROVED',
        variableCount: 3,
        bodyText: '{{1}} {{2}} {{3}}',
      },
    };
    const ctx = makeCtx(state);
    const result = await setTemplateVariablesTool.handler(
      {
        values: [
          { index: 3, type: 'static', value: 'third' },
          { index: 1, type: 'static', value: 'first' },
          { index: 2, type: 'merge', value: 'contact.firstName' },
        ],
      },
      ctx,
    );
    expect(result).toEqual({ ok: true, filled: 3, expected: 3 });
    expect(state.templateVariables).toEqual([
      { type: 'static', value: 'first' },
      { type: 'merge', value: 'contact.firstName' },
      { type: 'static', value: 'third' },
    ]);
  });
});
