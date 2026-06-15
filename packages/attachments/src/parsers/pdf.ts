/**
 * PDF parser — text extraction via `pdf-parse`.
 *
 * Page-image rendering (`pdf2pic` / GraphicsMagick) is intentionally
 * deferred to a later iteration: it requires GraphicsMagick installed
 * on the worker host, and Railway's default image doesn't ship it.
 * For Phase 7.1 the agent runtime falls back to `textContent` when
 * `pageImages` is empty — works for brand guidelines, copy refs,
 * any text-bearing PDF. Image-only PDFs (e.g. scanned brochures)
 * land as "no readable text" until we wire OCR.
 */
import pdfParse from 'pdf-parse';

import type { PdfParsedContent } from '../types';

/** Stored text cap. Large enough for ~50-page brand guidelines; safe
 *  for JSONB storage. */
const TEXT_CAP = 200_000;

export async function parsePdf(buf: Buffer): Promise<PdfParsedContent> {
  const result = await pdfParse(buf);
  const rawText = result.text ?? '';
  const truncated = rawText.length > TEXT_CAP;
  const textContent = truncated ? rawText.slice(0, TEXT_CAP) : rawText;
  return {
    pageCount: result.numpages ?? 0,
    textContent,
    truncated,
    pageImages: [],
  };
}
