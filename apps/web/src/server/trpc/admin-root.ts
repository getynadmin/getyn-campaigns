import { adminAppSettingsRouter } from './routers/admin-app-settings';
import { adminAuditLogRouter } from './routers/admin-audit-log';
import { adminGsuiteMockRouter } from './routers/admin-gsuite-mock';
import { adminImpersonationRouter } from './routers/admin-impersonation';
import { adminPlansRouter } from './routers/admin-plans';
import { adminStaffRouter } from './routers/admin-staff';
import { adminTenantsRouter } from './routers/admin-tenants';
import { createAdminCallerFactory, createAdminRouter } from './admin-trpc';

/**
 * Phase 5 M7 — admin-tRPC root.
 *
 * Mounted at /api/admin-trpc. Separate from the customer tRPC at
 * /api/trpc so the context (StaffContext rather than TenantContext)
 * stays unambiguous and we can gate the surface independently.
 */
export const adminRouter = createAdminRouter({
  tenant: adminTenantsRouter,
  impersonation: adminImpersonationRouter,
  auditLog: adminAuditLogRouter,
  staff: adminStaffRouter,
  // Phase 5 M4 — synthetic G-Suite event firing (development /
  // pre-G-Suite-spec lifecycle exercise).
  gsuiteMock: adminGsuiteMockRouter,
  // Phase 5.5 M2 — local plan management.
  plan: adminPlansRouter,
  appSettings: adminAppSettingsRouter,
});

export type AdminRouter = typeof adminRouter;
export const createAdminCaller = createAdminCallerFactory(adminRouter);
