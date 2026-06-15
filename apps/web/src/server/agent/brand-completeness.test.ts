/**
 * Phase 7 M7 — TenantBrandProfile completeness check.
 *
 * isBrandProfileComplete from @getyn/types gates agent.startConversation.
 * Worth a test so we don't loosen the bar by accident — the agent
 * needs brand name, description, and primary color to generate
 * anything coherent.
 */
import { describe, expect, it } from 'vitest';

import { isBrandProfileComplete } from '@getyn/types';

describe('isBrandProfileComplete', () => {
  it('returns true when name + description + primaryColor are all non-empty', () => {
    expect(
      isBrandProfileComplete({
        brandName: 'Acme',
        brandDescription: 'We sell widgets.',
        primaryColor: '#7c3aed',
      }),
    ).toBe(true);
  });

  it('rejects whitespace-only name', () => {
    expect(
      isBrandProfileComplete({
        brandName: '   ',
        brandDescription: 'we do things',
        primaryColor: '#7c3aed',
      }),
    ).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(
      isBrandProfileComplete({
        brandName: 'Acme',
        brandDescription: '',
        primaryColor: '#7c3aed',
      }),
    ).toBe(false);
    expect(
      isBrandProfileComplete({
        brandName: 'Acme',
        brandDescription: 'something',
        primaryColor: '',
      }),
    ).toBe(false);
  });

  it('rejects null / undefined', () => {
    expect(
      isBrandProfileComplete({
        brandName: null,
        brandDescription: 'something',
        primaryColor: '#7c3aed',
      }),
    ).toBe(false);
    expect(isBrandProfileComplete({})).toBe(false);
  });
});
