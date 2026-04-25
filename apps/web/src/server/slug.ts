import { prisma } from '@getyn/db';

/**
 * Normalize an arbitrary string into a URL-safe tenant slug:
 *   - lowercased
 *   - non-alphanumerics collapsed to single hyphens
 *   - leading/trailing hyphens trimmed
 *   - clamped to at most 40 characters
 *
 * The result still needs to pass `tenantSlugSchema` validation (min 3 chars,
 * correct shape) — see `@getyn/types/common`. Callers should feed user input
 * through this and then attempt to reserve via `makeUniqueSlug`.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * Resolve a unique slug by probing the database.
 *
 * Strategy:
 *   1. If `base` is free, return it.
 *   2. Otherwise append `-2`, `-3`, … until one is free.
 *   3. After 100 failed attempts, fall back to a random 6-char suffix so we
 *      never spin forever on a contested prefix.
 *
 * This is best-effort — the DB's unique constraint on `Tenant.slug` is the
 * true source of truth, so signup still wraps the insert in a retry on
 * P2002.
 */
export async function makeUniqueSlug(base: string): Promise<string> {
  const seed = slugify(base) || 'workspace';
  // Short bases need padding so we don't end up with a 1-char slug.
  const safeSeed = seed.length >= 3 ? seed : `${seed}-ws`.slice(0, 40);

  const existing = await prisma.tenant.findUnique({
    where: { slug: safeSeed },
    select: { id: true },
  });
  if (!existing) return safeSeed;

  for (let i = 2; i <= 100; i += 1) {
    const candidate = `${safeSeed}-${i}`.slice(0, 40);
    // eslint-disable-next-line no-await-in-loop
    const hit = await prisma.tenant.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!hit) return candidate;
  }

  // Pathological fallback — vanishingly unlikely in practice.
  const random = Math.random().toString(36).slice(2, 8);
  return `${safeSeed}-${random}`.slice(0, 40);
}
