-- Row-Level Security baseline
--
-- Every tenant-scoped table in Getyn Campaigns is gated by RLS policies that
-- read the Postgres session variable `app.current_tenant_id`. The Node app
-- sets this variable per request (see `packages/db/src/index.ts#withTenant`)
-- *before* executing any queries inside the request's Prisma transaction.
--
-- Tables in this migration:
--   - Tenant:     a row is visible iff its `id` equals the session tenant id
--   - Membership: rows are visible iff `tenantId` equals the session tenant id
--   - Invitation: rows are visible iff `tenantId` equals the session tenant id
--
-- The User table is NOT tenant-scoped (users can belong to many tenants) and
-- therefore has no RLS policy in Phase 1. Access control for User is enforced
-- in application code (the tRPC context only exposes the current user).
--
-- Prisma runs as the database owner and by default bypasses RLS (`BYPASSRLS`
-- attribute on role). We explicitly force RLS on these tables so that even
-- the app's role is subject to the policies. This catches missing
-- `withTenant(...)` wrappers during development instead of silently leaking
-- cross-tenant data.

-- Helper: read current tenant id from session
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')
$$;

-- Tenant
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "Tenant";
CREATE POLICY tenant_isolation ON "Tenant"
  USING (id = app_current_tenant_id())
  WITH CHECK (id = app_current_tenant_id());

-- Membership
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS membership_isolation ON "Membership";
CREATE POLICY membership_isolation ON "Membership"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- Invitation
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitation_isolation ON "Invitation";
CREATE POLICY invitation_isolation ON "Invitation"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());
