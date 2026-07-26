import Link from 'next/link';
import {
  FacebookIcon,
  InstagramIcon,
  LinkedinIcon,
  TwitterIcon,
  YoutubeIcon,
} from 'lucide-react';

/**
 * Docs footer — mirrors the marketing site footer columns. Static
 * links to getyn.com pages; the only internal link is /docs itself.
 */
const COLUMNS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: 'Top Apps',
    links: [
      { label: 'Getyn CRM', href: 'https://getyn.com/apps/crm' },
      { label: 'Getyn Helpdesk', href: 'https://getyn.com/apps/helpdesk' },
      { label: 'Getyn Social', href: 'https://getyn.com/apps/social' },
      { label: 'Getyn Phone', href: 'https://getyn.com/apps/phone' },
      { label: 'Getyn Campaigns', href: 'https://getyn.com/apps/campaigns' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: 'https://getyn.com/about' },
      { label: 'Leadership', href: '#' },
      { label: 'Careers', href: 'https://getyn.com/careers' },
      { label: 'Customers', href: 'https://getyn.com/customers' },
      { label: 'Partners', href: 'https://getyn.com/partners' },
      { label: 'Events', href: '#' },
      { label: 'Blogs', href: '#' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'My Account', href: 'https://getyn.com/login' },
      { label: 'Help Center', href: 'https://support.getyn.com' },
      {
        label: 'Refund Policy',
        href: 'https://support.getyn.com/#/articles/refundpolicy',
      },
      {
        label: 'Free Trials',
        href: 'https://support.getyn.com/hc/articles/18/19/40/about-free-trials',
      },
      { label: 'Getyn Training', href: '#' },
      { label: 'Community', href: '#' },
      { label: 'Contact Us', href: 'https://getyn.com/contact' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'CRM Docs', href: 'https://crm.getyn.com/docs' },
      { label: 'Helpdesk Docs', href: 'https://helpdesk.getyn.com/docs' },
      { label: 'Phone Docs', href: 'https://phone.getyn.com/docs' },
      { label: 'Social Docs', href: '#' },
      { label: 'Campaigns Docs', href: '#' },
    ],
  },
];

const SOCIAL = [
  { Icon: FacebookIcon, href: 'https://www.facebook.com/getyncloud/', label: 'Facebook' },
  { Icon: InstagramIcon, href: 'https://www.instagram.com/getyncloud/', label: 'Instagram' },
  { Icon: TwitterIcon, href: 'https://x.com/getyncloud/', label: 'X' },
  { Icon: LinkedinIcon, href: 'https://uk.linkedin.com/company/getyncloud', label: 'LinkedIn' },
  { Icon: YoutubeIcon, href: 'https://www.youtube.com/@Getyncloud', label: 'YouTube' },
];

export function DocsFooter(): JSX.Element {
  const year = new Date().getFullYear();
  return (
    <footer className="relative bg-zinc-950 text-zinc-300">
      {/* Radial gradient wash across the top of the container, per sample */}
      <div className="relative mx-auto max-w-5xl bg-[radial-gradient(35%_80%_at_30%_0%,rgba(16,185,129,0.12),transparent)] px-6 md:border-x md:border-zinc-800/70">
        {/* Thin top divider */}
        <div className="absolute inset-x-0 top-0 h-px bg-zinc-800" />

        {/* Brand row */}
        <div className="grid grid-cols-6 gap-6 pb-8 pt-10">
          <div className="col-span-6 flex flex-col gap-4">
            <span className="inline-flex w-max items-center gap-2 text-sm font-semibold tracking-tight text-white">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-emerald-600 text-xs text-white">
                G
              </span>
              Getyn <span className="text-zinc-500">/ Campaigns</span>
            </span>
            <p className="max-w-md font-mono text-xs text-zinc-500">
              One plan, every channel. Email, WhatsApp, drip campaigns, and an
              AI copilot — built for growth teams.
            </p>
            <div className="flex gap-2">
              {SOCIAL.map(({ Icon, href, label }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Links grid — 4 columns, sample's compact list styling */}
        <div className="border-t border-zinc-900 pb-8 pt-8">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <span className="mb-2 block text-[11px] uppercase tracking-wide text-zinc-500">
                  {col.title}
                </span>
                <div className="flex flex-col gap-1">
                  {col.links.map((l) => {
                    const external = l.href.startsWith('http');
                    const cls =
                      'w-max py-0.5 text-sm text-zinc-300 transition duration-200 hover:text-white hover:underline';
                    return external ? (
                      <a
                        key={l.href + l.label}
                        href={l.href}
                        className={cls}
                        target={l.href === '#' ? undefined : '_blank'}
                        rel={l.href === '#' ? undefined : 'noopener noreferrer'}
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        key={l.href + l.label}
                        href={l.href === '#' ? '#' : l.href}
                        className={cls}
                      >
                        {l.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom divider + copyright + legal + compliance */}
        <div className="absolute inset-x-0 bottom-[52px] h-px bg-zinc-800" />
        <div className="flex flex-col items-center gap-3 pb-5 pt-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="font-mono text-[11px] font-thin text-zinc-500">
            © {year} Getyn Technologies · All rights reserved
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-zinc-500">
            <a href="https://getyn.com/privacy" className="hover:text-white">
              Privacy
            </a>
            <a href="https://getyn.com/terms" className="hover:text-white">
              Terms
            </a>
            <a href="https://getyn.com/sitemap" className="hover:text-white">
              Sitemap
            </a>
            <span className="ml-1 flex gap-1">
              <span className="rounded border border-zinc-800 px-1.5 py-0.5">GDPR</span>
              <span className="rounded border border-zinc-800 px-1.5 py-0.5">SOC 2</span>
              <span className="rounded border border-zinc-800 px-1.5 py-0.5">HIPAA</span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
