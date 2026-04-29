/**
 * WhatsApp template component schemas (Phase 4 M2 / M6).
 *
 * The shape matches Meta's Cloud API exactly — we serialize this
 * directly to Meta when submitting templates, no translation layer.
 *
 * Used by:
 *   - Authoring UI (M6) — real-time validation in React Hook Form
 *   - Server submit (M6) — re-validate before forwarding to Meta
 *   - AI draft (M7) — validate Claude's structured output, retry on failure
 *   - Webhook handler (M9) — type guard when ingesting template messages
 *
 * # Architecture note
 * The component-level Zod schemas are PLAIN ZodObjects (no superRefine)
 * so they remain compatible with `z.discriminatedUnion`. ALL the
 * cross-cutting structural validation lives in a single `superRefine`
 * on `templateComponentsSchema`. Editorial rules (banned phrases,
 * AUTH-only patterns) live separately in `validateForCategory` so
 * the editorial list can evolve without touching the schema.
 *
 * # Limits (from Meta docs as of Phase 4 kickoff)
 *   - HEADER text:  60 chars
 *   - BODY text:    1024 chars
 *   - FOOTER text:  60 chars
 *   - BUTTON text:  25 chars (per button)
 *   - BUTTONS:      max 3 per template
 *   - COPY_CODE:    example 1..15 chars
 *   - Variables:    {{1}}..{{N}}, max 10 in BODY, sequential
 *
 * # Component ordering (Meta's rule)
 *   HEADER → BODY → FOOTER → BUTTONS
 */
import { z } from 'zod';

// ------------------------------------------------------------------
// Buttons (plain objects — discriminator-compat)
// ------------------------------------------------------------------

export const quickReplyButtonSchema = z.object({
  type: z.literal('QUICK_REPLY'),
  text: z.string().trim().min(1).max(25),
});

export const urlButtonSchema = z.object({
  type: z.literal('URL'),
  text: z.string().trim().min(1).max(25),
  url: z.string().url().max(2000),
  // One example string per {{N}} placeholder in `url`.
  example: z.array(z.string().min(1)).optional(),
});

export const phoneNumberButtonSchema = z.object({
  type: z.literal('PHONE_NUMBER'),
  text: z.string().trim().min(1).max(25),
  phone_number: z
    .string()
    .regex(/^\+\d{6,15}$/, 'Phone number must be E.164 (e.g. +14155551234)'),
});

export const copyCodeButtonSchema = z.object({
  type: z.literal('COPY_CODE'),
  example: z.string().trim().min(1).max(15),
});

export const templateButtonSchema = z.discriminatedUnion('type', [
  quickReplyButtonSchema,
  urlButtonSchema,
  phoneNumberButtonSchema,
  copyCodeButtonSchema,
]);

export type TemplateButton = z.infer<typeof templateButtonSchema>;

// ------------------------------------------------------------------
// Components (plain objects — discriminator-compat)
// ------------------------------------------------------------------

const headerExampleSchema = z
  .object({
    /** When format=TEXT and the header contains {{1}} variables. */
    header_text: z.array(z.string().min(1)).optional(),
    /** When format is media. Meta returns this from media upload. */
    header_handle: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const headerComponentSchema = z.object({
  type: z.literal('HEADER'),
  format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']),
  text: z.string().max(60).optional(),
  example: headerExampleSchema.optional(),
});

export const bodyComponentSchema = z.object({
  type: z.literal('BODY'),
  text: z.string().trim().min(1).max(1024),
  example: z
    .object({
      // Outer array = per-send sample sets; inner = variable values.
      // Meta accepts >=1 set; we send one.
      body_text: z.array(z.array(z.string().min(1))).min(1).max(1),
    })
    .strict()
    .optional(),
});

export const footerComponentSchema = z.object({
  type: z.literal('FOOTER'),
  text: z.string().trim().min(1).max(60),
});

export const buttonsComponentSchema = z.object({
  type: z.literal('BUTTONS'),
  buttons: z.array(templateButtonSchema).min(1).max(3),
});

export const templateComponentSchema = z.discriminatedUnion('type', [
  headerComponentSchema,
  bodyComponentSchema,
  footerComponentSchema,
  buttonsComponentSchema,
]);

export type TemplateComponent = z.infer<typeof templateComponentSchema>;

// ------------------------------------------------------------------
// Top-level: cross-component structural rules
// ------------------------------------------------------------------

const ORDER: Record<TemplateComponent['type'], number> = {
  HEADER: 0,
  BODY: 1,
  FOOTER: 2,
  BUTTONS: 3,
};

export const templateComponentsSchema = z
  .array(templateComponentSchema)
  .min(1)
  .superRefine((components, ctx) => {
    const counts: Partial<Record<TemplateComponent['type'], number>> = {};
    for (const c of components) {
      counts[c.type] = (counts[c.type] ?? 0) + 1;
    }

    if ((counts.BODY ?? 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Template must contain exactly one BODY component.',
      });
    }
    for (const t of ['HEADER', 'FOOTER', 'BUTTONS'] as const) {
      if ((counts[t] ?? 0) > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Template may contain at most one ${t} component.`,
        });
      }
    }

    // Required ordering — strictly increasing per ORDER map.
    for (let i = 1; i < components.length; i += 1) {
      const prev = components[i - 1];
      const curr = components[i];
      if (!prev || !curr) continue;
      if (ORDER[prev.type] >= ORDER[curr.type]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i],
          message: `Components must be ordered HEADER → BODY → FOOTER → BUTTONS (got ${prev.type} before ${curr.type}).`,
        });
      }
    }

    // Per-component structural checks the inner schemas can't express
    // because they'd require superRefine (incompatible with discriminator).
    components.forEach((c, idx) => {
      if (c.type === 'HEADER') {
        validateHeader(c, idx, ctx);
      } else if (c.type === 'BODY') {
        validateBody(c, idx, ctx);
      } else if (c.type === 'BUTTONS') {
        validateButtons(c, idx, ctx);
      }
    });
  });

export type TemplateComponents = z.infer<typeof templateComponentsSchema>;

function validateHeader(
  c: Extract<TemplateComponent, { type: 'HEADER' }>,
  idx: number,
  ctx: z.RefinementCtx,
): void {
  if (c.format === 'TEXT') {
    if (!c.text || c.text.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [idx, 'text'],
        message: 'TEXT header requires non-empty text.',
      });
    }
    if (c.text && /\{\{\d+\}\}/.test(c.text)) {
      if (!c.example?.header_text || c.example.header_text.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [idx, 'example', 'header_text'],
          message: 'Header with variables requires example.header_text.',
        });
      }
    }
  } else if (c.text) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [idx, 'text'],
      message: `Header format ${c.format} does not allow text.`,
    });
  }
}

function validateBody(
  c: Extract<TemplateComponent, { type: 'BODY' }>,
  idx: number,
  ctx: z.RefinementCtx,
): void {
  const variableCount = countVariables(c.text);
  if (variableCount > 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [idx, 'text'],
      message: 'BODY may use at most 10 variables ({{1}}..{{10}}).',
    });
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(c.text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [idx, 'text'],
      message:
        'Variables must be separated by literal text (e.g. {{1}} text {{2}}).',
    });
  }
  const numbers = [...c.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
    Number(m[1]),
  );
  const sortedUnique = [...new Set(numbers)].sort((a, b) => a - b);
  for (let i = 0; i < sortedUnique.length; i += 1) {
    if (sortedUnique[i] !== i + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [idx, 'text'],
        message:
          'Variables must be sequential starting at {{1}} ({{1}}, {{2}}, ...).',
      });
      break;
    }
  }
  if (c.example) {
    const sample = c.example.body_text[0];
    if (sample && sample.length !== sortedUnique.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [idx, 'example', 'body_text'],
        message: `Example provides ${sample.length} value(s); body uses ${sortedUnique.length} variable(s).`,
      });
    }
  }
}

function validateButtons(
  c: Extract<TemplateComponent, { type: 'BUTTONS' }>,
  idx: number,
  ctx: z.RefinementCtx,
): void {
  const counts: Record<string, number> = {};
  for (const b of c.buttons) {
    counts[b.type] = (counts[b.type] ?? 0) + 1;
  }
  if ((counts.PHONE_NUMBER ?? 0) > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [idx, 'buttons'],
      message: 'A template may include at most one PHONE_NUMBER button.',
    });
  }
  if ((counts.COPY_CODE ?? 0) > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [idx, 'buttons'],
      message: 'A template may include at most one COPY_CODE button.',
    });
  }
}

// ------------------------------------------------------------------
// Top-level template draft
// ------------------------------------------------------------------

export const templateLanguageSchema = z
  .string()
  .min(2)
  .max(10)
  .regex(
    /^[a-z]{2}(_[A-Z]{2})?$/,
    'Language must be ISO 639-1, optionally with a region (e.g. en, en_US, hi, pt_BR).',
  );

export const templateNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Template name must be lowercase letters / digits / underscores, starting with a letter (e.g. order_shipped_v2).',
  );

export const templateCategorySchema = z.enum([
  'MARKETING',
  'UTILITY',
  'AUTHENTICATION',
]);

export const templateDraftSchema = z.object({
  name: templateNameSchema,
  language: templateLanguageSchema,
  category: templateCategorySchema,
  components: templateComponentsSchema,
});

export type TemplateDraft = z.infer<typeof templateDraftSchema>;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Count distinct {{N}} placeholders in a string. */
export function countVariables(text: string): number {
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  const set = new Set<string>();
  for (const m of matches) if (m[1]) set.add(m[1]);
  return set.size;
}

// ------------------------------------------------------------------
// Editorial / category-specific rules (separate from schema)
// ------------------------------------------------------------------

export interface EditorialIssue {
  path: string;
  message: string;
}

const BANNED_MARKETING_PHRASES = [
  // Placeholder list — extend in M6/M7 as Meta surfaces more in
  // rejection reasons. Case-insensitive substring match.
  'click here',
  'free money',
  'guaranteed approval',
];

export function validateForCategory(draft: TemplateDraft): EditorialIssue[] {
  const issues: EditorialIssue[] = [];

  const body = draft.components.find((c) => c.type === 'BODY');
  const buttons = draft.components.find((c) => c.type === 'BUTTONS');
  const bodyText = body && body.type === 'BODY' ? body.text : '';

  if (draft.category === 'MARKETING') {
    const lower = bodyText.toLowerCase();
    for (const phrase of BANNED_MARKETING_PHRASES) {
      if (lower.includes(phrase)) {
        issues.push({
          path: 'components.BODY.text',
          message: `MARKETING templates may not include the phrase "${phrase}".`,
        });
      }
    }
  }

  if (draft.category === 'AUTHENTICATION') {
    if (buttons && buttons.type === 'BUTTONS') {
      for (const b of buttons.buttons) {
        if (b.type !== 'COPY_CODE' && b.type !== 'URL') {
          issues.push({
            path: 'components.BUTTONS',
            message: `AUTHENTICATION templates may only use COPY_CODE or URL buttons (got ${b.type}).`,
          });
        }
      }
    }
    if (countVariables(bodyText) === 0) {
      issues.push({
        path: 'components.BODY.text',
        message:
          'AUTHENTICATION templates usually carry the OTP as {{1}}; add a variable or reconsider category.',
      });
    }
  }

  if (draft.category === 'UTILITY') {
    const promoMarkers = ['sale', 'discount', '% off', 'deal', 'limited time'];
    const lower = bodyText.toLowerCase();
    for (const marker of promoMarkers) {
      if (lower.includes(marker)) {
        issues.push({
          path: 'components.BODY.text',
          message: `UTILITY templates should be transactional; "${marker}" reads promotional — consider MARKETING.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Full submit-time validation. Schema + category rules.
 * Returns success + editorial issues, or schema failure.
 */
export function validateForSubmission(
  raw: unknown,
):
  | { ok: true; draft: TemplateDraft; editorialIssues: EditorialIssue[] }
  | { ok: false; zodError: z.ZodError } {
  const parsed = templateDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, zodError: parsed.error };
  }
  return {
    ok: true,
    draft: parsed.data,
    editorialIssues: validateForCategory(parsed.data),
  };
}
