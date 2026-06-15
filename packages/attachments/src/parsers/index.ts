/**
 * Worker-only re-exports. Heavy native deps (sharp, pdf-parse,
 * mammoth, xlsx) land in the bundle for any consumer of this entry,
 * so the web app imports `@getyn/attachments` directly (light) and
 * the worker imports `@getyn/attachments/parsers` (heavy).
 */
export { parseImage } from './image';
export { parseCsv } from './csv';
export { parseXlsx } from './xlsx';
export { parsePdf } from './pdf';
export { parseDocx } from './docx';
