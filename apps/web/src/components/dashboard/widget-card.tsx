'use client';

import type { ReactNode } from 'react';
import { GripVertical, MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Shared shell for every dashboard widget. Owns the title bar, drag
 * handle, hide button, and provides a consistent card chrome so each
 * widget only has to render its own body content.
 *
 * `editing` turns the handle visible + makes the whole card the drag
 * trigger; in view mode the card renders static.
 */
export function WidgetCard({
  title,
  description,
  size = 'md',
  editing,
  onHide,
  dragHandleProps,
  children,
}: {
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  editing?: boolean;
  onHide?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  children: ReactNode;
}): JSX.Element {
  const col = size === 'lg' ? 'md:col-span-2 xl:col-span-3' : size === 'md' ? 'xl:col-span-2' : '';
  return (
    <div
      className={cn(
        'group relative flex min-h-[180px] flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md',
        col,
        editing && 'ring-1 ring-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {description ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {editing ? (
          <div className="flex shrink-0 items-center gap-1">
            {onHide ? (
              <button
                type="button"
                onClick={onHide}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Hide
              </button>
            ) : null}
            <button
              type="button"
              {...dragHandleProps}
              aria-label="Drag to reorder"
              className="grid size-7 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Widget options"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            tabIndex={-1}
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}

/**
 * Standard "no data yet — do this" state for a widget body. Always
 * include a direct CTA; empty charts are never shown bare.
 */
export function WidgetEmpty({
  icon,
  title,
  cta,
}: {
  icon: ReactNode;
  title: string;
  cta?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
      <div className="text-muted-foreground/60">{icon}</div>
      <p className="text-sm text-muted-foreground">{title}</p>
      {cta}
    </div>
  );
}
