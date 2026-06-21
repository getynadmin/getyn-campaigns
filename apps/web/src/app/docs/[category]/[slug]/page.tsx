import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';

import { ArticleToc } from '@/components/docs/article-toc';
import { allArticlePaths, findArticle } from '@/lib/docs/articles';
import { extractHeadings } from '@/lib/docs/headings';

export function generateStaticParams(): Array<{
  category: string;
  slug: string;
}> {
  return allArticlePaths().map((p) => ({
    category: p.categorySlug,
    slug: p.articleSlug,
  }));
}

export function generateMetadata({
  params,
}: {
  params: { category: string; slug: string };
}): { title: string; description: string } | undefined {
  const hit = findArticle(params.category, params.slug);
  if (!hit) return undefined;
  return {
    title: hit.article.title,
    description: hit.article.summary,
  };
}

export default function ArticlePage({
  params,
}: {
  params: { category: string; slug: string };
}): JSX.Element {
  const hit = findArticle(params.category, params.slug);
  if (!hit) notFound();
  const { category, article } = hit;

  // Sibling article for next-up nav.
  const articleIndex = category.articles.findIndex(
    (a) => a.slug === article.slug,
  );
  const prev = articleIndex > 0 ? category.articles[articleIndex - 1] : null;
  const next =
    articleIndex < category.articles.length - 1
      ? category.articles[articleIndex + 1]
      : null;

  // Extract headings server-side so SSG bakes them in; client TOC only
  // needs to wire the IntersectionObserver.
  const headings = extractHeadings(article.body);

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-10 md:grid-cols-[220px_1fr] lg:grid-cols-[220px_1fr_200px]">
      {/* Sidebar — category articles */}
      <aside className="hidden md:block">
        <div className="sticky top-24">
          <Link
            href="/docs"
            className="inline-flex items-center gap-1.5 text-xs text-foreground/60 hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            All docs
          </Link>
          <h3 className="mt-4 mb-2 font-display text-xs font-semibold uppercase tracking-wider text-foreground/50">
            {category.title}
          </h3>
          <ul className="space-y-0.5">
            {category.articles.map((a) => {
              const active = a.slug === article.slug;
              return (
                <li key={a.slug}>
                  <Link
                    href={`/docs/${category.slug}/${a.slug}`}
                    className={
                      'block rounded-md px-2.5 py-1.5 text-sm transition-colors ' +
                      (active
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-foreground/70 hover:bg-muted/50 hover:text-foreground')
                    }
                  >
                    {a.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* Article */}
      <article className="min-w-0">
        <nav className="mb-4 flex items-center gap-1.5 text-xs text-foreground/50">
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <span>/</span>
          <Link
            href={`/docs/${category.slug}`}
            className="hover:text-foreground"
          >
            {category.title}
          </Link>
        </nav>

        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {article.title}
          </h1>
          <p className="mt-2 text-base text-foreground/70">{article.summary}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-foreground/50">
            <Clock className="size-3" />
            {article.minutes} min read
          </div>
        </header>

        <div className="space-y-4 text-[15px]">{article.body}</div>

        {(prev || next) && (
          <div className="mt-14 grid gap-3 border-t pt-8 sm:grid-cols-2">
            {prev ? (
              <Link
                href={`/docs/${category.slug}/${prev.slug}`}
                className="group flex flex-col rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
              >
                <span className="text-[11px] uppercase tracking-wider text-foreground/50">
                  ← Previous
                </span>
                <span className="mt-1 font-display text-sm font-semibold tracking-tight">
                  {prev.title}
                </span>
              </Link>
            ) : (
              <div />
            )}
            {next ? (
              <Link
                href={`/docs/${category.slug}/${next.slug}`}
                className="group flex flex-col rounded-lg border bg-card p-4 text-right transition-colors hover:bg-muted/40"
              >
                <span className="text-[11px] uppercase tracking-wider text-foreground/50">
                  Next →
                </span>
                <span className="mt-1 font-display text-sm font-semibold tracking-tight">
                  {next.title}
                </span>
              </Link>
            ) : (
              <Link
                href={`/docs/${category.slug}`}
                className="group flex flex-col rounded-lg border bg-card p-4 text-right transition-colors hover:bg-muted/40"
              >
                <span className="text-[11px] uppercase tracking-wider text-foreground/50">
                  Back to category
                </span>
                <span className="mt-1 inline-flex items-center justify-end gap-1 font-display text-sm font-semibold tracking-tight">
                  {category.title}
                  <ArrowRight className="size-3.5" />
                </span>
              </Link>
            )}
          </div>
        )}
      </article>

      {/* Right rail — TOC. Hidden on <lg breakpoints (grid-cols-2 there). */}
      <aside className="hidden lg:block">
        <ArticleToc headings={headings} />
      </aside>
    </div>
  );
}
