'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  BarChart3,
  Bot,
  Boxes,
  Calendar,
  Filter,
  Headphones,
  Mail,
  MailOpen,
  MessageSquare,
  MousePointerClick,
  Palette,
  Phone,
  Send,
  Share2,
  SplitSquareHorizontal,
  Workflow,
  Zap,
} from 'lucide-react';

/**
 * Marketing header for /pricing.
 *
 * Two mega-menus (Features + All Apps) with icon + subtitle per item,
 * a right-side Email Us CTA on Features, and cleaner top-bar buttons.
 * All feature/app links live on getyn.com — this header just makes
 * them reachable from the app subdomain.
 */

interface MegaItem {
  label: string;
  href: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
}
interface MegaGroup {
  title: string;
  items: MegaItem[];
}

const FEATURES_GROUPS: MegaGroup[] = [
  {
    title: 'Email Marketing',
    items: [
      {
        label: 'Email Campaigns',
        subtitle: 'Create & send campaigns',
        href: 'https://getyn.com/apps/campaigns/features/email-campaigns',
        Icon: MailOpen,
      },
      {
        label: 'Email Automation',
        subtitle: 'Drip sequences & triggers',
        href: 'https://getyn.com/apps/campaigns/features/email-automation',
        Icon: Zap,
      },
      {
        label: 'Email Template Builder',
        subtitle: 'Drag-and-drop designer',
        href: 'https://getyn.com/apps/campaigns/features/email-template-builder',
        Icon: Palette,
      },
    ],
  },
  {
    title: 'WhatsApp Marketing',
    items: [
      {
        label: 'WhatsApp Campaigns',
        subtitle: 'Broadcast & engage',
        href: 'https://getyn.com/apps/campaigns/features/whatsapp-campaigns',
        Icon: MessageSquare,
      },
      {
        label: 'WhatsApp Chatbot Builder',
        subtitle: 'Automated conversations',
        href: 'https://getyn.com/apps/campaigns/features/whatsapp-chatbot',
        Icon: Bot,
      },
    ],
  },
  {
    title: 'Automation',
    items: [
      {
        label: 'Workflow Automation',
        subtitle: 'Multi-channel flows',
        href: 'https://getyn.com/apps/campaigns/features/workflow-automation',
        Icon: Workflow,
      },
    ],
  },
  {
    title: 'Growth & Conversion',
    items: [
      {
        label: 'Popups, Forms & Pages',
        subtitle: 'Capture & convert leads',
        href: 'https://getyn.com/apps/campaigns/features/popups-forms',
        Icon: MousePointerClick,
      },
      {
        label: 'Segmentation',
        subtitle: 'Target the right audience',
        href: 'https://getyn.com/apps/campaigns/features/segmentation',
        Icon: Filter,
      },
      {
        label: 'A/B Testing',
        subtitle: 'Optimize performance',
        href: 'https://getyn.com/apps/campaigns/features/ab-testing',
        Icon: SplitSquareHorizontal,
      },
      {
        label: 'Analytics & Reporting',
        subtitle: 'Measure campaign ROI',
        href: 'https://getyn.com/apps/campaigns/features/analytics-reporting',
        Icon: BarChart3,
      },
    ],
  },
];

const APPS: MegaItem[] = [
  {
    label: 'Getyn CRM',
    subtitle: 'Sales, contacts & invoicing',
    href: 'https://getyn.com/apps/crm',
    Icon: BarChart3,
  },
  {
    label: 'Getyn Helpdesk',
    subtitle: 'Tickets, inbox & knowledge base',
    href: 'https://getyn.com/apps/helpdesk',
    Icon: Headphones,
  },
  {
    label: 'Getyn Phone',
    subtitle: 'Cloud calling & recording',
    href: 'https://getyn.com/apps/phone',
    Icon: Phone,
  },
  {
    label: 'Getyn Campaigns',
    subtitle: 'Email & WhatsApp marketing',
    href: 'https://getyn.com/apps/campaigns',
    Icon: Send,
  },
  {
    label: 'Getyn Social',
    subtitle: 'Social media management',
    href: 'https://getyn.com/apps/social',
    Icon: Share2,
  },
  {
    label: 'Getyn G-Suite',
    subtitle: 'All-in-one business suite',
    href: 'https://getyn.com/apps/gsuite',
    Icon: Boxes,
  },
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
            <div className="grid w-[880px] grid-cols-[1fr_1fr_240px] gap-0 overflow-hidden rounded-lg">
              <div className="space-y-6 p-6">
                {FEATURES_GROUPS.slice(0, 2).map((g) => (
                  <FeatureGroup key={g.title} group={g} />
                ))}
              </div>
              <div className="space-y-6 border-l p-6">
                {FEATURES_GROUPS.slice(2).map((g) => (
                  <FeatureGroup key={g.title} group={g} />
                ))}
              </div>
              <EmailUsCard />
            </div>
          </MegaMenu>

          <Link
            href="/pricing"
            className="rounded px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground"
          >
            Pricing
          </Link>

          <MegaMenu label="All Apps">
            <div className="grid w-[400px] grid-cols-1 gap-1 p-3">
              {APPS.map((a) => (
                <MegaLink key={a.href} item={a} />
              ))}
            </div>
          </MegaMenu>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href={BOOK_A_DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700 shadow-sm transition-all hover:border-emerald-600 hover:bg-emerald-100 hover:shadow-md dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950 sm:inline-flex"
          >
            <Calendar className="size-3.5" />
            Book a demo
          </a>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background shadow-sm transition-all hover:opacity-90 hover:shadow-md"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureGroup({ group }: { group: MegaGroup }): JSX.Element {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {group.title}
      </p>
      <ul className="space-y-0.5">
        {group.items.map((i) => (
          <li key={i.href}>
            <MegaLink item={i} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MegaLink({ item }: { item: MegaItem }): JSX.Element {
  const { Icon } = item;
  return (
    <a
      href={item.href}
      className="group/link flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-muted"
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 transition-colors group-hover/link:bg-emerald-500/20 dark:text-emerald-400">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {item.label}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {item.subtitle}
        </span>
      </span>
    </a>
  );
}

function EmailUsCard(): JSX.Element {
  return (
    <div className="flex flex-col justify-between border-l bg-muted/30 p-6">
      <div>
        <span className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Mail className="size-5" />
        </span>
        <p className="text-sm font-semibold">Email Us</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Email our sales and support team for anything and we&apos;ll
          respond within 24 hours.
        </p>
      </div>
      <a
        href="mailto:sales@getyn.com"
        className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
      >
        Send an email →
      </a>
    </div>
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
        className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground group-hover:text-foreground group-focus-within:text-foreground"
      >
        {label}
        <svg
          className="size-3 transition-transform group-hover:rotate-180"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="invisible absolute left-0 top-full z-50 mt-1 rounded-lg border bg-background opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {children}
      </div>
    </div>
  );
}
