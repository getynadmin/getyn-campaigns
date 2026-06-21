'use client';

import { useEffect, useState } from 'react';

import type { ExtractedHeading } from '@/lib/docs/headings';

/**
 * Right-rail table of contents for an article. Headings come from
 * server-side extraction; the only client work is the IntersectionObserver
 * that tracks which heading is currently in view and highlights it.
 *
 * Hidden when there are fewer than 2 headings — single-section articles
 * don't need a TOC.
 */
export function ArticleToc({
  headings,
}: {
  headings: ExtractedHeading[];
}): JSX.Element | null {
  const [activeId, setActiveId] = useState<string | null>(
    headings[0]?.id ?? null,
  );

  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost heading currently intersecting the upper
        // half of the viewport. Smoother than first-intersected.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // Trigger when heading crosses the top quarter of the viewport
        // — feels natural while reading.
        rootMargin: '-15% 0px -70% 0px',
        threshold: 0,
      },
    );

    const nodes = headings
      .map((h) => document.getElementById(h.id))
      .filter((n): n is HTMLElement => n !== null);
    for (const n of nodes) observer.observe(n);
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <nav
      aria-label="On this page"
      className="sticky top-24 hidden text-sm lg:block"
    >
      <h4 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-foreground/50">
        On this page
      </h4>
      <ul className="space-y-1">
        {headings.map((h) => {
          const active = h.id === activeId;
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={
                  'block rounded px-2 py-1 transition-colors ' +
                  (h.level === 3 ? 'ml-3 text-[13px] ' : '') +
                  (active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-foreground/60 hover:bg-muted/50 hover:text-foreground')
                }
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
