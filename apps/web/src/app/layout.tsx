import type { Metadata } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';

import { Providers } from '@/components/providers/providers';
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

export const metadata: Metadata = {
  title: {
    default: 'Getyn Campaigns',
    template: '%s · Getyn Campaigns',
  },
  description:
    'Email, WhatsApp, and SMS marketing campaigns with an AI copilot and drag-drop email builder.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
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
