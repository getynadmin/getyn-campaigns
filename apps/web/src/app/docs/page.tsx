import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';

import { DocsSearch } from '@/components/docs/docs-search';
import { buildSearchIndex, categories } from '@/lib/docs/articles';

export default function DocsIndexPage(): JSX.Element {
  const totalArticles = categories.reduce(
    (sum, c) => sum + c.articles.length,
    0,
  );
  const searchIndex = buildSearchIndex();

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <div className="mb-12 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs text-foreground/70">
          <BookOpen className="size-3.5" />
          {totalArticles} articles · {categories.length} categories
        </div>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Getyn Campaigns docs
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-foreground/70">
          Guides, walkthroughs, and reference material for everything you can
          do inside Getyn Campaigns — from your first import to A/B-testing
          subject lines on autopilot.
        </p>
        <div className="mt-8">
          <DocsSearch entries={searchIndex} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((category) => (
          <Link
            key={category.slug}
            href={`/docs/${category.slug}`}
            className="group flex flex-col rounded-xl border bg-card p-6 transition-all hover:border-foreground/30 hover:shadow-md"
          >
            <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-muted text-xl">
              {category.icon}
            </div>
            <h2 className="font-display text-lg font-semibold tracking-tight">
              {category.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/70">
              {category.description}
            </p>
            <div className="mt-4 flex items-center justify-between text-xs">
              <span className="text-foreground/50">
                {category.articles.length} articles
              </span>
              <span className="inline-flex items-center gap-1 text-foreground/70 transition-colors group-hover:text-foreground">
                Browse
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-14 rounded-xl border bg-muted/30 px-6 py-8 text-center">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Can&rsquo;t find what you&rsquo;re looking for?
        </h2>
        <p className="mt-1.5 text-sm text-foreground/70">
          Reach out to the team — we read every message.
        </p>
        <div className="mt-4 flex justify-center gap-3 text-sm">
          <a
            href="https://getyn.com/contact"
            className="rounded-md border bg-background px-4 py-2 font-medium text-foreground/80 hover:text-foreground"
          >
            Contact support
          </a>
          <a
            href="https://community.getyn.com"
            className="rounded-md border bg-background px-4 py-2 font-medium text-foreground/80 hover:text-foreground"
          >
            Join community
          </a>
        </div>
      </div>
    </div>
  );
}
