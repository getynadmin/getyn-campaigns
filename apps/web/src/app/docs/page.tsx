import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  LifeBuoy,
  MessageSquareText,
  Sparkles,
} from 'lucide-react';

import { DocsSearch } from '@/components/docs/docs-search';
import { buildSearchIndex, categories } from '@/lib/docs/articles';

/**
 * Category tile accent colors. Each category slug maps to a soft
 * surface + icon tint so the index reads as a true knowledge-base
 * landing page rather than a flat grid. Falls back to muted for any
 * slug not in the map (so adding a new category never breaks the
 * build).
 */
const CATEGORY_ACCENT: Record<
  string,
  { surface: string; ring: string; iconBg: string; iconFg: string; chip: string }
> = {
  'getting-started': {
    surface:
      'from-emerald-50 to-white dark:from-emerald-950/30 dark:to-background',
    ring: 'hover:border-emerald-300 dark:hover:border-emerald-800',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950/60',
    iconFg: 'text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  },
  'email-campaigns': {
    surface: 'from-sky-50 to-white dark:from-sky-950/30 dark:to-background',
    ring: 'hover:border-sky-300 dark:hover:border-sky-800',
    iconBg: 'bg-sky-100 dark:bg-sky-950/60',
    iconFg: 'text-sky-700 dark:text-sky-300',
    chip: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  },
  'contacts-and-segments': {
    surface:
      'from-violet-50 to-white dark:from-violet-950/30 dark:to-background',
    ring: 'hover:border-violet-300 dark:hover:border-violet-800',
    iconBg: 'bg-violet-100 dark:bg-violet-950/60',
    iconFg: 'text-violet-700 dark:text-violet-300',
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
  },
  'ai-and-integrations': {
    surface: 'from-amber-50 to-white dark:from-amber-950/30 dark:to-background',
    ring: 'hover:border-amber-300 dark:hover:border-amber-800',
    iconBg: 'bg-amber-100 dark:bg-amber-950/60',
    iconFg: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  },
};

const DEFAULT_ACCENT = {
  surface: 'from-muted/40 to-background',
  ring: 'hover:border-foreground/20',
  iconBg: 'bg-muted',
  iconFg: 'text-foreground/70',
  chip: 'bg-muted text-foreground/70',
};

export default function DocsIndexPage(): JSX.Element {
  const totalArticles = categories.reduce(
    (sum, c) => sum + c.articles.length,
    0,
  );
  const searchIndex = buildSearchIndex();

  return (
    <div>
      {/* Hero — gradient banner with eyebrow, large title, search, and stats. */}
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(16,185,129,0.12),transparent),radial-gradient(40%_60%_at_80%_100%,rgba(251,146,60,0.10),transparent)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 top-20 size-64 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-500/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-40 size-64 rounded-full bg-violet-300/20 blur-3xl dark:bg-violet-500/10"
        />

        <div className="relative mx-auto max-w-5xl px-6 py-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-white/60 px-3 py-1 text-xs font-medium text-emerald-800 shadow-sm backdrop-blur dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Sparkles className="size-3.5" />
            Getyn Campaigns Docs
          </span>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            How can we help you{' '}
            <span className="bg-gradient-to-r from-emerald-600 via-sky-600 to-violet-600 bg-clip-text text-transparent dark:from-emerald-400 dark:via-sky-400 dark:to-violet-400">
              ship campaigns
            </span>
            ?
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-foreground/70">
            Guides, walkthroughs, and reference material for everything
            inside Getyn Campaigns — from your first import to A/B-testing
            subject lines on autopilot.
          </p>
          <div className="mx-auto mt-8 max-w-xl">
            <DocsSearch entries={searchIndex} />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-foreground/60">
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="size-3.5" />
              {totalArticles} articles
            </span>
            <span className="text-foreground/30">·</span>
            <span>{categories.length} categories</span>
            <span className="text-foreground/30">·</span>
            <span className="inline-flex items-center gap-1.5">
              <MessageSquareText className="size-3.5" />
              Ask the AI assistant anytime
            </span>
          </div>
        </div>
      </section>

      {/* Category grid */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-500 dark:text-orange-400">
              Browse by topic
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">
              Pick a category to start
            </h2>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const accent = CATEGORY_ACCENT[category.slug] ?? DEFAULT_ACCENT;
            return (
              <Link
                key={category.slug}
                href={`/docs/${category.slug}`}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-br ${accent.surface} p-6 shadow-sm transition-all ${accent.ring} hover:shadow-md`}
              >
                <div
                  className={`mb-4 inline-flex size-11 items-center justify-center rounded-xl text-xl ${accent.iconBg} ${accent.iconFg}`}
                >
                  {category.icon}
                </div>
                <h3 className="font-display text-lg font-semibold tracking-tight">
                  {category.title}
                </h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-foreground/70">
                  {category.description}
                </p>
                <div className="mt-5 flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accent.chip}`}
                  >
                    {category.articles.length} article
                    {category.articles.length === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground/70 transition-colors group-hover:text-foreground">
                    Browse
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Support CTA strip */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-zinc-950 to-zinc-900 px-8 py-10 text-white shadow-lg">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 size-56 rounded-full bg-emerald-500/20 blur-3xl"
          />
          <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-200">
                <LifeBuoy className="size-3.5" />
                Still stuck?
              </span>
              <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">
                We read every message.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-300">
                Reach out to support, ask the in-app AI assistant, or jump
                into the community — someone's always around to help.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 md:justify-end">
              <a
                href="https://getyn.com/contact"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition-all hover:shadow-md"
              >
                Contact support
                <ArrowRight className="size-3.5" />
              </a>
              <a
                href="https://community.getyn.com"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
              >
                Join community
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
