import { describe, expect, it } from 'vitest';

import { slugify } from './slug';

/**
 * Pure slug normalization tests. `makeUniqueSlug` isn't covered here —
 * it touches Prisma and belongs in an integration suite.
 */
describe('slugify', () => {
  it('lowercases and collapses whitespace', () => {
    expect(slugify('Acme Inc')).toBe('acme-inc');
    expect(slugify('  Acme   Inc  ')).toBe('acme-inc');
  });

  it('strips accents and diacritics', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it('collapses runs of non-alphanumerics into single hyphens', () => {
    expect(slugify('Hello!!! World???')).toBe('hello-world');
    expect(slugify('hello/world_again.co')).toBe('hello-world-again-co');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('-- acme --')).toBe('acme');
    expect(slugify('!!!acme!!!')).toBe('acme');
  });

  it('clamps to 40 characters and does not end on a trailing hyphen', () => {
    const long = 'a'.repeat(45);
    expect(slugify(long)).toHaveLength(40);

    // A truncation that would land on a hyphen must be re-trimmed.
    const awkward = `${'a'.repeat(39)}-whatever`;
    const out = slugify(awkward);
    expect(out.endsWith('-')).toBe(false);
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('returns an empty string for all-symbols input (callers fall back)', () => {
    expect(slugify('???!!!')).toBe('');
  });
});
