'use client';

import Link from 'next/link';
import Image from 'next/image';

/**
 * Marketing header for /pricing (and any future marketing surfaces).
 *
 * Two mega-menus (Features + All Apps) plus a Pricing link. Sign-up
 * and Sign-in stay right; Book-a-demo deep-links to Calendly per
 * marketing spec. All feature/app links live on getyn.com — this
 * header just makes them reachable from the app subdomain.
 */

interface MegaItem {
  label: string;
  href: string;
}
interface MegaGroup {
  title: string;
  items: MegaItem[];
}

const FEATURES_GROUPS: MegaGroup[] = [
  {
    title: 'Email Marketing',
    items: [
      { label: 'Email Campaigns', href: 'https://getyn.com/apps/campaigns/features/email-campaigns' },
      { label: 'Email Automation', href: 'https://getyn.com/apps/campaigns/features/email-automation' },
      { label: 'Email Template Builder', href: 'https://getyn.com/apps/campaigns/features/email-template-builder' },
    ],
  },
  {
    title: 'WhatsApp Marketing',
    items: [
      { label: 'WhatsApp Campaigns', href: 'https://getyn.com/apps/campaigns/features/whatsapp-campaigns' },
      { label: 'WhatsApp Chatbot Builder', href: 'https://getyn.com/apps/campaigns/features/whatsapp-chatbot' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { label: 'Workflow Automation', href: 'https://getyn.com/apps/campaigns/features/workflow-automation' },
    ],
  },
  {
    title: 'Growth & Conversion',
    items: [
      { label: 'Popups, Forms & Pages', href: 'https://getyn.com/apps/campaigns/features/popups-forms' },
      { label: 'Segmentation', href: 'https://getyn.com/apps/campaigns/features/segmentation' },
      { label: 'A/B Testing', href: 'https://getyn.com/apps/campaigns/features/ab-testing' },
      { label: 'Analytics & Reporting', href: 'https://getyn.com/apps/campaigns/features/analytics-reporting' },
    ],
  },
];

const APPS: MegaItem[] = [
  { label: 'Getyn CRM', href: 'https://getyn.com/apps/crm' },
  { label: 'Getyn Helpdesk', href: 'https://getyn.com/apps/helpdesk' },
  { label: 'Getyn Phone', href: 'https://getyn.com/apps/phone' },
  { label: 'Getyn Campaigns', href: 'https://getyn.com/apps/campaigns' },
  { label: 'Getyn Social', href: 'https://getyn.com/apps/social' },
  { label: 'Getyn G-Suite', href: 'https://getyn.com/apps/gsuite' },
];

const BOOK_A_DEMO_URL = 'https://calendly.com/getyn/30min';

export function DocsHeader({ logoUrl }: { logoUrl?: string | null } = {}): JSX.Element {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <Link
          href="/pricing"
          className="flex items-center gap-2 font-display text-base font-semibold tracking-tight"
        >
          {logoUrl ? (
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
          <MegaMenu label="Features">
            <div className="grid w-[640px] grid-cols-2 gap-6 p-6">
              {FEATURES_GROUPS.map((g) => (
                <div key={g.title}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.title}
                  </p>
                  <ul className="space-y-1.5">
                    {g.items.map((i) => (
                      <li key={i.href}>
                        <a
                          href={i.href}
                          className="block rounded px-2 py-1 text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                        >
                          {i.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </MegaMenu>

          <Link
            href="/pricing"
            className="rounded px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground"
          >
            Pricing
          </Link>

          <MegaMenu label="All Apps">
            <div className="grid w-[280px] gap-1 p-3">
              {APPS.map((a) => (
                <a
                  key={a.href}
                  href={a.href}
                  className="rounded px-2 py-1.5 text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                >
                  {a.label}
                </a>
              ))}
            </div>
          </MegaMenu>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={BOOK_A_DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
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
        </div>
      </div>
    </header>
  );
}

/**
 * Pure-CSS mega-menu opened on group-hover / focus-within — no state,
 * no JS. Works with keyboard because the trigger button + panel share
 * a focus-within scope.
 */
function MegaMenu({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="group relative">
      <button
        type="button"
        className="rounded px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground group-hover:text-foreground group-focus-within:text-foreground"
      >
        {label}
      </button>
      <div
        className="invisible absolute left-0 top-full z-50 mt-1 rounded-lg border bg-background opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {children}
      </div>
    </div>
  );
}
