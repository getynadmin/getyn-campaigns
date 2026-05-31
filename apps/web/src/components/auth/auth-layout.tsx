import { getSiteBranding } from '@/server/integrations/site-branding';

import { AuthMarketingPanel } from './auth-marketing-panel';

/**
 * Phase 5.7 — shared two-column shell for /login and /signup.
 *
 * Left column hosts the form (theme-aware). Right column always shows
 * the Campaigns marketing panel; below `md` the right column is
 * dropped and the form takes the full viewport.
 *
 * Server component — fetches branding once via getSiteBranding() so
 * the page can render the uploaded logo (with SVG fallback in
 * /public/getyn-logo-light.svg for the dark theme).
 */
export interface AuthLayoutProps {
  theme: 'light' | 'dark';
  children: React.ReactNode;
}

export async function AuthLayout({
  theme,
  children,
}: AuthLayoutProps): Promise<JSX.Element> {
  const branding = await getSiteBranding();
  // Dark theme prefers the dark-mode logo (white text); light theme
  // prefers the standard sidebar logo.
  const logoUrl =
    theme === 'dark'
      ? (branding.defaultSidebarLogoDarkUrl ?? '/getyn-logo-light.svg')
      : (branding.defaultSidebarLogoLightUrl ?? null);

  const leftBgClass =
    theme === 'dark'
      ? 'auth-grid bg-[#0A0A0F] text-white'
      : 'bg-white text-foreground';

  return (
    <main className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      <section
        className={`relative flex min-h-screen flex-col px-6 py-10 md:px-12 lg:px-20 ${leftBgClass}`}
      >
        <header className="flex items-center gap-3">
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoUrl}
              alt={branding.appName}
              className="h-9 w-auto"
            />
          ) : (
            <LightBrandMark appName={branding.appName} />
          )}
        </header>

        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-12">
          {children}
        </div>

        {branding.footerText && (
          <footer
            className={
              theme === 'dark'
                ? 'mt-auto text-center text-[11px] text-white/40'
                : 'mt-auto text-center text-[11px] text-muted-foreground'
            }
          >
            {branding.footerText}
          </footer>
        )}
      </section>

      <AuthMarketingPanel />
    </main>
  );
}

/** Light-theme product mark — used when no custom sidebar logo is uploaded. */
function LightBrandMark({ appName }: { appName: string }): JSX.Element {
  return (
    <>
      <span className="grid size-10 place-items-center rounded-xl bg-emerald-500 text-white shadow-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
          aria-hidden
        >
          {/* Megaphone glyph for the Campaigns mark */}
          <path d="M3 11l18-8v18l-18-8z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      </span>
      <span className="font-display text-lg font-semibold text-foreground">
        {appName}
      </span>
    </>
  );
}
