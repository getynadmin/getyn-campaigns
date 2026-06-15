/**
 * Phase 7 M6 — brand fidelity check.
 *
 * Run after composeUnlayerJson produces the final design. Walks the
 * JSON tree looking for hex colors in agent-provided strings; flags
 * any that aren't the brand's primary / accent / a neutral grayscale
 * value. Returns the list so the finalizer can include them as
 * warnings (we don't block — the user can fix in the editor).
 */
import type { TenantBrandProfile } from '@getyn/db';

const HEX_COLOR_RE = /#[0-9a-fA-F]{6}\b/g;

/** HSL saturation threshold below which a color is treated as
 *  brand-neutral. Lets slate / zinc / stone text colors pass even
 *  though they have a small hue shift. 0.18 is roughly Tailwind's
 *  slate family (saturation ~14%). */
const NEUTRAL_SATURATION_MAX = 0.18;

export interface BrandFidelityResult {
  /** True when no off-brand colours were found. */
  ok: boolean;
  /** Hex codes the composer encountered that don't match brand or neutrals. */
  offBrandColors: string[];
  /** True when the brand's primary color shows up at least once. */
  primaryUsed: boolean;
}

export function checkBrandFidelity(args: {
  designJson: unknown;
  brand: Pick<
    TenantBrandProfile,
    'primaryColor' | 'secondaryColor' | 'accentColor'
  >;
}): BrandFidelityResult {
  const allowed = new Set<string>();
  for (const c of [
    args.brand.primaryColor,
    args.brand.secondaryColor,
    args.brand.accentColor,
  ]) {
    if (typeof c === 'string') allowed.add(c.toLowerCase());
  }
  const primaryLower = args.brand.primaryColor.toLowerCase();

  const found = new Set<string>();
  let primaryUsed = false;
  walk(args.designJson, (value) => {
    const matches = value.match(HEX_COLOR_RE);
    if (!matches) return;
    for (const raw of matches) {
      const hex = raw.toLowerCase();
      if (hex === primaryLower) {
        primaryUsed = true;
      }
      if (allowed.has(hex)) continue;
      if (isNeutral(hex)) continue;
      found.add(hex);
    }
  });

  return {
    ok: found.size === 0,
    offBrandColors: Array.from(found).sort(),
    primaryUsed,
  };
}

function walk(node: unknown, visit: (s: string) => void): void {
  if (typeof node === 'string') {
    visit(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) walk(v, visit);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      walk(v, visit);
    }
  }
}

/** Brand-neutral when the color has low HSL saturation, OR is so
 *  dark / so light it's clearly text or background rather than a
 *  feature color. Slate-900 + zinc-50 style values pass even though
 *  they have a small hue shift. */
function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  if ([r, g, b].some((x) => Number.isNaN(x))) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return true; // pure gray
  // Very dark (text) or very light (backgrounds) — treat as neutral
  // even when slightly tinted. HSL saturation gets inflated at the
  // extremes which would otherwise flag slate-900 / zinc-50.
  if (l < 0.2 || l > 0.9) return true;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return s <= NEUTRAL_SATURATION_MAX;
}
