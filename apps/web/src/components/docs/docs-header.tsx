'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  BarChart3,
  Bot,
  Calendar,
  Check,
  Filter,
  Headphones,
  Layers,
  Mail,
  MailOpen,
  MessageSquare,
  MousePointerClick,
  Palette,
  Phone,
  Send,
  Share2,
  SplitSquareHorizontal,
  Sparkles,
  Wand2,
  Workflow,
  Zap,
} from 'lucide-react';

/**
 * Marketing header for /docs — rendered in a locked-dark surface
 * regardless of the tenant's light/dark preference so the brand
 * chrome stays consistent for anonymous and signed-in visitors.
 *
 * Two mega-menus (Features + All Apps) mirror the live getyn.com
 * marketing header: orange icon tiles on Features, two-column All
 * Apps with an individual-apps list + a "Getyn G-Suite" combined-plan
 * promo card on the right. Book-a-demo / Sign in CTAs round it out.
 */

interface MegaItem {
  label: string;
  href: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Per-app tint used in the All Apps dropdown. */
  tint?: string;
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

/**
 * Individual apps in the left column of the All Apps dropdown. Each
 * app gets a dedicated tint so icons read as a palette, not a grid of
 * one color — mirrors the live getyn.com dropdown.
 */
const INDIVIDUAL_APPS: MegaItem[] = [
  {
    label: 'Getyn CRM',
    subtitle: 'Sales, contacts & invoicing',
    href: 'https://getyn.com/apps/crm',
    Icon: BarChart3,
    tint: 'text-sky-400 bg-sky-400/10 group-hover/link:bg-sky-400/20',
  },
  {
    label: 'Getyn Helpdesk',
    subtitle: 'Tickets, inbox & knowledge base',
    href: 'https://getyn.com/apps/helpdesk',
    Icon: Headphones,
    tint: 'text-green-400 bg-green-400/10 group-hover/link:bg-green-400/20',
  },
  {
    label: 'Getyn Phone',
    subtitle: 'Cloud calling & recording',
    href: 'https://getyn.com/apps/phone',
    Icon: Phone,
    tint: 'text-emerald-400 bg-emerald-400/10 group-hover/link:bg-emerald-400/20',
  },
  {
    label: 'Getyn Campaigns',
    subtitle: 'Email & WhatsApp marketing',
    href: 'https://getyn.com/apps/campaigns',
    Icon: Send,
    tint: 'text-rose-400 bg-rose-400/10 group-hover/link:bg-rose-400/20',
  },
  {
    label: 'Getyn Studio',
    subtitle: 'AI creation, social, ads & agents',
    href: 'https://getyn.com/apps/studio',
    Icon: Wand2,
    tint: 'text-violet-400 bg-violet-400/10 group-hover/link:bg-violet-400/20',
  },
  {
    label: 'Getyn Builder',
    subtitle: 'Website and app builder',
    href: 'https://getyn.com/apps/builder',
    Icon: Share2,
    tint: 'text-orange-400 bg-orange-400/10 group-hover/link:bg-orange-400/20',
  },
];

const G_SUITE_INCLUDES = [
  { label: 'CRM', Icon: BarChart3 },
  { label: 'Helpdesk', Icon: Headphones },
  { label: 'Phone', Icon: Phone },
  { label: 'Campaigns', Icon: Send },
  { label: 'Studio', Icon: Wand2 },
  { label: 'Builder', Icon: Share2 },
];

const BOOK_A_DEMO_URL = 'https://calendly.com/getyn/30min';

export function DocsHeader({ logoUrl }: { logoUrl?: string | null } = {}): JSX.Element {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <Link
          href="/pricing"
          className="flex items-center gap-2 font-display text-base font-semibold tracking-tight"
        >
          {logoUrl ? (
            <span className="flex items-center gap-2">
              <Image
                src={logoUrl}
                alt="Getyn Campaigns"
                width={140}
                height={32}
                unoptimized
                className="h-8 w-auto object-contain"
                priority
              />
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-400 sm:inline">
                Campaigns
              </span>
            </span>
          ) : (
            <>
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-emerald-600 text-white">
                <span className="text-[13px] font-bold">G</span>
              </span>
              <span>Getyn</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-400">
                Campaigns
              </span>
            </>
          )}
        </Link>

        <nav className="ml-4 hidden flex-1 items-center gap-1 md:flex">
          <MegaMenu label="Features">
            <div className="grid w-[880px] grid-cols-[1fr_1fr_240px] gap-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              <div className="space-y-6 p-6">
                {FEATURES_GROUPS.slice(0, 2).map((g) => (
                  <FeatureGroup key={g.title} group={g} />
                ))}
              </div>
              <div className="space-y-6 border-l border-zinc-800 p-6">
                {FEATURES_GROUPS.slice(2).map((g) => (
                  <FeatureGroup key={g.title} group={g} />
                ))}
              </div>
              <EmailUsCard />
            </div>
          </MegaMenu>

          <Link
            href="/pricing"
            className="rounded px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white"
          >
            Pricing
          </Link>

          <MegaMenu label="All Apps">
            <div className="grid w-[720px] grid-cols-[1fr_280px] gap-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              {/* LEFT — individual apps */}
              <div className="p-6">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Individual Apps
                </p>
                <div className="space-y-0.5">
                  {INDIVIDUAL_APPS.map((a) => (
                    <AppLink key={a.href} item={a} />
                  ))}
                </div>
              </div>
              {/* RIGHT — combined plan */}
              <GSuiteCard />
            </div>
          </MegaMenu>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href={BOOK_A_DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-300 shadow-sm transition-all hover:border-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-200 sm:inline-flex"
          >
            <Calendar className="size-3.5" />
            Book a demo
          </a>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm transition-all hover:bg-zinc-100 hover:shadow-md"
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
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {group.title}
      </p>
      <ul className="space-y-0.5">
        {group.items.map((i) => (
          <li key={i.href}>
            <FeatureLink item={i} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureLink({ item }: { item: MegaItem }): JSX.Element {
  const { Icon } = item;
  return (
    <a
      href={item.href}
      className="group/link flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-zinc-800"
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500 text-white transition-colors group-hover/link:bg-orange-400">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-white">
          {item.label}
        </span>
        <span className="block text-[11px] text-zinc-400">
          {item.subtitle}
        </span>
      </span>
    </a>
  );
}

function AppLink({ item }: { item: MegaItem }): JSX.Element {
  const { Icon } = item;
  return (
    <a
      href={item.href}
      className="group/link flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-zinc-800"
    >
      <span
        className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors ${
          item.tint ?? 'bg-zinc-800 text-zinc-300'
        }`}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">
          {item.label}
        </span>
        <span className="block text-[11px] text-zinc-400">
          {item.subtitle}
        </span>
      </span>
    </a>
  );
}

function GSuiteCard(): JSX.Element {
  return (
    <div className="flex flex-col justify-between border-l border-zinc-800 bg-[linear-gradient(140deg,rgba(16,185,129,0.12),transparent_60%),radial-gradient(60%_50%_at_80%_100%,rgba(16,185,129,0.14),transparent)] p-6">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <span className="inline-flex size-9 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-300">
            <Layers className="size-4" />
          </span>
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
            The Combined Plan
          </span>
        </div>
        <p className="text-base font-semibold text-white">Getyn G-Suite</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          Your business apps, together in one subscription.
        </p>
        <ul className="mt-4 space-y-1.5">
          {G_SUITE_INCLUDES.map(({ label, Icon }) => (
            <li
              key={label}
              className="flex items-center gap-2 text-[12px] text-zinc-300"
            >
              <Icon className="size-3.5 text-zinc-500" />
              <span className="flex-1">{label}</span>
              <Check className="size-3.5 text-emerald-400" />
            </li>
          ))}
        </ul>
      </div>
      <a
        href="https://getyn.com/apps/gsuite"
        className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-emerald-400"
      >
        Explore G-Suite
        <span aria-hidden>→</span>
      </a>
    </div>
  );
}

function EmailUsCard(): JSX.Element {
  return (
    <div className="flex flex-col justify-between border-l border-zinc-800 bg-zinc-900/60 p-6">
      <div>
        <span className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
          <Mail className="size-5" />
        </span>
        <p className="text-sm font-semibold text-white">Email Us</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          Email our sales and support team for anything and we&apos;ll
          respond within 24 hours.
        </p>
      </div>
      <a
        href="mailto:sales@getyn.com"
        className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200"
      >
        <Sparkles className="size-3" />
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
        className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:text-white group-hover:text-white group-focus-within:text-white"
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
      <div className="invisible absolute left-0 top-full z-50 mt-1 opacity-0 shadow-xl shadow-black/40 transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {children}
      </div>
    </div>
  );
}
