import Link from 'next/link';
import Image from 'next/image';

const NAV_ITEMS = [
  { label: 'Features', href: 'https://getyn.com/apps/campaigns#features' },
  { label: 'Solutions', href: 'https://getyn.com/solutions' },
  { label: 'Industries', href: 'https://getyn.com/industries' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'All Apps', href: 'https://getyn.com/apps' },
];

export function DocsHeader({ logoUrl }: { logoUrl?: string | null } = {}): JSX.Element {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <Link
          href="/pricing"
          className="flex items-center gap-2 font-display text-base font-semibold tracking-tight"
        >
          {logoUrl ? (
            // Next/Image with unoptimized so the admin can point at any
            // arbitrary Supabase-storage URL without whitelisting each
            // host in next.config.js.
            <Image
              src={logoUrl}
              alt="Getyn Campaigns"
              width={140}
              height={32}
              unoptimized
              className="h-8 w-auto object-contain"
              priority
            />
          ) : (
            <>
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-emerald-600 text-white">
                <span className="text-[13px] font-bold">G</span>
              </span>
              <span>Getyn</span>
              <span className="text-foreground/40">/</span>
              <span className="text-foreground/80">Campaigns</span>
            </>
          )}
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
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
