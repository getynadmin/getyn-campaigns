/**
 * DOCX parser via `mammoth`. Extracts plain text + headings.
 *
 * Headings come from mammoth's HTML conversion — we scrape <h1>-<h6>
 * out of the HTML pass and use the raw-text pass for the body text.
 */
import mammoth from 'mammoth';

import type { DocxParsedContent } from '../types';

const TEXT_CAP = 50_000;
const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export async function parseDocx(buf: Buffer): Promise<DocxParsedContent> {
  const [textRes, htmlRes] = await Promise.all([
    mammoth.extractRawText({ buffer: buf }),
    mammoth.convertToHtml({ buffer: buf }),
  ]);

  const rawText = textRes.value ?? '';
  const truncated = rawText.length > TEXT_CAP;
  const text = truncated ? rawText.slice(0, TEXT_CAP) : rawText;

  const headings: string[] = [];
  for (const m of htmlRes.value.matchAll(HEADING_RE)) {
    const h = stripTags(m[1] ?? '');
    if (h) headings.push(h);
  }

  return {
    text,
    wordCount: wordCount(rawText),
    headings,
    truncated,
  };
}
