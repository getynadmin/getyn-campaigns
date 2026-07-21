import Link from 'next/link';

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
      { label: 'Leadership', href: 'https://getyn.com/leadership' },
      { label: 'Careers', href: 'https://getyn.com/careers' },
      { label: 'Customers', href: 'https://getyn.com/customers' },
      { label: 'Partners', href: 'https://getyn.com/partners' },
      { label: 'Events', href: 'https://getyn.com/events' },
      { label: 'Blogs', href: 'https://getyn.com/blog' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'My Account', href: '/account' },
      { label: 'Help Center', href: 'https://helpdesk.getyn.com' },
      { label: 'Refund Policy', href: 'https://getyn.com/refund-policy' },
      { label: 'Free Trials', href: 'https://getyn.com/free-trials' },
      { label: 'Getyn Training', href: 'https://getyn.com/training' },
      { label: 'Community', href: 'https://community.getyn.com' },
      { label: 'Contact Us', href: 'https://getyn.com/contact' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'CRM Docs', href: 'https://getyn.com/apps/crm/docs' },
      { label: 'Helpdesk Docs', href: 'https://helpdesk.getyn.com/docs' },
      { label: 'Phone Docs', href: 'https://getyn.com/apps/phone/docs' },
      { label: 'Social Docs', href: 'https://getyn.com/apps/social/docs' },
      { label: 'Campaigns Docs', href: '/docs' },
    ],
  },
];

const SOCIAL = [
  { label: 'Facebook', href: 'https://facebook.com/getyn' },
  { label: 'Instagram', href: 'https://instagram.com/getyn' },
  { label: 'X', href: 'https://x.com/getyn' },
  { label: 'LinkedIn', href: 'https://linkedin.com/company/getyn' },
  { label: 'YouTube', href: 'https://youtube.com/@getyn' },
];

export function DocsFooter(): JSX.Element {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 text-zinc-300">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="mb-3 font-display text-sm font-semibold tracking-tight text-white">
                {col.title}
              </h3>
              <ul className="space-y-2 text-sm">
                {col.links.map((l) => {
                  const external = l.href.startsWith('http');
                  return (
                    <li key={l.href}>
                      {external ? (
                        <a
                          href={l.href}
                          className="text-zinc-400 transition-colors hover:text-white"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="text-zinc-400 transition-colors hover:text-white"
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-zinc-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <span>© {new Date().getFullYear()} Getyn Technologies</span>
            <a href="https://getyn.com/privacy" className="hover:text-white">
              Privacy Policy
            </a>
            <a href="https://getyn.com/terms" className="hover:text-white">
              Terms &amp; Conditions
            </a>
            <a href="https://getyn.com/sitemap" className="hover:text-white">
              Sitemap
            </a>
            <span className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-0.5">
              GDPR
            </span>
            <span className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-0.5">
              SOC 2
            </span>
            <span className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-0.5">
              HIPAA
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            {SOCIAL.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className="transition-colors hover:text-white"
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
