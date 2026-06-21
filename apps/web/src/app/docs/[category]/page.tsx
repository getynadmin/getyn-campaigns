import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';

import { categories, findCategory } from '@/lib/docs/articles';

export function generateStaticParams(): Array<{ category: string }> {
  return categories.map((c) => ({ category: c.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { category: string };
}): { title: string } | undefined {
  const cat = findCategory(params.category);
  if (!cat) return undefined;
  return { title: cat.title };
}

export default function CategoryPage({
  params,
}: {
  params: { category: string };
}): JSX.Element {
  const category = findCategory(params.category);
  if (!category) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/docs"
        className="inline-flex items-center gap-1.5 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All categories
      </Link>

      <div className="mt-6 flex items-start gap-4">
        <div className="inline-flex size-12 items-center justify-center rounded-xl bg-muted text-2xl">
          {category.icon}
        </div>
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {category.title}
          </h1>
          <p className="mt-1.5 text-base text-foreground/70">
            {category.description}
          </p>
        </div>
      </div>

      <ul className="mt-10 divide-y rounded-xl border bg-card">
        {category.articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/docs/${category.slug}/${article.slug}`}
              className="group flex items-start gap-4 px-6 py-5 transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-semibold tracking-tight">
                  {article.title}
                </h2>
                <p className="mt-1 text-sm text-foreground/70">
                  {article.summary}
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-foreground/50">
                  <Clock className="size-3" />
                  {article.minutes} min read
                </div>
              </div>
              <ArrowRight className="mt-1 size-4 text-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
