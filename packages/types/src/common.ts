import { z } from 'zod';

/** Role values mirror the Prisma `Role` enum. */
export const roleSchema = z.enum(['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']);
export type RoleValue = z.infer<typeof roleSchema>;

/** Plan values mirror the Prisma `Plan` enum. */
export const planSchema = z.enum(['TRIAL', 'STARTER', 'GROWTH', 'PRO']);
export type PlanValue = z.infer<typeof planSchema>;

/** BillingStatus values mirror the Prisma `BillingStatus` enum. */
export const billingStatusSchema = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
]);
export type BillingStatusValue = z.infer<typeof billingStatusSchema>;

/**
 * URL-safe tenant slug: lowercase alphanumerics and hyphens only,
 * must start and end with an alphanumeric, 3–40 chars.
 */
export const tenantSlugSchema = z
  .string()
  .min(3, 'Slug must be at least 3 characters')
  .max(40, 'Slug must be at most 40 characters')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug must be lowercase and contain only letters, numbers, and hyphens',
  );

export const emailSchema = z.string().email();

/**
 * Permissive ID validator.
 *
 * Originally `z.string().cuid()` — strict cuid (`c` + 24 lowercase
 * chars). Switched to a broader URL-safe charset + length range so
 * we also accept nanoid-format IDs (21 chars, mixed case, `_`/`-`)
 * produced by bulk-insert paths in the worker. The DB column is
 * just `TEXT`, so format consistency is an app-layer concern only
 * — and strict cuid validation was silently rejecting cursor
 * pagination and individual-record reads for ~20k rows imported
 * via the worker's createMany path.
 *
 * The character set (`[A-Za-z0-9_-]`) and length range (15–40) cover
 * cuid (25), cuid2 (variable), nanoid default (21), and uuid v4
 * with dashes (36).
 */
export const cuidSchema = z
  .string()
  .min(15)
  .max(40)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'ID must be 15-40 URL-safe characters (letters, digits, _, -)',
  );
