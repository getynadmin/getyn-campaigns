'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/trpc';

/**
 * Phase 4 M11 — Embedded Signup button.
 *
 * Loads Meta's Facebook JS SDK on mount, then on click invokes
 * `FB.login` with our pre-configured config_id. Meta handles the
 * full WABA setup flow inside its own popup; on success the SDK
 * delivers a code + the chosen wabaId/phoneNumberId via a
 * `WA_EMBEDDED_SIGNUP` postMessage and the auth response. We POST
 * those to `whatsAppAccount.completeEmbeddedSignup` to finish the
 * server-side connect.
 *
 * Hidden when META_APP_ID / META_CONFIG_ID aren't configured at
 * build time — the manual flow remains available regardless.
 *
 * # Why we use postMessage to capture wabaId
 * `FB.login`'s `authResponse` carries the OAuth code, but doesn't
 * include the WABA ID the user chose. Meta delivers that via a
 * `window.message` event with `event: 'FINISH'` and `data: {
 * waba_id, phone_number_id }`. We listen for both, debounce the
 * combined result, then call the server.
 */

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID;

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; version: string; xfbml?: boolean }) => void;
      login: (
        cb: (resp: {
          authResponse?: { code?: string; accessToken?: string };
          status?: string;
        }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

export function EmbeddedSignupButton({
  onSuccess,
}: {
  onSuccess: () => void;
}): JSX.Element | null {
  const [sdkReady, setSdkReady] = useState(false);
  const [pending, setPending] = useState(false);
  const wabaInfoRef = useRef<{
    wabaId?: string;
    phoneNumberId?: string;
  }>({});

  const complete = api.whatsAppAccount.completeEmbeddedSignup.useMutation({
    onSuccess: () => {
      toast.success('WhatsApp Business account connected via Meta.');
      onSuccess();
      setPending(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setPending(false);
    },
  });

  // Load FB SDK once.
  useEffect(() => {
    if (!META_APP_ID) return;
    if (typeof window === 'undefined') return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = (): void => {
      window.FB!.init({
        appId: META_APP_ID,
        version: 'v21.0',
        xfbml: false,
      });
      setSdkReady(true);
    };
    const existing = document.getElementById('facebook-jssdk');
    if (existing) return;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    document.body.appendChild(script);
  }, []);

  // Listen for Embedded-Signup postMessage events that carry the
  // chosen wabaId + phoneNumberId.
  useEffect(() => {
    function handleMessage(ev: MessageEvent): void {
      // Meta posts from facebook.com origins — accept any HTTPS
      // facebook host. Mismatched origin: ignore silently.
      try {
        const url = new URL(ev.origin);
        if (!/(^|\.)facebook\.com$/.test(url.hostname)) return;
      } catch {
        return;
      }
      let data: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
      try {
        data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH' && data.data) {
        wabaInfoRef.current = {
          wabaId: data.data.waba_id,
          phoneNumberId: data.data.phone_number_id,
        };
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!META_APP_ID || !META_CONFIG_ID) return null;

  const onClick = (): void => {
    if (!window.FB) {
      toast.error('Facebook SDK not loaded yet. Try again in a moment.');
      return;
    }
    setPending(true);
    wabaInfoRef.current = {};
    window.FB.login(
      (resp) => {
        if (!resp.authResponse?.code) {
          setPending(false);
          if (resp.status !== 'unknown') {
            toast.error('Connection cancelled.');
          }
          return;
        }
        const code = resp.authResponse.code;
        // Allow up to 800ms for the postMessage with wabaId to arrive.
        // In our experience it lands before the FB.login callback —
        // this timeout is a safety net.
        const start = Date.now();
        const interval = setInterval(() => {
          if (
            wabaInfoRef.current.wabaId ||
            Date.now() - start > 800
          ) {
            clearInterval(interval);
            const wabaId = wabaInfoRef.current.wabaId;
            if (!wabaId) {
              setPending(false);
              toast.error(
                'Could not capture WABA id from Meta. Try again or use manual connect.',
              );
              return;
            }
            complete.mutate({
              code,
              wabaId,
              ...(wabaInfoRef.current.phoneNumberId
                ? { phoneNumberId: wabaInfoRef.current.phoneNumberId }
                : {}),
            });
          }
        }, 100);
      },
      {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          feature: 'whatsapp_embedded_signup',
          version: 2,
        },
      },
    );
  };

  return (
    <Button
      variant="default"
      onClick={onClick}
      disabled={!sdkReady || pending || complete.isPending}
    >
      {(pending || complete.isPending) && (
        <Loader2 className="mr-2 size-4 animate-spin" />
      )}
      <FacebookGlyph className="mr-2 size-4" />
      Connect with Facebook
    </Button>
  );
}

function FacebookGlyph({
  className,
}: {
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02z" />
    </svg>
  );
}
