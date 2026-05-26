/**
 * Phase 5 M1 — SSO claims schema.
 *
 * Auth0 issues ID tokens with our custom claims namespaced under
 * `https://getyn.com/`. We validate the signature via JWKS upstream
 * (`@/server/auth/auth0`) — this schema is the post-signature
 * structural check.
 *
 * # Required claims
 * `https://getyn.com/gsuite_tenant_id` is REQUIRED for SSO sign-ins.
 * Its absence means the Auth0 Action that injects claims is
 * misconfigured at G-Suite's side — we reject with a 400 + Sentry
 * tag rather than provisioning an orphan tenant.
 *
 * # Role claim
 * The role claim drives Membership.role on every sign-in. G-Suite
 * is the source of truth; local edits are blocked for SSO tenants
 * (Phase 5 M5).
 *
 * # Staff claim
 * `is_getyn_staff: true` flags the user as Getyn staff. The /admin
 * surface checks for this claim plus a row in StaffUser.
 */
import { z } from 'zod';

import { roleSchema } from './common';

/**
 * Plain ID-token claim set Auth0 hands us. `sub` is the Auth0 user
 * identifier; `email`, `name`, `picture` are standard OIDC claims;
 * the namespaced ones are injected by an Auth0 Rule/Action that the
 * G-Suite team owns.
 */
export const ssoClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
  name: z.string().max(200).optional(),
  picture: z.string().url().optional(),
  // Custom claims — namespaced per Auth0 convention to avoid
  // colliding with reserved OIDC claim names.
  'https://getyn.com/gsuite_tenant_id': z
    .string()
    .min(1, 'SSO is missing the gsuite_tenant_id claim. Contact support.'),
  'https://getyn.com/gsuite_org_name': z.string().min(1).max(200).optional(),
  'https://getyn.com/role': roleSchema,
  'https://getyn.com/subscription_id': z.string().optional(),
  'https://getyn.com/is_getyn_staff': z.boolean().optional(),
});

export type SsoClaims = z.infer<typeof ssoClaimsSchema>;

/**
 * Convenience accessor — turns the namespaced claim keys into plain
 * names so call sites don't have to do `claims['https://getyn.com/...']`
 * on every line.
 */
export function normalizeSsoClaims(claims: SsoClaims): {
  sub: string;
  email: string;
  emailVerified: boolean | undefined;
  name: string | undefined;
  picture: string | undefined;
  gSuiteTenantId: string;
  gSuiteOrgName: string | undefined;
  role: SsoClaims['https://getyn.com/role'];
  subscriptionId: string | undefined;
  isGetynStaff: boolean;
} {
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified,
    name: claims.name,
    picture: claims.picture,
    gSuiteTenantId: claims['https://getyn.com/gsuite_tenant_id'],
    gSuiteOrgName: claims['https://getyn.com/gsuite_org_name'],
    role: claims['https://getyn.com/role'],
    subscriptionId: claims['https://getyn.com/subscription_id'],
    isGetynStaff: Boolean(claims['https://getyn.com/is_getyn_staff']),
  };
}
