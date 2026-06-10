'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Phase 5.9 — silent SSO probe.
 *
 * Drops a hidden iframe pointing at /api/auth/login/auth0?silent=1
 * which round-trips through Auth0 with `prompt=none`. Auth0 either
 *   - Responds with an authorization code (user has a session on the
 *     IdP — common when they signed in to /myaccount on getyn.com),
 *     our callback mints the Campaigns session cookie and the iframe
 *     posts a message telling the parent to navigate.
 *   - Responds with `error=login_required` (or `consent_required` /
 *     `interaction_required`) — the iframe posts a "failed" message
 *     and we silently drop the iframe so the regular login UI is
 *     usable.
 *
 * Safari ITP and Brave block third-party iframe cookies aggressively;
 * silent SSO will be unreliable there. The fallback is the
 * "Sign in with Getyn" button which already works in all browsers.
 */
export function SilentSsoProbe({
  enabled,
  returnTo,
}: {
  enabled: boolean;
  returnTo?: string | null;
}): JSX.Element | null {
  const [active, setActive] = useState(enabled);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Defensive timeout — if the iframe never responds (Safari ITP
    // dropping cookies, network block, …) we drop it after 3s so the
    // page isn't permanently in "checking" state.
    const timeout = window.setTimeout(() => setActive(false), 3000);
    const onMessage = (event: MessageEvent) => {
      // Same-origin only — Auth0 doesn't post to the parent; only
      // our callback HTML does, and that loads from this app's origin.
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { type?: string; ok?: boolean; redirectTo?: string }
        | undefined;
      if (!data || data.type !== 'getyn-silent-sso') return;
      window.clearTimeout(timeout);
      if (data.ok && data.redirectTo) {
        // Cookie is already set on our domain — navigate the top
        // frame and the new request carries the session.
        window.location.href = data.redirectTo;
        return;
      }
      // No IdP session — drop the iframe, fall through to the
      // visible login UI.
      setActive(false);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
    };
  }, [enabled]);

  if (!enabled || !active) return null;

  const src =
    '/api/auth/login/auth0?silent=1' +
    (returnTo ? `&return_to=${encodeURIComponent(returnTo)}` : '');

  return (
    <>
      {/* Hidden iframe — does the actual prompt=none round-trip. */}
      <iframe
        ref={iframeRef}
        src={src}
        title="Silent Getyn SSO probe"
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none absolute size-0 opacity-0"
      />
      {/* Tiny "checking" overlay so the page doesn't briefly flash
          the login form before the probe resolves. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-2 text-[11px] text-white/50">
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" />
          Checking for an existing Getyn session…
        </span>
      </div>
    </>
  );
}
