import Script from 'next/script';

import type { ResolvedTrackingPixels } from '@/server/integrations/tracking-pixels';

/**
 * Unified marketing tracking tags: Meta Pixel + gtag.js (GA4 +
 * Google Ads). Server-rendered; renders nothing when tracking is
 * disabled or no IDs are configured.
 *
 * Events:
 *  - PageView (Meta) + `page_view` (gtag) fire automatically.
 *  - `addToCart` prop fires Meta `AddToCart` + Google Ads conversion
 *    `{adsConversionId}/{adsAddToCartLabel}` when both are set.
 *  - `purchase` prop fires Meta `Purchase` + Google Ads conversion
 *    `{adsConversionId}/{adsPurchaseLabel}` + GA4 `purchase`.
 */
export function TrackingTags({
  pixels,
  addToCart,
  purchase,
}: {
  pixels: ResolvedTrackingPixels;
  addToCart?: { valueCents: number; currency: string };
  purchase?: {
    valueCents: number;
    currency: string;
    transactionId?: string;
  };
}): JSX.Element | null {
  if (!pixels.enabled) return null;
  const {
    metaPixelId,
    gaId,
    gtagId,
    adsConversionId,
    adsPurchaseLabel,
    adsAddToCartLabel,
  } = pixels;

  const hasMeta = !!metaPixelId;
  const hasGtag = !!(gaId || gtagId || adsConversionId);
  if (!hasMeta && !hasGtag) return null;

  // De-duplicated list of gtag `config` ids (GA4 / Google Tag / Ads
  // can be the same AW- id; config once).
  const gtagIds = Array.from(
    new Set([gaId, gtagId, adsConversionId].filter((v): v is string => !!v)),
  );
  const gtagLoader = gtagIds[0] ?? null;

  // Build dynamic event lines
  const metaEvents: string[] = [];
  const gtagEvents: string[] = [];

  if (addToCart) {
    const v = (addToCart.valueCents / 100).toFixed(2);
    const c = addToCart.currency || 'USD';
    if (hasMeta) {
      metaEvents.push(
        `fbq('track','AddToCart',{value:${v},currency:'${c}'});`,
      );
    }
    if (adsConversionId && adsAddToCartLabel) {
      gtagEvents.push(
        `gtag('event','conversion',{send_to:'${adsConversionId}/${adsAddToCartLabel}',value:${v},currency:'${c}'});`,
      );
    }
  }

  if (purchase) {
    const v = (purchase.valueCents / 100).toFixed(2);
    const c = purchase.currency || 'USD';
    const txn = purchase.transactionId
      ? `,transaction_id:'${purchase.transactionId.replace(/'/g, '')}'`
      : '';
    if (hasMeta) {
      metaEvents.push(
        `fbq('track','Purchase',{value:${v},currency:'${c}'});`,
      );
    }
    if (adsConversionId && adsPurchaseLabel) {
      gtagEvents.push(
        `gtag('event','conversion',{send_to:'${adsConversionId}/${adsPurchaseLabel}',value:${v},currency:'${c}'${txn}});`,
      );
    }
    if (gaId) {
      gtagEvents.push(
        `gtag('event','purchase',{value:${v},currency:'${c}'${txn}});`,
      );
    }
  }

  return (
    <>
      {hasMeta ? (
        <>
          <Script id="meta-pixel-base" strategy="afterInteractive">{`
            !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
            n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
            document,'script','https://connect.facebook.net/en_US/fbevents.js');
            fbq('init','${metaPixelId}');
            fbq('track','PageView');
            ${metaEvents.join('\n')}
          `}</Script>
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              alt=""
              src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      ) : null}

      {hasGtag && gtagLoader ? (
        <>
          <Script
            id="gtag-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagLoader}`}
          />
          <Script id="gtag-init" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            ${gtagIds.map((id) => `gtag('config','${id}');`).join('\n')}
            ${gtagEvents.join('\n')}
          `}</Script>
        </>
      ) : null}
    </>
  );
}
