'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  APP_THEME_KEY,
  SIDEBAR_THEME_KEY,
  applyAppTheme,
  applySidebarTheme,
  readPref,
  writePref,
  type ThemePref,
} from './theme';

/**
 * Phase 5.8 — theme reader/writer hook.
 *
 * Hydrates from localStorage on mount, exposes setters that update
 * both storage and the DOM. Also listens to system preference
 * changes so a 'system' setting follows the OS without a refresh.
 */
export function useTheme(): {
  app: ThemePref;
  sidebar: ThemePref;
  setApp: (v: ThemePref) => void;
  setSidebar: (v: ThemePref) => void;
} {
  const [app, setAppState] = useState<ThemePref>('system');
  const [sidebar, setSidebarState] = useState<ThemePref>('system');

  useEffect(() => {
    setAppState(readPref(APP_THEME_KEY));
    setSidebarState(readPref(SIDEBAR_THEME_KEY));
    // System-preference listener so 'system' tracks the OS live.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const a = readPref(APP_THEME_KEY);
      const s = readPref(SIDEBAR_THEME_KEY);
      applyAppTheme(a);
      applySidebarTheme(s, a);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setApp = useCallback(
    (v: ThemePref) => {
      writePref(APP_THEME_KEY, v);
      setAppState(v);
      applyAppTheme(v);
      // App theme changed; if sidebar is 'system' it needs re-apply.
      applySidebarTheme(sidebar, v);
    },
    [sidebar],
  );

  const setSidebar = useCallback(
    (v: ThemePref) => {
      writePref(SIDEBAR_THEME_KEY, v);
      setSidebarState(v);
      applySidebarTheme(v, app);
    },
    [app],
  );

  return { app, sidebar, setApp, setSidebar };
}
