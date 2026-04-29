/**
 * Phase 4 M2 — TemplateComponent Zod schema coverage.
 *
 * Validates Meta's structural rules (lengths, ordering, variables) and
 * our editorial overlay (per-category banned phrases, AUTH constraints).
 * The AI draft retry loop in M7 depends on every editorial rule
 * surfacing as a discrete issue, not as a single "validation failed" —
 * tested explicitly below.
 */
import {
  countVariables,
  templateComponentsSchema,
  templateNameSchema,
  validateForCategory,
  validateForSubmission,
  type TemplateDraft,
} from '@getyn/types';
import { describe, expect, it } from 'vitest';

const validBody = {
  type: 'BODY' as const,
  text: 'Hi {{1}}, your order {{2}} has shipped.',
  example: { body_text: [['Aria', 'GET-1029']] },
};

const validHeader = { type: 'HEADER' as const, format: 'TEXT' as const, text: 'Order shipped' };
const validFooter = { type: 'FOOTER' as const, text: 'Reply STOP to opt out' };

const baseDraft: TemplateDraft = {
  name: 'order_shipped',
  language: 'en_US',
  category: 'UTILITY',
  components: [validBody],
};

describe('templateComponentsSchema — structure', () => {
  it('accepts a minimal BODY-only template', () => {
    expect(templateComponentsSchema.safeParse([validBody]).success).toBe(true);
  });

  it('accepts the full HEADER → BODY → FOOTER → BUTTONS sequence', () => {
    const buttons = {
      type: 'BUTTONS' as const,
      buttons: [
        { type: 'URL' as const, text: 'Track', url: 'https://x.test/{{1}}', example: ['ord-1'] },
        { type: 'QUICK_REPLY' as const, text: 'Help' },
      ],
    };
    expect(
      templateComponentsSchema.safeParse([validHeader, validBody, validFooter, buttons]).success,
    ).toBe(true);
  });

  it('rejects template with no BODY', () => {
    const r = templateComponentsSchema.safeParse([validHeader]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('exactly one BODY'))).toBe(true);
    }
  });

  it('rejects template with two BODY components', () => {
    const r = templateComponentsSchema.safeParse([validBody, validBody]);
    expect(r.success).toBe(false);
  });

  it('rejects out-of-order components (FOOTER before BODY)', () => {
    const r = templateComponentsSchema.safeParse([validFooter, validBody]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.toLowerCase().includes('ordered'))).toBe(true);
    }
  });

  it('rejects more than one HEADER', () => {
    const r = templateComponentsSchema.safeParse([validHeader, validHeader, validBody]);
    expect(r.success).toBe(false);
  });
});

describe('BODY component', () => {
  it('rejects body text >1024 chars', () => {
    const long = { type: 'BODY' as const, text: 'a'.repeat(1025) };
    expect(templateComponentsSchema.safeParse([long]).success).toBe(false);
  });

  it('rejects more than 10 variables', () => {
    const text = Array.from({ length: 11 }, (_, i) => `{{${i + 1}}}`).join(' x ');
    const c = { type: 'BODY' as const, text };
    const r = templateComponentsSchema.safeParse([c]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('at most 10 variables'))).toBe(true);
    }
  });

  it('rejects adjacent variables without separating text', () => {
    const c = { type: 'BODY' as const, text: 'Hello {{1}}{{2}}' };
    const r = templateComponentsSchema.safeParse([c]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('separated'))).toBe(true);
    }
  });

  it('rejects non-sequential variables (skips {{2}})', () => {
    const c = { type: 'BODY' as const, text: 'Hi {{1}} order {{3}}' };
    const r = templateComponentsSchema.safeParse([c]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.toLowerCase().includes('sequential'))).toBe(true);
    }
  });

  it('rejects example length mismatching variable count', () => {
    const c = {
      type: 'BODY' as const,
      text: 'Hi {{1}}, order {{2}}',
      example: { body_text: [['only-one']] },
    };
    const r = templateComponentsSchema.safeParse([c]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('Example provides'))).toBe(true);
    }
  });
});

describe('HEADER component', () => {
  it('rejects TEXT header with no text', () => {
    const c = { type: 'HEADER' as const, format: 'TEXT' as const };
    const r = templateComponentsSchema.safeParse([c, validBody]);
    expect(r.success).toBe(false);
  });

  it('rejects IMAGE header with text set', () => {
    const c = { type: 'HEADER' as const, format: 'IMAGE' as const, text: 'should not be here' };
    const r = templateComponentsSchema.safeParse([c, validBody]);
    expect(r.success).toBe(false);
  });

  it('rejects header text >60 chars', () => {
    const c = { type: 'HEADER' as const, format: 'TEXT' as const, text: 'a'.repeat(61) };
    expect(templateComponentsSchema.safeParse([c, validBody]).success).toBe(false);
  });

  it('requires example.header_text when header has variables', () => {
    const c = { type: 'HEADER' as const, format: 'TEXT' as const, text: 'Hi {{1}}' };
    const r = templateComponentsSchema.safeParse([c, validBody]);
    expect(r.success).toBe(false);
  });
});

describe('BUTTONS component', () => {
  it('caps at 3 buttons', () => {
    const buttons = {
      type: 'BUTTONS' as const,
      buttons: [
        { type: 'QUICK_REPLY' as const, text: 'A' },
        { type: 'QUICK_REPLY' as const, text: 'B' },
        { type: 'QUICK_REPLY' as const, text: 'C' },
        { type: 'QUICK_REPLY' as const, text: 'D' },
      ],
    };
    expect(templateComponentsSchema.safeParse([validBody, buttons]).success).toBe(false);
  });

  it('rejects button text >25 chars', () => {
    const buttons = {
      type: 'BUTTONS' as const,
      buttons: [{ type: 'QUICK_REPLY' as const, text: 'a'.repeat(26) }],
    };
    expect(templateComponentsSchema.safeParse([validBody, buttons]).success).toBe(false);
  });

  it('rejects malformed phone number', () => {
    const buttons = {
      type: 'BUTTONS' as const,
      buttons: [{ type: 'PHONE_NUMBER' as const, text: 'Call', phone_number: '4155551234' }],
    };
    expect(templateComponentsSchema.safeParse([validBody, buttons]).success).toBe(false);
  });

  it('rejects two PHONE_NUMBER buttons', () => {
    const buttons = {
      type: 'BUTTONS' as const,
      buttons: [
        { type: 'PHONE_NUMBER' as const, text: 'A', phone_number: '+14155551234' },
        { type: 'PHONE_NUMBER' as const, text: 'B', phone_number: '+14155555678' },
      ],
    };
    expect(templateComponentsSchema.safeParse([validBody, buttons]).success).toBe(false);
  });
});

describe('templateNameSchema', () => {
  it('accepts lowercase + underscores + digits', () => {
    expect(templateNameSchema.safeParse('order_shipped_v2').success).toBe(true);
  });

  it('rejects uppercase / hyphens / starting with digit', () => {
    expect(templateNameSchema.safeParse('Order_Shipped').success).toBe(false);
    expect(templateNameSchema.safeParse('order-shipped').success).toBe(false);
    expect(templateNameSchema.safeParse('1order').success).toBe(false);
  });
});

describe('validateForCategory — editorial rules', () => {
  it('flags banned phrases in MARKETING bodies', () => {
    const draft: TemplateDraft = {
      ...baseDraft,
      category: 'MARKETING',
      components: [
        { type: 'BODY', text: 'Click here for guaranteed approval!' },
      ],
    };
    const issues = validateForCategory(draft);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some((i) => i.message.includes('click here'))).toBe(true);
    expect(issues.some((i) => i.message.includes('guaranteed approval'))).toBe(true);
  });

  it('flags AUTHENTICATION template with QUICK_REPLY button', () => {
    const draft: TemplateDraft = {
      ...baseDraft,
      category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', text: 'Your code is {{1}}' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'QUICK_REPLY', text: 'Resend' }],
        },
      ],
    };
    const issues = validateForCategory(draft);
    expect(issues.some((i) => i.message.includes('AUTHENTICATION'))).toBe(true);
  });

  it('warns on UTILITY with promotional language', () => {
    const draft: TemplateDraft = {
      ...baseDraft,
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Limited time discount on your order' }],
    };
    const issues = validateForCategory(draft);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });

  it('passes a clean UTILITY template', () => {
    const draft: TemplateDraft = baseDraft;
    expect(validateForCategory(draft).length).toBe(0);
  });
});

describe('validateForSubmission', () => {
  it('returns ok=true with empty editorial issues for a clean draft', () => {
    const r = validateForSubmission(baseDraft);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.editorialIssues).toEqual([]);
  });

  it('returns ok=false on schema failure', () => {
    const broken = { ...baseDraft, name: 'BadName' };
    const r = validateForSubmission(broken);
    expect(r.ok).toBe(false);
  });

  it('returns ok=true + issues on schema-valid but editorially-bad draft', () => {
    const draft = {
      ...baseDraft,
      category: 'MARKETING' as const,
      components: [{ type: 'BODY' as const, text: 'Click here for free money' }],
    };
    const r = validateForSubmission(draft);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.editorialIssues.length).toBeGreaterThan(0);
  });
});

describe('countVariables helper', () => {
  it('counts distinct {{N}} placeholders', () => {
    expect(countVariables('Hi {{1}}, order {{2}} ready, paid {{1}}')).toBe(2);
  });

  it('returns 0 for plain text', () => {
    expect(countVariables('No variables here')).toBe(0);
  });
});
