'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';

export interface SearchEntry {
  /** Slug path: /docs/{categorySlug}/{articleSlug} */
  href: string;
  /** "Email campaigns" — category label */
  categoryTitle: string;
  /** "Schedule a send" */
  articleTitle: string;
  /** Article summary line */
  summary: string;
  /** Lowercased haystack — title + summary + category joined. */
  haystack: string;
}

/**
 * Live-filter client search for the docs index. Pure substring match
 * over title + summary + category — small index (20-ish articles), no
 * need for a fuzzy library. If the catalogue ever grows past ~200
 * articles, swap in MiniSearch or Fuse.
 *
 * Keyboard: arrow keys move highlight, Enter navigates, Esc clears.
 * Cmd/Ctrl-K focuses the input from anywhere on the page.
 */
export function DocsSearch({
  entries,
}: {
  entries: SearchEntry[];
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl-K global focus shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Score = sum of token hits in haystack. Prefer matches in title
    // by giving article title a 3x weight via a hand-tuned prefix.
    const tokens = q.split(/\s+/).filter(Boolean);
    return entries
      .map((e) => {
        const haystack = e.haystack;
        const titleLower = e.articleTitle.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (!haystack.includes(t)) {
            score = 0;
            break;
          }
          // Title hits weighted higher.
          if (titleLower.includes(t)) score += 3;
          score += 1;
        }
        return score > 0 ? { entry: e, score } : null;
      })
      .filter((r): r is { entry: SearchEntry; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [entries, query]);

  // Reset highlight when results change.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      const target = results[highlight];
      if (target) window.location.href = target.entry.href;
    } else if (e.key === 'Escape') {
      setQuery('');
      inputRef.current?.blur();
    }
  }

  return (
    <div className="relative mx-auto max-w-xl">
      <div className="flex items-center gap-3 rounded-full border bg-card px-4 py-3 text-sm shadow-sm transition-shadow focus-within:shadow-md">
        <Search className="size-4 text-foreground/50" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search the docs…"
          className="flex-1 bg-transparent text-foreground placeholder:text-foreground/40 focus:outline-none"
          aria-label="Search docs"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="text-foreground/40 transition-colors hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : (
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/60 sm:inline">
            ⌘K
          </kbd>
        )}
      </div>

      {query.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border bg-card shadow-lg">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-foreground/60">
              No articles match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {results.map((r, i) => (
                <li key={r.entry.href}>
                  <Link
                    href={r.entry.href}
                    onMouseEnter={() => setHighlight(i)}
                    className={
                      'block px-4 py-3 transition-colors ' +
                      (i === highlight ? 'bg-muted' : 'hover:bg-muted/40')
                    }
                  >
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-foreground/50">
                      {r.entry.categoryTitle}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-3">
                      <span className="font-display text-sm font-semibold tracking-tight">
                        {r.entry.articleTitle}
                      </span>
                      <ArrowRight className="size-3.5 text-foreground/40" />
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-foreground/60">
                      {r.entry.summary}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
