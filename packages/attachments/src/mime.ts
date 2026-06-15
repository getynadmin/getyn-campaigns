/**
 * MIME allowlist + classification.
 *
 * The set is small and explicit: anything outside it is rejected at
 * the upload route. We do not maintain an "almost-fine" tier — if a
 * type isn't here, it doesn't upload. Adding a type is intentional
 * (parser + summarizer + UI preview all have to handle it).
 */
import type { AttachmentType } from './attachment-type';

export const ALLOWED_MIME_TYPES = [
  // Images (browser-rendered + Claude vision-capable)
  'image/png',
  'image/jpeg',
  'image/webp',
  // PDF
  'application/pdf',
  // Spreadsheets
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMime(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Map a verified MIME type to the coarse `AttachmentType` enum that
 * routes parser + summarizer behaviour. Throws on unknown MIME — the
 * caller should already have verified against the allowlist.
 */
export function classifyAttachment(mime: AllowedMimeType): AttachmentType {
  switch (mime) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
      return 'IMAGE';
    case 'application/pdf':
      return 'PDF';
    case 'text/csv':
    case 'application/vnd.ms-excel':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'SPREADSHEET';
    case 'application/msword':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'DOCUMENT';
  }
}

/** Suggested file extension for objects written to Storage. */
export function extensionFor(mime: AllowedMimeType): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'application/pdf':
      return 'pdf';
    case 'text/csv':
      return 'csv';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
  }
}

/** Cap enforced by the upload route. Worker handlers assume buffers
 *  fit comfortably in memory under this. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
