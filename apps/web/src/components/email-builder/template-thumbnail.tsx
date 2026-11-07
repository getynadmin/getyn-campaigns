'use client';

import { useMemo } from 'react';

import { renderTemplateHtml } from '@/lib/render-template-html';

/**
 * Live mini-preview of an email template rendered as a scaled iframe
 * (pointer-events: none so it doesn't swallow card clicks). The email
 * is designed at 600px wide; we render it at that width and scale the
 * container down to fit the card's ~286px wide thumbnail area.
 *
 * Why iframe + scale rather than an <img> screenshot? Avoids a
 * server-side render pipeline; always in sync with the live design;
 * free. Cost is some jank if the email has heavy JS (ours don't).
 */
export function TemplateThumbnail({
  design,
  previewMergeTags = true,
}: {
  design: unknown;
  previewMergeTags?: boolean;
}): JSX.Element {
  const srcDoc = useMemo(() => {
    const html = renderTemplateHtml(design);
    const substituted = previewMergeTags
      ? html
          .replace(/\{\{first_name\}\}/g, 'Alex')
          .replace(/\{\{firstName\}\}/g, 'Alex')
          .replace(/\{\{last_name\}\}/g, 'Rivera')
          .replace(/\{\{email\}\}/g, 'alex@example.com')
          .replace(/\{\{tenantName\}\}/g, 'Getyn')
          .replace(/\{\{companyName\}\}/g, 'Getyn')
          .replace(/\{\{unsubscribeUrl\}\}/g, '#')
          .replace(/\{\{webViewUrl\}\}/g, '#')
          .replace(/\{\{orderId\}\}/g, '1024')
          .replace(/\{\{orderDate\}\}/g, 'Nov 7, 2026')
      : html;
    if (!substituted.trim()) {
      return '<div style="padding:40px;text-align:center;color:#94a3b8;font-family:sans-serif;font-size:14px;">Blank template</div>';
    }
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=600"><style>html,body{margin:0;background:#f4f4f7;}</style></head><body>${substituted}</body></html>`;
  }, [design, previewMergeTags]);

  // The iframe is rendered at the email's native 600px wide and we
  // transform-scale it to roughly fit a ~220px compact card
  // (600 * 0.38 ≈ 228). We nudge the iframe up to crop out the
  // email's outer grey padding so the white panel fills the card.
  return (
    <div className="pointer-events-none relative h-full w-full overflow-hidden bg-white">
      <iframe
        title="Template preview"
        srcDoc={srcDoc}
        aria-hidden="true"
        className="absolute h-[1600px] w-[600px] border-0"
        style={{
          transform: 'scale(0.38)',
          transformOrigin: 'top left',
          top: '-14px',
          left: 0,
        }}
        sandbox=""
        loading="lazy"
      />
    </div>
  );
}
