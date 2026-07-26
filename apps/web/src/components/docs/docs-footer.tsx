import Link from 'next/link';
import Image from 'next/image';
import {
  FacebookIcon,
  InstagramIcon,
  LinkedinIcon,
  TwitterIcon,
  YoutubeIcon,
} from 'lucide-react';

/**
 * Full-width dark footer for marketing surfaces (/pricing, /checkout).
 *
 * Layout: brand block (logo + tagline + socials) pinned left, link
 * columns + copyright stacked on the right. Container spans the full
 * viewport with generous inner padding so it reads as a proper page
 * footer, not a sidebar.
 *
 * Logo comes from SiteBrandingSettings.defaultSidebarLogoLightUrl —
 * the same asset the admin uploaded at /admin/settings/site. Falls
 * back to the G/Getyn text lockup when no logo is configured.
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
      { label: 'Refund Policy', href: 'https://support.getyn.com/#/articles/refundpolicy' },
      { label: 'Free Trials', href: 'https://support.getyn.com/hc/articles/18/19/40/about-free-trials' },
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

export function DocsFooter({
  logoUrl,
}: { logoUrl?: string | null } = {}): JSX.Element {
  const year = new Date().getFullYear();
  return (
    <footer className="relative border-t border-zinc-800 bg-zinc-950 text-zinc-300">
      {/* Radial emerald wash at the top-left — sample's brand-tinted vibe */}
      <div className="relative w-full bg-[radial-gradient(45%_60%_at_15%_0%,rgba(16,185,129,0.10),transparent)]">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-16">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16">
            {/* LEFT: brand block */}
            <div className="flex flex-col gap-5">
              <a href="/pricing" className="w-max">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="Getyn Campaigns"
                    width={160}
                    height={36}
                    unoptimized
                    className="h-9 w-auto object-contain"
                  />
                ) : (
                  <span className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white">
                    <span className="inline-flex size-7 items-center justify-center rounded-md bg-emerald-600 text-xs">
                      G
                    </span>
                    Getyn <span className="text-zinc-500">/ Campaigns</span>
                  </span>
                )}
              </a>
              <p className="max-w-md font-mono text-xs leading-relaxed text-zinc-500">
                One plan, every channel. Email, WhatsApp, drip campaigns, and
                an AI copilot — built for growth teams.
              </p>
              <div className="flex gap-2">
                {SOCIAL.map(({ Icon, href, label }) => (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="rounded-md border border-zinc-800 p-2 text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
                  >
                    <Icon className="size-4" />
                  </a>
                ))}
              </div>
            </div>

            {/* RIGHT: link columns */}
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-8">
              {COLUMNS.map((col) => (
                <div key={col.title}>
                  <span className="mb-3 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    {col.title}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {col.links.map((l) => {
                      const external = l.href.startsWith('http');
                      const cls =
                        'w-max py-0.5 text-sm text-zinc-300 transition duration-200 hover:text-white hover:underline';
                      return external ? (
                        <a
                          key={l.href + l.label}
                          href={l.href}
                          className={cls}
                          target="_blank"
                          rel="noopener noreferrer"
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

          {/* Bottom divider + copyright + compliance chips */}
          <div className="mt-12 flex flex-col items-start gap-3 border-t border-zinc-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-[11px] font-thin text-zinc-500">
              © {year} Getyn Technologies · All rights reserved
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
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
      </div>
    </footer>
  );
}
