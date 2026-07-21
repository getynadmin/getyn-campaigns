-- Phase 9 — Unified messages metric + dynamic-pricing plan
--
-- MESSAGES_PER_MONTH is a shared bucket that email + WhatsApp both
-- draw from. Existing per-channel metrics (EMAILS_PER_MONTH,
-- WA_MESSAGES_PER_MONTH) are kept for backcompat but new dynamic
-- plans meter the unified counter instead.
--
-- Dynamic pricing config lives in Plan.metadata JSON under a `pricing`
-- key, so no column changes are needed for the pricing model itself.
ALTER TYPE "PlanMetric" ADD VALUE IF NOT EXISTS 'MESSAGES_PER_MONTH';
