/**
 * Zod schemas for Phase 2: contacts, tags, custom fields.
 *
 * These are the single source of truth for tRPC input validation and
 * React Hook Form resolvers. Enum values mirror Prisma's generated enums
 * 1:1 so TS inference through the tRPC router returns the Prisma types.
 */
import { z } from 'zod';

import { cuidSchema } from './common';

// ---------------------------------------------------------------------------
// Enums (mirror Prisma)
// ---------------------------------------------------------------------------

export const contactSourceSchema = z.enum(['MANUAL', 'IMPORT', 'API', 'FORM']);
export type ContactSourceValue = z.infer<typeof contactSourceSchema>;

export const subscriptionStatusSchema = z.enum([
  'SUBSCRIBED',
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINED',
  'PENDING',
]);
export type SubscriptionStatusValue = z.infer<typeof subscriptionStatusSchema>;

export const customFieldTypeSchema = z.enum([
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
]);
export type CustomFieldTypeValue = z.infer<typeof customFieldTypeSchema>;

export const channelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP']);
export type ChannelValue = z.infer<typeof channelSchema>;

// ---------------------------------------------------------------------------
// Primitive field schemas — reused across contact create / update / import
// ---------------------------------------------------------------------------

/**
 * Lowercased, trimmed email. Empty string normalises to undefined so the UI
 * can send "" from an unfilled input without us having to special-case it.
 */
export const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email')
  .max(254)
  .optional()
  .or(z.literal('').transform(() => undefined));

/**
 * E.164-shaped phone. We don't normalise here — the app layer uses
 * libphonenumber-js on write (see TODO in contacts router) to handle country
 * inference. For now, accept anything that *looks* like a phone number: at
 * least one digit, optional leading +, no letters.
 */
export const contactPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9()\s.-]{4,20}$/, 'Invalid phone number')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const contactNameSchema = z
  .string()
  .trim()
  .max(80)
  .optional()
  .or(z.literal('').transform(() => undefined));

/**
 * Free-form JSON bag keyed by `CustomField.key`. Keys must exist in the
 * tenant's CustomField registry — enforced in the router, not here.
 *
 * Values may be string | number | boolean | null. Stricter typing per
 * field.type is handled by the router against the registry.
 */
export const customFieldValuesSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>;

/**
 * Hex color for tag chips. Accepts `#RGB` and `#RRGGBB`, case-insensitive.
 */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Invalid hex color');

// ---------------------------------------------------------------------------
// Contact — create / update
// ---------------------------------------------------------------------------

/**
 * Shared body for create + update. `superRefine` enforces "email OR phone
 * must be present" — the DB check is only a partial unique index, it can't
 * express this invariant.
 */
const contactBodySchema = z.object({
  email: contactEmailSchema,
  phone: contactPhoneSchema,
  firstName: contactNameSchema,
  lastName: contactNameSchema,
  language: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/, 'Expected e.g. "en" or "en-US"')
    .optional(),
  timezone: z.string().trim().max(64).optional(),
  source: contactSourceSchema.optional(),
  emailStatus: subscriptionStatusSchema.optional(),
  smsStatus: subscriptionStatusSchema.optional(),
  whatsappStatus: subscriptionStatusSchema.optional(),
  tagIds: z.array(cuidSchema).max(50).optional(),
  customFields: customFieldValuesSchema.optional(),
});

export const contactCreateSchema = contactBodySchema.superRefine((data, ctx) => {
  if (!data.email && !data.phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide at least an email or a phone number.',
      path: ['email'],
    });
  }
});
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

export const contactUpdateSchema = z.object({
  id: cuidSchema,
  patch: contactBodySchema.partial(),
});
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

// ---------------------------------------------------------------------------
// Contact — list query
// ---------------------------------------------------------------------------

/**
 * `status` is a coarse filter across all channels; fine-grained status
 * filters will be added via the segment builder in Milestone 6.
 */
export const contactListInputSchema = z.object({
  /** Free-text search across email, phone, firstName, lastName. */
  search: z.string().trim().max(120).optional(),
  /** Any-of match: a contact qualifies if it has any of the given tag ids. */
  tagIds: z.array(cuidSchema).max(50).optional(),
  /** Matches on `emailStatus` only today; phone/WhatsApp get separate filters later. */
  emailStatus: subscriptionStatusSchema.optional(),
  source: contactSourceSchema.optional(),
  /** Include soft-deleted contacts (Owners/Admins only — enforced in router). */
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  /** Cursor = contact id. We order by (createdAt desc, id desc) for stability. */
  cursor: cuidSchema.optional(),
});
export type ContactListInput = z.infer<typeof contactListInputSchema>;

// ---------------------------------------------------------------------------
// Tag — CRUD
// ---------------------------------------------------------------------------

export const tagNameSchema = z.string().trim().min(1).max(40);

export const tagCreateSchema = z.object({
  name: tagNameSchema,
  color: hexColorSchema,
});
export type TagCreateInput = z.infer<typeof tagCreateSchema>;

export const tagUpdateSchema = z.object({
  id: cuidSchema,
  name: tagNameSchema.optional(),
  color: hexColorSchema.optional(),
});
export type TagUpdateInput = z.infer<typeof tagUpdateSchema>;

export const tagAssignSchema = z.object({
  contactId: cuidSchema,
  tagId: cuidSchema,
});
export type TagAssignInput = z.infer<typeof tagAssignSchema>;

// ---------------------------------------------------------------------------
// CustomField — CRUD
// ---------------------------------------------------------------------------

/**
 * Slug-safe key: lowercase letters, digits, underscores, 2–40 chars.
 * Matches how Postgres-friendly JSON keys look across the rest of the app.
 */
export const customFieldKeySchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]{1,39}$/,
    'Use lowercase letters, digits, and underscores (2–40 chars, must start with a letter).',
  );

/** Options bag. Only SELECT uses `choices`; others pass `null`. */
export const customFieldOptionsSchema = z
  .object({
    choices: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
  })
  .nullable();
export type CustomFieldOptions = z.infer<typeof customFieldOptionsSchema>;

export const customFieldCreateSchema = z
  .object({
    key: customFieldKeySchema,
    label: z.string().trim().min(1).max(60),
    type: customFieldTypeSchema,
    options: customFieldOptionsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'SELECT') {
      if (!data.options || !data.options.choices?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SELECT fields require at least one choice.',
          path: ['options'],
        });
      }
    } else if (data.options && data.options !== null) {
      // Silently drop non-null options for non-SELECT types — we store null.
    }
  });
export type CustomFieldCreateInput = z.infer<typeof customFieldCreateSchema>;

/**
 * `type` is intentionally absent — it's immutable post-creation. To change
 * a field's type, delete and recreate; that forces explicit handling of
 * downstream value coercion.
 */
export const customFieldUpdateSchema = z.object({
  id: cuidSchema,
  label: z.string().trim().min(1).max(60).optional(),
  options: customFieldOptionsSchema.optional(),
});
export type CustomFieldUpdateInput = z.infer<typeof customFieldUpdateSchema>;
