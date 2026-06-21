-- Email Verifier cleanup run history.
--
-- Each bulk-mark-as-unsubscribed creates one row capturing which
-- categories ran, the per-category counts, and the affected contact
-- ids. Used by the Email Verifier UI to surface a history list and
-- a per-run drill-down ("show me which 17 emails were on dead
-- domains in last Tuesday's cleanup").
--
-- affectedContactIds is a TEXT[] for the simplest possible storage.
-- A 100k-cleanup row lands at ~2.5MB — fine for the worst realistic
-- case. If we ever exceed that we'll move to a join table.

CREATE TABLE "EmailVerifierCleanupRun" (
  "id"                  TEXT         NOT NULL,
  "tenantId"            TEXT         NOT NULL,
  "runByUserId"         TEXT,
  "categories"          TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "totalCount"          INTEGER      NOT NULL DEFAULT 0,
  "countByCategory"     JSONB        NOT NULL DEFAULT '{}',
  "affectedContactIds"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailVerifierCleanupRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailVerifierCleanupRun_tenantId_createdAt_idx"
  ON "EmailVerifierCleanupRun" ("tenantId", "createdAt" DESC);

ALTER TABLE "EmailVerifierCleanupRun"
  ADD CONSTRAINT "EmailVerifierCleanupRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailVerifierCleanupRun"
  ADD CONSTRAINT "EmailVerifierCleanupRun_runByUserId_fkey"
  FOREIGN KEY ("runByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
