'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2 } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Hit = {
  id: string;
  title: string;
  sub: string;
  chip: string;
  href: string;
};

type Section = { key: string; label: string; items: Hit[] };

/**
 * Command-palette style topbar search. ⌘K / Ctrl+K focuses the input,
 * typing (debounced 250ms) hits the `search.query` tRPC proc and
 * renders results grouped by category under an anchored popover.
 * Up/Down navigates, Enter opens, Esc closes.
 */
export function TopbarSearch(): JSX.Element {
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 250ms debounce.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(raw.trim()), 250);
    return () => window.clearTimeout(id);
  }, [raw]);

  const { data, isFetching } = api.search.query.useQuery(
    { q },
    { enabled: open && q.length > 0 },
  );

  const sections: Section[] = useMemo(() => {
    if (!data) return [];
    return [
      { key: 'campaigns', label: 'Campaigns', items: data.campaigns },
      { key: 'contacts', label: 'Contacts', items: data.contacts },
      { key: 'templates', label: 'Templates', items: data.templates },
      { key: 'segments', label: 'Segments', items: data.segments },
      { key: 'automations', label: 'Automations', items: data.automations },
    ].filter((s) => s.items.length > 0);
  }, [data]);

  const flat: Hit[] = useMemo(
    () => sections.flatMap((s) => s.items),
    [sections],
  );

  // Clamp cursor when results change.
  useEffect(() => {
    if (cursor >= flat.length) setCursor(0);
  }, [cursor, flat.length]);

  // ⌘K / Ctrl+K focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(t)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = (h: Hit): void => {
    setOpen(false);
    setRaw('');
    router.push(h.href);
  };

  return (
    <div ref={wrapRef} className="relative hidden md:block">
      <div
        className={cn(
          'flex h-9 w-72 items-center gap-2 rounded-lg border bg-background px-2.5 text-xs text-muted-foreground transition-colors focus-within:border-violet-500/40 focus-within:bg-card',
        )}
      >
        <Search className="size-3.5" />
        <input
          ref={inputRef}
          type="text"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, Math.max(0, flat.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === 'Enter') {
              const h = flat[cursor];
              if (h) go(h);
            }
          }}
          placeholder="Search campaigns, contacts, templates…"
          className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1 text-[10px] text-muted-foreground lg:inline">
          ⌘K
        </kbd>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] w-96 overflow-y-auto rounded-xl border bg-popover p-2 text-sm text-popover-foreground shadow-xl">
          {q.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Start typing… <br />
              <span className="mt-1 inline-block opacity-70">
                ↑↓ navigate · Enter open · Esc close
              </span>
            </div>
          ) : isFetching && !data ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Searching…
            </div>
          ) : sections.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing matches "{q}".
            </div>
          ) : (
            <>
              {sections.map((s) => {
                return (
                  <div key={s.key} className="mb-1 last:mb-0">
                    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    {s.items.map((h) => {
                      const idx = flat.indexOf(h);
                      const active = idx === cursor;
                      return (
                        <button
                          key={`${s.key}-${h.id}`}
                          type="button"
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => go(h)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                            active ? 'bg-muted' : 'hover:bg-muted/60',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-foreground">
                              {h.title}
                            </div>
                            {h.sub ? (
                              <div className="truncate text-[10px] text-muted-foreground">
                                {h.sub}
                              </div>
                            ) : null}
                          </div>
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {h.chip}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
