import Link from 'next/link';

/**
 * Docs header — mirrors getyn.com/apps/campaigns chrome so the docs
 * feel like part of the marketing site rather than an orphaned page
 * grafted onto the app. Logo left, top-level nav center, sign-in/up
 * right. Public — no auth.
 */
const NAV_ITEMS = [
  { label: 'Features', href: 'https://getyn.com/apps/campaigns#features' },
  { label: 'Solutions', href: 'https://getyn.com/solutions' },
  { label: 'Industries', href: 'https://getyn.com/industries' },
  { label: 'Pricing', href: 'https://getyn.com/apps/campaigns#pricing' },
  { label: 'All Apps', href: 'https://getyn.com/apps' },
];

export function DocsHeader(): JSX.Element {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <Link
          href="/docs"
          className="flex items-center gap-2 font-display text-base font-semibold tracking-tight"
        >
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-foreground text-background">
            <span className="text-[13px] font-bold">G</span>
          </span>
          <span>Getyn</span>
          <span className="text-foreground/40">/</span>
          <span className="text-foreground/80">Campaigns</span>
        </Link>

        <nav className="ml-4 hidden flex-1 items-center gap-1 md:flex">
          {NAV_ITEMS.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href="https://getyn.com/book-a-demo"
            className="hidden text-sm text-foreground/70 transition-colors hover:text-foreground sm:inline"
          >
            Book a demo
          </a>
          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
