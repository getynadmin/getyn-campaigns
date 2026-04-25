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

export const cuidSchema = z.string().cuid();
