/**
 * Phase 5.8 — independent app + sidebar theme system.
 *
 * Two preferences persisted in localStorage:
 *   getyn:app-theme      → 'light' | 'dark' | 'system'
 *   getyn:sidebar-theme  → 'light' | 'dark' | 'system'  (system = match app)
 *
 * The app theme drives `<html class="dark">` so every Tailwind
 * `dark:` variant flips. The sidebar theme drives
 * `<html data-sidebar-theme="dark">` so the sidebar can override
 * the app theme — Tailwind plugins read the attribute via the
 * `sidebar-dark:` arbitrary variant in tailwind config (see below).
 *
 * No external deps; the `boot` script in <head> runs before React
 * hydrates so we never flash the wrong theme.
 */
export type ThemePref = 'light' | 'dark' | 'system';

export const APP_THEME_KEY = 'getyn:app-theme';
export const SIDEBAR_THEME_KEY = 'getyn:sidebar-theme';

const HTML_DARK_CLASS = 'dark';
const SIDEBAR_ATTR = 'data-sidebar-theme';

function resolveSystem(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function resolveAppTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? resolveSystem() : pref;
}

export function applyAppTheme(pref: ThemePref): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveAppTheme(pref);
  document.documentElement.classList.toggle(HTML_DARK_CLASS, resolved === 'dark');
}

export function applySidebarTheme(
  sidebarPref: ThemePref,
  appPref: ThemePref,
): void {
  if (typeof document === 'undefined') return;
  // 'system' on sidebar means "follow the app theme".
  const effective =
    sidebarPref === 'system'
      ? resolveAppTheme(appPref)
      : sidebarPref === 'dark'
        ? 'dark'
        : 'light';
  document.documentElement.setAttribute(SIDEBAR_ATTR, effective);
}

export function readPref(key: string, fallback: ThemePref = 'system'): ThemePref {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return fallback;
}

export function writePref(key: string, value: ThemePref): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
}

/**
 * Inline script source for the document <head>. Sets classes /
 * attributes before React paints to avoid a light→dark flash.
 *
 * Kept self-contained so it can be injected via
 * dangerouslySetInnerHTML — duplicates the constants on purpose.
 */
export const THEME_BOOT_SCRIPT = `
(function() {
  try {
    var app = localStorage.getItem('${APP_THEME_KEY}') || 'system';
    var sidebar = localStorage.getItem('${SIDEBAR_THEME_KEY}') || 'system';
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var appResolved = app === 'system' ? (prefersDark ? 'dark' : 'light') : app;
    var sidebarResolved = sidebar === 'system' ? appResolved : sidebar;
    if (appResolved === 'dark') document.documentElement.classList.add('${HTML_DARK_CLASS}');
    document.documentElement.setAttribute('${SIDEBAR_ATTR}', sidebarResolved);
  } catch (e) { /* localStorage blocked — fall through to defaults */ }
})();
`;
