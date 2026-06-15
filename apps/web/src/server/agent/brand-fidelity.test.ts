/**
 * Phase 7 M6 — brand fidelity unit tests.
 *
 * The check is pure (no DB, no Anthropic). Tests cover:
 *   - allowed brand colors pass cleanly
 *   - off-brand hex codes are flagged
 *   - neutral grays + black + white are always OK
 *   - primaryUsed bit reflects whether the brand primary actually
 *     showed up anywhere in the composed JSON
 */
import { describe, expect, it } from 'vitest';

import { checkBrandFidelity } from './brand-fidelity';

const BRAND = {
  primaryColor: '#7c3aed',
  secondaryColor: null,
  accentColor: '#22c55e',
} as const;

describe('checkBrandFidelity', () => {
  it('passes when only brand + grayscale colors appear', () => {
    const result = checkBrandFidelity({
      designJson: {
        body: {
          rows: [
            { values: { linkColor: '#7c3aed' } },
            { values: { textColor: '#0f172a', backgroundColor: '#ffffff' } },
            { values: { ctaColor: '#22c55e' } },
          ],
        },
      },
      brand: BRAND,
    });
    expect(result.ok).toBe(true);
    expect(result.offBrandColors).toEqual([]);
    expect(result.primaryUsed).toBe(true);
  });

  it('flags an off-brand hex (red when brand is purple)', () => {
    const result = checkBrandFidelity({
      designJson: {
        body: {
          rows: [
            { values: { linkColor: '#7c3aed' } },
            { values: { headingColor: '#dc2626' } }, // Claude went rogue
          ],
        },
      },
      brand: BRAND,
    });
    expect(result.ok).toBe(false);
    expect(result.offBrandColors).toEqual(['#dc2626']);
  });

  it('treats near-grayscale values as allowed', () => {
    const result = checkBrandFidelity({
      designJson: { color: '#f5f5f5', color2: '#222222', color3: '#888888' },
      brand: BRAND,
    });
    expect(result.ok).toBe(true);
  });

  it('reports primaryUsed=false when the brand primary appears nowhere', () => {
    const result = checkBrandFidelity({
      designJson: {
        color: '#22c55e', // accent only, no primary
      },
      brand: BRAND,
    });
    expect(result.primaryUsed).toBe(false);
    expect(result.ok).toBe(true); // accent is still a brand color
  });

  it('is case-insensitive on hex codes', () => {
    const result = checkBrandFidelity({
      designJson: { color: '#7C3AED' },
      brand: BRAND,
    });
    expect(result.ok).toBe(true);
    expect(result.primaryUsed).toBe(true);
  });

  it('collects multiple distinct off-brand colors', () => {
    const result = checkBrandFidelity({
      designJson: {
        body: {
          rows: [
            { values: { color: '#dc2626' } },
            { values: { color: '#dc2626' } }, // duplicate — dedup
            { values: { color: '#0ea5e9' } },
          ],
        },
      },
      brand: BRAND,
    });
    expect(result.offBrandColors).toEqual(['#0ea5e9', '#dc2626']);
  });
});
