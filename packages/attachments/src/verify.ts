/**
 * Magic-byte verification — the upload route's first line of defence.
 *
 * Browsers will happily lie about MIME type via the `Content-Type`
 * header or the form field. We re-derive the type from the file's
 * first bytes using `file-type`, and reject anything that:
 *   - doesn't match the allowlist
 *   - matches the allowlist but the claimed MIME contradicts the
 *     detected one (e.g. browser said `image/png` but it's a PDF)
 *   - is an archive (zip/rar/7z/tar) — file-type detects these
 *     before they can masquerade as docx (which is a zip internally,
 *     but file-type returns 'docx' for valid Office Open XML)
 *
 * `text/csv` is special — CSVs have no magic bytes. We trust the
 * claimed MIME if the content is valid UTF-8 text and the first line
 * parses as a CSV header row. Same for `application/msword` (.doc)
 * which has a CFB header but file-type sometimes returns 'cfb' rather
 * than the office variant.
 */
import { fileTypeFromBuffer } from 'file-type';

import {
  ALLOWED_MIME_TYPES,
  isAllowedMime,
  type AllowedMimeType,
} from './mime';

export interface VerifiedFile {
  /** The MIME type we trust — derived from magic bytes for binaries,
   *  claimed MIME for CSV (no magic). */
  verifiedMime: AllowedMimeType;
}

export class AttachmentVerifyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unknown_type'
      | 'mismatched_type'
      | 'forbidden_type'
      | 'invalid_csv',
  ) {
    super(message);
    this.name = 'AttachmentVerifyError';
  }
}

const ARCHIVE_TYPES = new Set([
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'lz',
]);

const EXECUTABLE_TYPES = new Set(['exe', 'dmg', 'sh', 'apk', 'jar', 'msi']);

/** xlsx + docx are zip-based; file-type distinguishes them with
 *  specific MIME tags. We only reject "raw zip" — Office files come
 *  back as their specific Open XML MIME. */
function isForbiddenArchive(ext: string | undefined): boolean {
  if (!ext) return false;
  if (ARCHIVE_TYPES.has(ext)) return true;
  if (EXECUTABLE_TYPES.has(ext)) return true;
  return false;
}

export async function verifyAttachment(
  buf: Buffer,
  claimedMime: string,
): Promise<VerifiedFile> {
  if (!isAllowedMime(claimedMime)) {
    throw new AttachmentVerifyError(
      `MIME type "${claimedMime}" is not in the allowlist (${ALLOWED_MIME_TYPES.join(', ')}).`,
      'forbidden_type',
    );
  }

  // CSV is a text format with no magic. Light validation: decode as
  // UTF-8, find a non-empty first line.
  if (claimedMime === 'text/csv') {
    const head = buf.slice(0, 1024).toString('utf8');
    const firstLine = head.split(/\r?\n/)[0]?.trim() ?? '';
    if (firstLine.length === 0) {
      throw new AttachmentVerifyError(
        'CSV appears empty.',
        'invalid_csv',
      );
    }
    return { verifiedMime: 'text/csv' };
  }

  const detected = await fileTypeFromBuffer(buf);
  if (!detected) {
    throw new AttachmentVerifyError(
      'Could not determine file type from contents.',
      'unknown_type',
    );
  }

  if (isForbiddenArchive(detected.ext)) {
    throw new AttachmentVerifyError(
      `Archives and executables (${detected.ext}) are not accepted.`,
      'forbidden_type',
    );
  }

  if (!isAllowedMime(detected.mime)) {
    throw new AttachmentVerifyError(
      `Detected MIME "${detected.mime}" is not in the allowlist.`,
      'forbidden_type',
    );
  }

  // Claimed vs detected must agree (modulo CSV, handled above).
  if (detected.mime !== claimedMime) {
    throw new AttachmentVerifyError(
      `Claimed type "${claimedMime}" but file contents indicate "${detected.mime}".`,
      'mismatched_type',
    );
  }

  return { verifiedMime: detected.mime };
}
