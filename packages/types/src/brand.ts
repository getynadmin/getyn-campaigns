/**
 * Phase 7 — TenantBrandProfile schemas.
 *
 * Shared between the tRPC mutation, the form client, and the agent
 * runtime that reads brand context at conversation start.
 */
import { z } from 'zod';

import { cuidSchema } from './common';

export const voiceToneSchema = z.enum([
  'PROFESSIONAL',
  'FRIENDLY',
  'CASUAL',
  'PLAYFUL',
  'AUTHORITATIVE',
  'EMPATHETIC',
]);
export type VoiceTone = z.infer<typeof voiceToneSchema>;

/** #RRGGBB or #RRGGBBAA hex.  (Local to the brand module — kept private
 *  to avoid colliding with `hexColorSchema` exported from
 *  `./contacts` for tag colors.) */
const brandHexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Expected #RRGGBB hex');

export const socialLinkSchema = z.object({
  platform: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(500),
});
export type SocialLink = z.infer<typeof socialLinkSchema>;

/** Upsert payload — every field nullable except brandName + brandDescription
 *  + primaryColor (the three things required to mark profile "complete"). */
export const brandProfileUpsertSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  brandTagline: z.string().trim().max(160).nullable().optional(),
  brandDescription: z.string().trim().min(1).max(2_000),
  primaryColor: brandHexColorSchema,
  secondaryColor: brandHexColorSchema.nullable().optional(),
  accentColor: brandHexColorSchema.nullable().optional(),
  logoAssetId: cuidSchema.nullable().optional(),
  logoUrl: z.string().trim().url().max(2_000).nullable().optional(),
  voiceTone: voiceToneSchema.default('FRIENDLY'),
  writingStyle: z.string().trim().max(2_000).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  targetAudience: z.string().trim().max(2_000).nullable().optional(),
  dosAndDonts: z.string().trim().max(2_000).nullable().optional(),
  signatureBlock: z.string().trim().max(2_000).nullable().optional(),
  socialLinks: z.array(socialLinkSchema).max(20).default([]),
  unsubscribeFooterCustom: z.string().trim().max(500).nullable().optional(),
});
export type BrandProfileUpsertInput = z.infer<typeof brandProfileUpsertSchema>;

/**
 * Stable list of voice-tone descriptions for UI dropdowns. Keep in
 * lockstep with the enum.
 */
export const VOICE_TONE_DESCRIPTIONS: Record<VoiceTone, string> = {
  PROFESSIONAL: 'Polished, measured, expert.',
  FRIENDLY: 'Warm and approachable — the default.',
  CASUAL: 'Relaxed, conversational, low-jargon.',
  PLAYFUL: 'Witty, energetic, a bit cheeky.',
  AUTHORITATIVE: 'Confident, direct, takes-a-position.',
  EMPATHETIC: 'Caring, thoughtful, slows down to listen.',
};

/**
 * The three fields that must be set for `tenantBrand.complete` to mark
 * `completedAt`. The full profile is much richer than these; this is
 * the minimum the agent needs to generate anything coherent.
 */
export function isBrandProfileComplete(p: {
  brandName?: string | null;
  brandDescription?: string | null;
  primaryColor?: string | null;
}): boolean {
  return Boolean(
    p.brandName?.trim() &&
      p.brandDescription?.trim() &&
      p.primaryColor?.trim(),
  );
}
