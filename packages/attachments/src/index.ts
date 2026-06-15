/**
 * Light entry — MIME allowlist, magic-byte verifier, type shapes.
 * Safe to import from the Next.js web bundle: pulls only `file-type`
 * (small, pure JS).
 *
 * For parsers (sharp, pdf-parse, mammoth, xlsx) import
 * `@getyn/attachments/parsers` — worker-only.
 */
export {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  classifyAttachment,
  extensionFor,
  isAllowedMime,
  type AllowedMimeType,
} from './mime';
export {
  AttachmentVerifyError,
  verifyAttachment,
  type VerifiedFile,
} from './verify';
export type { AttachmentType } from './attachment-type';
export type {
  AttachmentParsedContent,
  ColumnTypeGuess,
  DocxParsedContent,
  ImageParsedContent,
  PdfParsedContent,
  SpreadsheetParsedContent,
} from './types';
