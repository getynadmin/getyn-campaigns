/**
 * Zod schemas for Phase 2's Suppression list.
 *
 * The list is per-tenant and keyed on `(channel, value)` — Phase 3's send
 * pipeline reads it before every send so an UNSUBSCRIBED contact can never
 * receive a message even if a stale segment includes them.
 *
 * Auto-entries land via `upsertSuppressionEntry` from `@getyn/db` whenever
 * a contact's channel status flips to UNSUBSCRIBED / BOUNCED / COMPLAINED.
 * Manual entries land through the `suppression.create` tRPC mutation —
 * useful for blocking an address that hasn't been imported as a Contact yet
 * (think: legal request to never email someone, or a known spam trap).
 */
import { z } from 'zod';

import { channelSchema } from './contacts';
import { cuidSchema } from './common';

/**
 * Reasons a row enters the suppression list. Mirrors the Prisma enum.
 *  - UNSUBSCRIBED: user opted out (we set this when emailStatus → UNSUBSCRIBED)
 *  - BOUNCED:      hard bounce / undeliverable
 *  - COMPLAINED:   marked as spam (FBL hit)
 *  - MANUAL:       admin manually added
 *  - IMPORT:       row arrived via CSV with a status that disqualified it
 */
export const suppressionReasonSchema = z.enum([
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINED',
  'MANUAL',
  'IMPORT',
]);
export type SuppressionReasonValue = z.infer<typeof suppressionReasonSchema>;

/**
 * Manual create. The UI only ever submits MANUAL — auto-paths bypass this
 * schema entirely. We re-trim + lowercase emails here so a paste with
 * stray whitespace lands canonically.
 */
export const suppressionCreateSchema = z
  .object({
    channel: channelSchema,
    value: z.string().trim().min(1).max(254),
    reason: z.literal('MANUAL').default('MANUAL'),
    note: z.string().trim().max(280).optional(),
  })
  .transform((v) => ({
    ...v,
    value: v.channel === 'EMAIL' ? v.value.toLowerCase() : v.value,
  }));
export type SuppressionCreateInput = z.infer<typeof suppressionCreateSchema>;

export const suppressionListInputSchema = z.object({
  channel: channelSchema.optional(),
  reason: suppressionReasonSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: cuidSchema.optional(),
});
export type SuppressionListInput = z.infer<typeof suppressionListInputSchema>;

/**
 * Activity timeline pagination. Caller passes a contactId; cursor is the
 * last event's id and we order by `(occurredAt desc, id desc)` so multiple
 * events on the same instant still paginate stably.
 */
export const contactEventListInputSchema = z.object({
  contactId: cuidSchema,
  limit: z.number().int().min(1).max(100).default(25),
  cursor: cuidSchema.optional(),
});
export type ContactEventListInput = z.infer<typeof contactEventListInputSchema>;
