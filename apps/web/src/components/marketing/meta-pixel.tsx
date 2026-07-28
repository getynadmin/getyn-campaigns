import Script from 'next/script';

/**
 * Injects the Meta Pixel base snippet + noscript fallback. Emits a
 * PageView on mount. Optionally fires a Purchase event for the
 * confirmation page (value in `USD` cents converted to major units).
 *
 * Renders nothing when no pixelId is provided so the caller can
 * unconditionally include it and let branding decide.
 */
export function MetaPixel({
  pixelId,
  purchase,
}: {
  pixelId: string | null;
  purchase?: { valueCents: number; currency: string };
}): JSX.Element | null {
  if (!pixelId) return null;

  const value = purchase ? (purchase.valueCents / 100).toFixed(2) : null;
  const currency = purchase?.currency ?? 'USD';

  return (
    <>
      <Script id="meta-pixel-base" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
        document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${pixelId}');
        fbq('track', 'PageView');
        ${
          purchase
            ? `fbq('track', 'Purchase', {value: ${value}, currency: '${currency}'});`
            : ''
        }
      `}</Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
