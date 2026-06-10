import type { Metadata } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';

import { Providers } from '@/components/providers/providers';
import { getSiteBranding } from '@/server/integrations/site-branding';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import { cn } from '@/lib/utils';
import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontDisplay = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
});

/**
 * Phase 5.6 M5 — pull app name + favicon from SiteBrandingSettings.
 * Falls back to hard-coded defaults when the DB row is missing or
 * fields are null.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getSiteBranding();
  const title = branding.appName;
  return {
    title: { default: title, template: `%s · ${title}` },
    description:
      'Email, WhatsApp, and SMS marketing campaigns with an AI copilot and drag-drop email builder.',
    icons: branding.faviconUrl
      ? [{ rel: 'icon', url: branding.faviconUrl }]
      : undefined,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const branding = await getSiteBranding();
  // Compose CSS variables for colors + any admin-authored custom
  // CSS into a single <style> tag injected once at the document
  // head. Values are server-rendered staff input, never tenant-
  // reflected, so HTML escaping isn't needed.
  const customCss = [
    branding.primaryColor
      ? `:root { --brand-primary: ${branding.primaryColor}; }`
      : '',
    branding.accentColor
      ? `:root { --brand-accent: ${branding.accentColor}; }`
      : '',
    branding.customCss ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme boot — must run before paint to avoid a flash of the
            wrong colour scheme. Self-contained, idempotent. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
        {customCss && (
          // eslint-disable-next-line react/no-danger
          <style dangerouslySetInnerHTML={{ __html: customCss }} />
        )}
      </head>
      <body
        className={cn(
          'min-h-screen bg-background font-sans antialiased',
          fontSans.variable,
          fontDisplay.variable,
        )}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
