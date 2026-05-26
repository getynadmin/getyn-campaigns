/**
 * Phase 5 M1 — SSO claims schema coverage.
 *
 * Validates that the Zod schema rejects missing/malformed claims
 * with helpful messages (the callback route surfaces a 400 +
 * `?error=sso_misconfigured` when this throws) and accepts the
 * shape Auth0 actually produces.
 *
 * The signature-verification path (jose / JWKS) is tested separately
 * via integration — here we focus on the post-verify Zod gate.
 */
import { describe, expect, it } from 'vitest';

import { normalizeSsoClaims, ssoClaimsSchema } from '@getyn/types';

function validClaims(overrides: Record<string, unknown> = {}): unknown {
  return {
    sub: 'auth0|abc123',
    email: 'jane@acme.test',
    email_verified: true,
    name: 'Jane Acme',
    picture: 'https://cdn.example.test/jane.png',
    'https://getyn.com/gsuite_tenant_id': 'gst_acme',
    'https://getyn.com/gsuite_org_name': 'Acme Inc',
    'https://getyn.com/role': 'OWNER',
    'https://getyn.com/subscription_id': 'sub_abc',
    ...overrides,
  };
}

describe('ssoClaimsSchema', () => {
  it('accepts a well-formed claim set', () => {
    const result = ssoClaimsSchema.safeParse(validClaims());
    expect(result.success).toBe(true);
  });

  it('rejects missing gsuite_tenant_id (claim absent)', () => {
    const result = ssoClaimsSchema.safeParse(
      validClaims({ 'https://getyn.com/gsuite_tenant_id': undefined }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      // Path identifies the failing claim even if Zod's default
      // message is just "Required" for absent fields.
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('https://getyn.com/gsuite_tenant_id');
    }
  });

  it('rejects empty gsuite_tenant_id with our custom message', () => {
    const result = ssoClaimsSchema.safeParse(
      validClaims({ 'https://getyn.com/gsuite_tenant_id': '' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join('\n');
      expect(msg).toMatch(/gsuite_tenant_id/);
    }
  });

  it('rejects unknown role values (defends against IdP drift)', () => {
    const result = ssoClaimsSchema.safeParse(
      validClaims({ 'https://getyn.com/role': 'SUPER_ADMIN' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects malformed email', () => {
    const result = ssoClaimsSchema.safeParse(
      validClaims({ email: 'not-an-email' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts when optional claims are absent', () => {
    const result = ssoClaimsSchema.safeParse(
      validClaims({
        name: undefined,
        picture: undefined,
        'https://getyn.com/gsuite_org_name': undefined,
        'https://getyn.com/subscription_id': undefined,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects sub that is empty', () => {
    const result = ssoClaimsSchema.safeParse(validClaims({ sub: '' }));
    expect(result.success).toBe(false);
  });
});

describe('normalizeSsoClaims', () => {
  it('translates namespaced keys into plain accessors', () => {
    const parsed = ssoClaimsSchema.parse(validClaims());
    const n = normalizeSsoClaims(parsed);
    expect(n.gSuiteTenantId).toBe('gst_acme');
    expect(n.gSuiteOrgName).toBe('Acme Inc');
    expect(n.role).toBe('OWNER');
    expect(n.subscriptionId).toBe('sub_abc');
    expect(n.isGetynStaff).toBe(false);
  });

  it('defaults isGetynStaff to false when claim is absent', () => {
    const parsed = ssoClaimsSchema.parse(validClaims());
    expect(normalizeSsoClaims(parsed).isGetynStaff).toBe(false);
  });

  it('passes through isGetynStaff=true', () => {
    const parsed = ssoClaimsSchema.parse(
      validClaims({ 'https://getyn.com/is_getyn_staff': true }),
    );
    expect(normalizeSsoClaims(parsed).isGetynStaff).toBe(true);
  });
});
