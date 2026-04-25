import { cn } from '@/lib/utils';

type TagShape = { id: string; name: string; color: string };

/**
 * Pill-style tag label. Keeps text readable against any seed color by
 * picking black/white contrast from the hex. Tiny heuristic — full
 * WCAG handling can wait until we build the tag editor.
 */
export function TagChip({
  tag,
  onRemove,
  size = 'md',
}: {
  tag: TagShape;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}): JSX.Element {
  const fg = pickForeground(tag.color);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
      )}
      style={{ backgroundColor: tag.color, color: fg }}
    >
      {tag.name}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${tag.name}`}
          onClick={onRemove}
          className="ml-0.5 rounded-full px-1 leading-none opacity-70 transition-opacity hover:opacity-100"
          style={{ color: fg }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function pickForeground(hex: string): string {
  // #RGB → #RRGGBB
  const h = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  // Standard luminance proxy: YIQ is good enough for a chip.
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#111827' : '#ffffff';
}
