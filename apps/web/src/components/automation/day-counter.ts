/**
 * Phase 8 M2g — cumulative day counter for the builder canvas.
 *
 * Walks the graph from Trigger through Time delay nodes and assigns
 * each node a display label like "Day 0", "Day 3", "Day 3 + 4h",
 * "Day 3-7" (range when merged paths differ), or an absolute date.
 *
 * The result is a Map<nodeId, string> that the builder overlays onto
 * each node card's footer.
 *
 * Recomputed on every graph change — cheap for the realistic node
 * counts (<100). If we ever hit graphs so large this shows in a
 * flame graph, memoize on (nodes, edges) hash.
 */
import type { AutomationDefinition } from '@getyn/types';

interface Minutes {
  min: number;
  max: number;
}

const UNIT_MINUTES: Record<string, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
};

function toMinutes(amount: number | undefined, unit: string | undefined): number {
  if (!amount || !unit) return 0;
  return amount * (UNIT_MINUTES[unit] ?? 0);
}

/**
 * Format a Minutes range as "Day X" / "Day X + Yh" / "Day X-Z".
 * Both min/max are minutes from Trigger.
 */
function formatMinutes(range: Minutes): string {
  const { min, max } = range;
  const format = (m: number): string => {
    const days = Math.floor(m / (60 * 24));
    const remainderMinutes = m - days * 60 * 24;
    if (remainderMinutes === 0) return `Day ${days}`;
    const hours = Math.floor(remainderMinutes / 60);
    if (hours > 0 && remainderMinutes % 60 === 0) {
      return `Day ${days} + ${hours}h`;
    }
    return `Day ${days} + ${remainderMinutes}m`;
  };
  if (min === max) return format(min);
  return `${format(min)}–${format(max)}`;
}

export function computeDayLabels(
  def: AutomationDefinition,
): Map<string, string> {
  const labels = new Map<string, string>();
  const trigger = def.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return labels;

  // Build outgoing edges map.
  const outgoing = new Map<string, string[]>();
  for (const e of def.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
  }

  // Track known ranges per node id. Merge (union range) when reached
  // via multiple paths.
  const ranges = new Map<string, Minutes>();
  ranges.set(trigger.id, { min: 0, max: 0 });

  const stack: string[] = [trigger.id];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = def.nodes.find((n) => n.id === id);
    if (!node) continue;
    const nodeRange = ranges.get(id)!;

    // Compute this node's contribution to elapsed time.
    let delta: Minutes = { min: 0, max: 0 };
    if (node.type === 'delay') {
      const d = node.data;
      if (d.mode === 'relative') {
        const m = toMinutes(d.amount, d.unit);
        delta = { min: m, max: m };
      }
      // absolute / weekday_time: display uses the absolute date on the
      // node's own label; children continue with the same range (we
      // can't compute an offset here without knowing when the
      // enrollment starts).
    }

    const childRange: Minutes = {
      min: nodeRange.min + delta.min,
      max: nodeRange.max + delta.max,
    };

    for (const childId of outgoing.get(id) ?? []) {
      const existing = ranges.get(childId);
      if (!existing) {
        ranges.set(childId, childRange);
      } else {
        ranges.set(childId, {
          min: Math.min(existing.min, childRange.min),
          max: Math.max(existing.max, childRange.max),
        });
      }
      stack.push(childId);
    }
  }

  // Now render labels for every node with a known range, skipping
  // the Trigger (implicit Day 0).
  for (const [id, range] of ranges) {
    if (id === trigger.id) continue;
    const node = def.nodes.find((n) => n.id === id);
    if (!node) continue;
    if (node.type === 'delay' && node.data.mode === 'absolute' && node.data.absoluteAt) {
      labels.set(id, new Date(node.data.absoluteAt).toLocaleDateString());
      continue;
    }
    labels.set(id, formatMinutes(range));
  }

  return labels;
}
