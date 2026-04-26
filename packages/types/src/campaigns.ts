/**
 * Zod schemas for Phase 3: email builder, send pipeline, campaign analytics.
 *
 * One file covers inputs across M2–M8 so the router scaffolding doesn't have
 * to chase imports across multiple modules. Enums mirror Prisma 1:1.
 */
import { z } from 'zod';

import { cuidSchema } from './common';

// ---------------------------------------------------------------------------
// Enums (mirror Prisma)
// ---------------------------------------------------------------------------

export const sendingDomainStatusSchema = z.enum([
  'PENDING',
  'VERIFIED',
  'FAILED',
  'SUSPENDED',
]);
export type SendingDomainStatusValue = z.infer<typeof sendingDomainStatusSchema>;

export const campaignTypeSchema = z.enum(['EMAIL', 'WHATSAPP', 'SMS']);
export type CampaignTypeValue = z.infer<typeof campaignTypeSchema>;

export const campaignStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'PAUSED',
  'FAILED',
  'CANCELED',
]);
export type CampaignStatusValue = z.infer<typeof campaignStatusSchema>;

export const emailTemplateCategorySchema = z.enum([
  'NEWSLETTER',
  'ANNOUNCEMENT',
  'PROMOTIONAL',
  'TRANSACTIONAL',
  'EVENT',
  'WELCOME',
  'OTHER',
]);
export type EmailTemplateCategoryValue = z.infer<
  typeof emailTemplateCategorySchema
>;

export const campaignSendStatusSchema = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'SUPPRESSED',
]);
export type CampaignSendStatusValue = z.infer<typeof campaignSendStatusSchema>;

export const abVariantSchema = z.enum(['A', 'B']);
export type AbVariantValue = z.infer<typeof abVariantSchema>;

export const campaignEventTypeSchema = z.enum([
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'COMPLAINED',
  'UNSUBSCRIBED',
  'FAILED',
]);
export type CampaignEventTypeValue = z.infer<typeof campaignEventTypeSchema>;

// ---------------------------------------------------------------------------
// SendingDomain — DNS records JSON column shape
// ---------------------------------------------------------------------------

/**
 * Each entry comes back from Resend's domain-create API. We display the
 * `value` for the user to paste into their DNS provider, then re-poll
 * until each entry's `status` flips to "verified".
 *
 * MX records have an additional `priority` integer; TXT/CNAME do not.
 * `record` is Resend's category tag (SPF / DKIM) — purely informational.
 *
 * Schema uses `passthrough()` so we round-trip any future Resend fields
 * without a code change.
 */
export const sendingDomainDnsRecordSchema = z
  .object({
    type: z.enum(['MX', 'TXT', 'CNAME']),
    name: z.string().min(1).max(253),
    value: z.string().min(1).max(4096),
    status: z
      .enum([
        'pending',
        'verified',
        'failed',
        'temporary_failure',
        'not_started',
      ])
      .default('pending'),
    priority: z.number().int().min(0).max(65535).optional(),
    ttl: z.string().optional(),
    record: z.string().optional(), // Resend's "SPF" / "DKIM" tag
  })
  .passthrough();
export type SendingDomainDnsRecord = z.infer<
  typeof sendingDomainDnsRecordSchema
>;

export const sendingDomainDnsRecordsSchema = z.array(
  sendingDomainDnsRecordSchema,
);

// ---------------------------------------------------------------------------
// SendingDomain — tRPC inputs (M2)
// ---------------------------------------------------------------------------

const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(
    /^(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*(?<!-)$/,
    'Invalid domain name',
  );

export const sendingDomainCreateSchema = z.object({
  domain: domainNameSchema,
});
export type SendingDomainCreateInput = z.infer<
  typeof sendingDomainCreateSchema
>;

export const sendingDomainVerifySchema = z.object({
  id: cuidSchema,
});
export type SendingDomainVerifyInput = z.infer<
  typeof sendingDomainVerifySchema
>;

export const sendingDomainDeleteSchema = z.object({
  id: cuidSchema,
});

export const sendingDomainListInputSchema = z.object({
  status: sendingDomainStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: cuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// EmailTemplate — tRPC inputs (M4)
// ---------------------------------------------------------------------------

/**
 * Unlayer's design payload is opaque to us — we round-trip it to/from the
 * editor untouched. We only assert it's a JSON object, not an array or null.
 * The editor itself enforces structural validity.
 */
export const unlayerDesignJsonSchema = z
  .record(z.unknown())
  .refine((v) => v !== null && typeof v === 'object' && !Array.isArray(v), {
    message: 'designJson must be a JSON object',
  });

const emailTemplateNameSchema = z.string().trim().min(1).max(120);
const emailTemplateDescriptionSchema = z.string().trim().max(280).optional();

export const emailTemplateCreateSchema = z.object({
  name: emailTemplateNameSchema,
  description: emailTemplateDescriptionSchema,
  category: emailTemplateCategorySchema.default('OTHER'),
  thumbnailUrl: z.string().url().optional(),
  designJson: unlayerDesignJsonSchema,
});
export type EmailTemplateCreateInput = z.infer<
  typeof emailTemplateCreateSchema
>;

/**
 * Template IDs are looser than cuid because the seed inserts deterministic
 * IDs like `seed-tpl-welcome` (so `pnpm db:seed` is idempotent across
 * re-runs). cuid validation would reject those for the system templates,
 * so the duplicate / get / update / delete inputs accept any short string.
 * The DB lookup returns null for unknown IDs and the procedures throw
 * NOT_FOUND there — same UX as a strict regex.
 */
const templateIdSchema = z.string().trim().min(1).max(64);

export const emailTemplateUpdateSchema = z.object({
  id: templateIdSchema,
  patch: z
    .object({
      name: emailTemplateNameSchema,
      description: emailTemplateDescriptionSchema,
      category: emailTemplateCategorySchema,
      thumbnailUrl: z.string().url().optional(),
      designJson: unlayerDesignJsonSchema,
    })
    .partial(),
});

export const emailTemplateDeleteSchema = z.object({ id: templateIdSchema });
export const emailTemplateGetSchema = z.object({ id: templateIdSchema });
export const emailTemplateDuplicateSchema = z.object({ id: templateIdSchema });

export const emailTemplateListInputSchema = z.object({
  /** "ALL" merges system + tenant; "SYSTEM" only system; "TENANT" only this tenant's. */
  scope: z.enum(['ALL', 'SYSTEM', 'TENANT']).default('ALL'),
  category: emailTemplateCategorySchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(24),
  cursor: cuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// EmailCampaign — A/B test config (stored on EmailCampaign.abTest JSON)
// ---------------------------------------------------------------------------

const abVariantBodySchema = z.object({
  id: abVariantSchema,
  subject: z.string().trim().min(1).max(200),
});

/**
 * A/B test descriptor. When `enabled === true`, the send pipeline splits
 * `2 * testPercent` of the segment into the test cohort (half to each
 * variant), waits `winnerDecisionAfterMinutes`, then sends the rest with
 * the winning variant.
 *
 * Pushback #5: no statistical significance test for MVP. Pick the
 * variant with higher metric, tie goes to A, with `minSendsPerVariant`
 * minimum sample size — otherwise fall back to A.
 */
export const abTestSchema = z
  .object({
    enabled: z.literal(true),
    variants: z
      .tuple([abVariantBodySchema, abVariantBodySchema])
      .refine((vs) => vs[0].subject !== vs[1].subject, {
        message: 'Variants must have different subjects',
      }),
    testPercent: z.number().int().min(10).max(50),
    winnerMetric: z.enum(['open_rate', 'click_rate']).default('open_rate'),
    winnerDecisionAfterMinutes: z.number().int().min(60).max(2880),
    status: z
      .enum(['pending', 'testing', 'winner_selected', 'completed'])
      .default('pending'),
    winnerVariantId: abVariantSchema.nullable().default(null),
    winnerDecidedAt: z.string().datetime().nullable().default(null),
    minSendsPerVariant: z.number().int().min(50).max(10_000).default(100),
  })
  .superRefine((v, ctx) => {
    // testPercent cap is a soft check: 2 * testPercent must leave at least
    // 10% for the winner cohort. testPercent <= 45 is enforced.
    if (v.testPercent > 45) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['testPercent'],
        message:
          'testPercent must be <= 45 so the winning cohort has at least 10% of recipients',
      });
    }
  });
export type AbTest = z.infer<typeof abTestSchema>;

// ---------------------------------------------------------------------------
// CampaignEvent — per-type metadata schemas
// ---------------------------------------------------------------------------

/**
 * `CampaignEvent.metadata` is JSON. The webhook handler validates each
 * incoming event with the schema for its type before insert. Unknown
 * fields pass through (forward-compatible with new Resend fields).
 */
export const campaignEventMetadataSchemas = {
  SENT: z
    .object({
      provider: z.string().optional(),
      providerMessageId: z.string().optional(),
    })
    .passthrough(),
  DELIVERED: z
    .object({
      timestamp: z.string().datetime().optional(),
      recipient: z.string().email().optional(),
    })
    .passthrough(),
  OPENED: z
    .object({
      userAgent: z.string().optional(),
      ip: z.string().optional(),
    })
    .passthrough(),
  CLICKED: z
    .object({
      url: z.string().url(),
      trackingLinkId: cuidSchema.optional(),
      userAgent: z.string().optional(),
      ip: z.string().optional(),
      referer: z.string().optional(),
    })
    .passthrough(),
  BOUNCED: z
    .object({
      bounceCode: z.string().optional(),
      bounceReason: z.string().optional(),
      recipient: z.string().email().optional(),
    })
    .passthrough(),
  COMPLAINED: z
    .object({
      complaintType: z.string().optional(),
      recipient: z.string().email().optional(),
    })
    .passthrough(),
  UNSUBSCRIBED: z
    .object({
      via: z.enum(['link', 'list_unsubscribe', 'manual']).optional(),
    })
    .passthrough(),
  FAILED: z
    .object({
      errorCode: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .passthrough(),
} as const;

// ---------------------------------------------------------------------------
// Campaign — tRPC inputs (M5)
// ---------------------------------------------------------------------------

const emailFromAddressSchema = z.string().trim().toLowerCase().email().max(254);
const emailReplyToSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Wizard step 3 settings — referenced by both create and update procedures.
 */
const campaignSettingsSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  previewText: z.string().trim().max(150).optional(),
  fromName: z.string().trim().min(1).max(80),
  fromEmail: emailFromAddressSchema,
  replyTo: emailReplyToSchema.optional(),
  /** Required if `Tenant.plan === 'STARTER'` is to be overridden — otherwise null = shared sending. */
  sendingDomainId: cuidSchema.nullable().optional(),
  abTest: abTestSchema.nullable().optional(),
  trackingEnabled: z.boolean().default(true),
});

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: campaignTypeSchema.default('EMAIL'),
  segmentId: cuidSchema,
  settings: campaignSettingsSchema,
  designJson: unlayerDesignJsonSchema,
  templateId: cuidSchema.optional(),
});
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignUpdateSchema = z.object({
  id: cuidSchema,
  patch: z
    .object({
      name: z.string().trim().min(1).max(120),
      segmentId: cuidSchema,
      settings: campaignSettingsSchema.partial(),
      designJson: unlayerDesignJsonSchema,
    })
    .partial(),
});

export const campaignScheduleSchema = z.object({
  id: cuidSchema,
  /** ISO 8601 with TZ offset, must be in the future at the tenant's timezone. */
  scheduledAt: z.string().datetime(),
});

export const campaignSendNowSchema = z.object({ id: cuidSchema });
export const campaignCancelSchema = z.object({ id: cuidSchema });
export const campaignDeleteSchema = z.object({ id: cuidSchema });
export const campaignGetSchema = z.object({ id: cuidSchema });

export const campaignListInputSchema = z.object({
  status: campaignStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
  segmentId: cuidSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: cuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Campaign — test send (M3) and analytics (M8)
// ---------------------------------------------------------------------------

export const campaignSendTestSchema = z.object({
  id: cuidSchema,
  /** Up to 5 recipient emails for a test send. Bypasses queue, marks as test. */
  recipients: z.array(z.string().email()).min(1).max(5),
});

export const campaignAnalyticsSummaryInputSchema = z.object({
  campaignId: cuidSchema,
});

export const campaignAnalyticsTimeSeriesInputSchema = z.object({
  campaignId: cuidSchema,
  /** Hour-bucketed for the first 72h, day-bucketed after. The client picks. */
  granularity: z.enum(['hour', 'day']).default('hour'),
  /** ISO start/end. Defaults to (sentAt, sentAt + 7d) on the server. */
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

export const campaignAnalyticsTopLinksInputSchema = z.object({
  campaignId: cuidSchema,
  limit: z.number().int().min(1).max(50).default(10),
});

export const campaignRecipientsInputSchema = z.object({
  campaignId: cuidSchema,
  status: campaignSendStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: cuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Tenant — sending settings (M9 polish; surface in /t/[slug]/settings)
// ---------------------------------------------------------------------------

export const tenantSendingSettingsUpdateSchema = z.object({
  postalAddress: z.string().trim().min(5).max(500).nullable().optional(),
  companyDisplayName: z.string().trim().min(1).max(120).nullable().optional(),
  defaultFromName: z.string().trim().min(1).max(80).nullable().optional(),
});
