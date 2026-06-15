/**
 * Phase 7.1 — shared shapes for parsed attachment content.
 *
 * These shapes are also the on-disk format of
 * `AgentAttachment.parsedContent` (JSONB). The worker writes one of
 * these per attachment depending on `attachmentType`; the agent
 * runtime reads them back when surfacing `inspect_attachment` /
 * `inspect_spreadsheet` results.
 */

export interface ImageParsedContent {
  width: number;
  height: number;
  /** Supabase Storage path of the 200x200 thumbnail. Same bucket
   *  as the original — sibling object with `.thumb.webp` suffix. */
  thumbnailPath: string;
  /** Original format reported by `sharp.metadata()`. */
  format: string;
}

export interface PdfParsedContent {
  pageCount: number;
  /** Up to ~200k chars of extracted text. Truncated if larger; the
   *  `truncated` flag tells the agent to mention that in summaries. */
  textContent: string;
  truncated: boolean;
  /** Storage paths of the first up-to-10 pages rendered as images
   *  (PNG). Empty when page rendering is unavailable on this host
   *  (e.g. GraphicsMagick not installed). Vision tools fall back to
   *  textContent in that case. */
  pageImages: string[];
}

/** Coarse column-type guesses used by the Audience Agent to seed
 *  `propose_column_mapping`. Filled by a small regex pass over the
 *  first 20 values. */
export type ColumnTypeGuess =
  | 'email'
  | 'phone'
  | 'date'
  | 'number'
  | 'url'
  | 'text';

export interface SpreadsheetParsedContent {
  /** Column header strings in source order. */
  columns: string[];
  /** Total row count across the file (header excluded). For CSV this
   *  is the streaming count; for xlsx it's the sheet's used range. */
  rowCount: number;
  /** First 100 rows as `{ [column]: string }`. Strings to keep the
   *  shape predictable — the import worker re-parses on the way in. */
  sampleRows: Array<Record<string, string>>;
  /** Column-name -> guessed semantic type. */
  columnTypeGuesses: Record<string, ColumnTypeGuess>;
  /** For xlsx, names of all sheets present (in workbook order). */
  sheetNames?: string[];
  /** Name of the sheet whose rows we captured (xlsx). */
  activeSheet?: string;
}

export interface DocxParsedContent {
  /** Plain-text extraction. Capped at 50_000 chars; longer documents
   *  set `truncated: true`. */
  text: string;
  wordCount: number;
  /** Heading text in document order. Used by the summarizer prompt. */
  headings: string[];
  truncated: boolean;
}

export type AttachmentParsedContent =
  | { kind: 'image'; data: ImageParsedContent }
  | { kind: 'pdf'; data: PdfParsedContent }
  | { kind: 'spreadsheet'; data: SpreadsheetParsedContent }
  | { kind: 'document'; data: DocxParsedContent };
