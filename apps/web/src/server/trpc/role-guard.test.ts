import { TRPCError } from '@trpc/server';
import { Role } from '@getyn/db';
import { describe, expect, it } from 'vitest';

import { assertRoleAllowed } from './trpc';

/**
 * The tRPC middleware wrapping this (`enforceRole`) also has a
 * defense-in-depth check for missing tenant context, but the policy
 * itself — "which roles can perform which mutation" — lives here.
 */
describe('assertRoleAllowed', () => {
  it('passes when the current role is in the allowlist', () => {
    expect(() =>
      assertRoleAllowed(Role.OWNER, [Role.OWNER, Role.ADMIN]),
    ).not.toThrow();
    expect(() =>
      assertRoleAllowed(Role.ADMIN, [Role.OWNER, Role.ADMIN]),
    ).not.toThrow();
  });

  it('throws FORBIDDEN when the role is not in the allowlist', () => {
    try {
      assertRoleAllowed(Role.EDITOR, [Role.OWNER, Role.ADMIN]);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects VIEWER from any OWNER/ADMIN mutation', () => {
    expect(() =>
      assertRoleAllowed(Role.VIEWER, [Role.OWNER, Role.ADMIN]),
    ).toThrow(TRPCError);
  });

  it('rejects EDITOR from OWNER-only mutations', () => {
    expect(() => assertRoleAllowed(Role.EDITOR, [Role.OWNER])).toThrow(
      TRPCError,
    );
  });

  it('treats an empty allowlist as deny-all', () => {
    expect(() => assertRoleAllowed(Role.OWNER, [])).toThrow(TRPCError);
  });
});
