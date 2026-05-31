/**
 * Phase 5.6 M5 — site branding resolver.
 *
 * Singleton SiteBrandingSettings row. Resolved with React cache so a
 * single request only hits the DB once even when the layout,
 * metadata, and a child component all read it.
 *
 * Every field is nullable on the DB side. This module substitutes
 * hard-coded defaults so the app never breaks on a clean install or
 * when a field hasn't been set yet.
 */
import { cache } from 'react';

import { prisma } from '@getyn/db';

export interface ResolvedBranding {
  appName: string;
  defaultSidebarLogoLightUrl: string | null;
  defaultSidebarLogoDarkUrl: string | null;
  loginPageLogoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  loginPageTagline: string | null;
  footerText: string | null;
  customCss: string | null;
}

const DEFAULTS: ResolvedBranding = {
  appName: 'Getyn Campaigns',
  defaultSidebarLogoLightUrl: null,
  defaultSidebarLogoDarkUrl: null,
  loginPageLogoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  accentColor: null,
  loginPageTagline: null,
  footerText: null,
  customCss: null,
};

async function load(): Promise<ResolvedBranding> {
  try {
    const row = await prisma.siteBrandingSettings.findUnique({
      where: { id: 'singleton' },
    });
    if (!row) return DEFAULTS;
    return {
      appName: row.appName || DEFAULTS.appName,
      defaultSidebarLogoLightUrl: row.defaultSidebarLogoLightUrl,
      // Dark falls back to light when not set.
      defaultSidebarLogoDarkUrl:
        row.defaultSidebarLogoDarkUrl ?? row.defaultSidebarLogoLightUrl,
      loginPageLogoUrl: row.loginPageLogoUrl,
      faviconUrl: row.faviconUrl,
      primaryColor: row.primaryColor,
      accentColor: row.accentColor,
      loginPageTagline: row.loginPageTagline,
      footerText: row.footerText,
      customCss: row.customCss,
    };
  } catch {
    // DB unreachable / migration not applied — never crash the layout.
    return DEFAULTS;
  }
}

export const getSiteBranding = cache(load);
