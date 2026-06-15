/**
 * Phase 7 M5 — lightweight server-side HTML renderer for design plans.
 *
 * The composer (M3) produces Unlayer JSON for the final draft, but
 * Unlayer can't run in a Node response — so the chat's live preview
 * pane needs a separate, cheap renderer that approximates the same
 * visual without loading the editor.
 *
 * Strategy: walk the design plan, emit a minimal styled HTML block
 * per slug, substitute the agent-provided content + brand defaults.
 * Pixel fidelity isn't the goal — "does this look roughly like what
 * I'm going to ship?" is.
 */
import { prisma } from '@getyn/db';
import type { TenantBrandProfile } from '@getyn/db';

export interface PlanBlockInput {
  slug: string;
  content: Record<string, unknown>;
}

export interface RenderPreviewArgs {
  plan: PlanBlockInput[];
  brand: TenantBrandProfile | null;
  postalAddress: string | null;
}

export async function renderEmailPlanHtml(
  args: RenderPreviewArgs,
): Promise<string> {
  if (args.plan.length === 0) {
    return wrap(args.brand, '<p style="text-align:center;color:#9ca3af">Empty design — the agent hasn\'t proposed a plan yet.</p>');
  }
  // Pull template categories so we can render the right block kind.
  const slugs = Array.from(new Set(args.plan.map((b) => b.slug)));
  const templates = await prisma.emailBlockTemplate.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, category: true },
  });
  const categoryBySlug = new Map(
    templates.map((t) => [t.slug, t.category]),
  );

  const blocks: string[] = [];
  args.plan.forEach((b, idx) => {
    const merged = mergeWithBrandDefaults(b.content, args.brand, args.postalAddress);
    blocks.push(renderBlock(b.slug, categoryBySlug.get(b.slug), merged, idx, args.brand));
  });

  return wrap(args.brand, blocks.join('\n'));
}

function wrap(brand: TenantBrandProfile | null, body: string): string {
  const primary = brand?.primaryColor ?? '#7c3aed';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{margin:0;font-family:-apple-system,Segoe UI,system-ui,sans-serif;color:#0f172a;background:#f3f4f6;}
  .gy-email{max-width:600px;margin:0 auto;background:#ffffff;}
  .gy-block{padding:16px 24px;}
  .gy-h1{font-size:28px;font-weight:700;margin:0 0 8px;line-height:1.2;}
  .gy-h2{font-size:22px;font-weight:600;margin:0 0 6px;line-height:1.25;}
  .gy-h3{font-size:16px;font-weight:600;margin:0 0 4px;line-height:1.3;}
  .gy-p{margin:0 0 8px;line-height:1.55;color:#334155;font-size:15px;}
  .gy-cta{display:inline-block;padding:12px 22px;background:${primary};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;}
  .gy-cta-wrap{padding:8px 0 4px;}
  .gy-img{display:block;max-width:100%;height:auto;border-radius:8px;}
  .gy-cols{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;}
  .gy-col{flex:1;min-width:0;}
  .gy-quote{border-left:3px solid ${primary};padding:4px 0 4px 16px;color:#334155;font-style:italic;font-size:16px;}
  .gy-quote-attr{color:#94a3b8;font-size:13px;margin-top:6px;}
  .gy-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .gy-divider{height:1px;background:#e5e7eb;margin:8px 0;}
  .gy-footer{padding:24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center;border-top:1px solid #e5e7eb;}
  .gy-footer a{color:#64748b;}
  .gy-list{margin:0;padding-left:18px;color:#334155;line-height:1.6;}
  .gy-placeholder{display:block;padding:8px;border:1px dashed #cbd5e1;color:#94a3b8;font-style:italic;font-size:13px;text-align:center;border-radius:6px;}
  </style></head><body><div class="gy-email">${body}</div></body></html>`;
}

function renderBlock(
  slug: string,
  category: string | undefined,
  c: Record<string, unknown>,
  idx: number,
  brand: TenantBrandProfile | null,
): string {
  const v = (k: string, fallback = ''): string => esc(String(c[k] ?? fallback));
  void brand;
  switch (slug) {
    case 'hero_image_top':
      return wrapBlock(
        `${img(v('image_url'))}
         <h1 class="gy-h1" style="text-align:center">${v('heading', 'Heading')}</h1>
         <p class="gy-p" style="text-align:center">${v('subheading')}</p>
         <p class="gy-cta-wrap" style="text-align:center">${cta(v('cta_label', 'Learn more'), v('cta_url', '#'))}</p>`,
        idx,
      );
    case 'hero_text_only':
      return wrapBlock(
        `<h1 class="gy-h1">${v('heading', 'Heading')}</h1>
         <p class="gy-p">${v('intro')}</p>
         <p class="gy-cta-wrap">${cta(v('cta_label', 'Learn more'), v('cta_url', '#'))}</p>`,
        idx,
      );
    case 'image_text_split':
      return wrapBlock(
        `<div class="gy-cols">
           <div class="gy-col">${img(v('image_url'))}</div>
           <div class="gy-col">
             <h2 class="gy-h2">${v('heading', 'Heading')}</h2>
             <p class="gy-p">${v('body')}</p>
           </div>
         </div>`,
        idx,
      );
    case 'text_image_split':
      return wrapBlock(
        `<div class="gy-cols">
           <div class="gy-col">
             <h2 class="gy-h2">${v('heading', 'Heading')}</h2>
             <p class="gy-p">${v('body')}</p>
           </div>
           <div class="gy-col">${img(v('image_url'))}</div>
         </div>`,
        idx,
      );
    case 'three_columns_features':
      return wrapBlock(
        `<div class="gy-cols">
          ${[1, 2, 3]
            .map(
              (n) => `<div class="gy-col">
                ${img(v(`icon_${n}`))}
                <h3 class="gy-h3" style="text-align:center">${v(`heading_${n}`)}</h3>
                <p class="gy-p" style="text-align:center;font-size:13px">${v(`body_${n}`)}</p>
              </div>`,
            )
            .join('')}
         </div>`,
        idx,
      );
    case 'single_cta_button':
      return wrapBlock(
        `<p class="gy-p" style="text-align:center">${v('intro')}</p>
         <p class="gy-cta-wrap" style="text-align:center">${cta(v('cta_label', 'Learn more'), v('cta_url', '#'))}</p>`,
        idx,
      );
    case 'quote_block':
      return wrapBlock(
        `<blockquote class="gy-quote">"${v('quote', 'Quote')}"
           <div class="gy-quote-attr">— ${v('attribution', 'Attribution')}</div>
         </blockquote>`,
        idx,
      );
    case 'image_grid_2x2':
      return wrapBlock(
        `<div class="gy-grid">
          ${[1, 2, 3, 4]
            .map((n) => img(v(`image_${n}`), v(`alt_${n}`, '')))
            .join('')}
         </div>`,
        idx,
      );
    case 'spacer_divider':
      return `<div class="gy-block"><div class="gy-divider"></div></div>`;
    case 'text_paragraph':
      return wrapBlock(`<p class="gy-p">${v('body')}</p>`, idx);
    case 'numbered_list':
      return wrapBlock(
        `<h2 class="gy-h2">${v('heading', 'List')}</h2>
         <ol class="gy-list">
          ${[1, 2, 3, 4, 5]
            .map((n) => {
              const item = v(`item_${n}`);
              return item ? `<li>${item}</li>` : '';
            })
            .join('')}
         </ol>`,
        idx,
      );
    case 'footer_minimal':
    case 'footer_social':
      return `<div class="gy-footer">
        <div style="margin-bottom:6px">${v('brand_name')} · ${v('address')}</div>
        <a href="${v('unsubscribe_url', '#')}">Unsubscribe</a>
        ${
          slug === 'footer_social'
            ? ` · <a href="${v('social_url_1', '#')}">${v('social_label_1', 'social')}</a>` +
              ` · <a href="${v('social_url_2', '#')}">${v('social_label_2', 'social')}</a>`
            : ''
        }
      </div>`;
    default:
      return `<div class="gy-block"><span class="gy-placeholder">[${esc(slug)}] no preview renderer wired</span></div>`;
  }
}

function wrapBlock(inner: string, idx: number): string {
  return `<div class="gy-block" data-block-index="${idx}">${inner}</div>`;
}

function img(url: string, alt = ''): string {
  if (!url) {
    return `<div class="gy-placeholder">No image yet</div>`;
  }
  // eslint-disable-next-line @next/next/no-img-element -- server-rendered preview, not Next.js Image
  return `<img class="gy-img" src="${esc(url)}" alt="${esc(alt)}" />`;
}

function cta(label: string, href: string): string {
  return `<a class="gy-cta" href="${esc(href)}">${esc(label)}</a>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mergeWithBrandDefaults(
  content: Record<string, unknown>,
  brand: TenantBrandProfile | null,
  postalAddress: string | null,
): Record<string, unknown> {
  return {
    brand_name: brand?.brandName ?? 'Your brand',
    logo_url: brand?.logoUrl ?? '',
    address: postalAddress ?? '',
    unsubscribe_url: '#',
    webview_url: '#',
    primary_color: brand?.primaryColor ?? '#7c3aed',
    accent_color: brand?.accentColor ?? brand?.primaryColor ?? '#7c3aed',
    ...content,
  };
}
