/**
 * Image parser: strip EXIF, produce a 200x200 thumbnail, capture
 * dimensions + format.
 *
 * EXIF stripping is mandatory — uploads frequently carry GPS, device,
 * and author metadata. `sharp.rotate()` honours the EXIF orientation
 * flag before stripping (otherwise iPhone portraits would land sideways),
 * then `withMetadata(false)` drops the rest.
 */
import sharp from 'sharp';

import type { ImageParsedContent } from '../types';

export interface ImageParseResult {
  /** EXIF-stripped, orientation-corrected original. Re-upload this
   *  in place of the user's buffer. */
  cleanedOriginal: Buffer;
  /** 200x200 WebP thumbnail. */
  thumbnail: Buffer;
  /** Metadata for AgentAttachment.parsedContent. `thumbnailPath` is
   *  filled by the caller once it decides on a Storage path. */
  metadata: Omit<ImageParsedContent, 'thumbnailPath'>;
}

export async function parseImage(buf: Buffer): Promise<ImageParseResult> {
  const pipeline = sharp(buf, { failOn: 'error' }).rotate();
  const meta = await pipeline.metadata();

  const cleanedOriginal = await pipeline
    .clone()
    // sharp 0.33: withMetadata({}) strips all metadata; the older
    // .withMetadata(false) form is deprecated.
    .toBuffer();

  const thumbnail = await sharp(cleanedOriginal)
    .resize(200, 200, { fit: 'cover', position: 'attention' })
    .webp({ quality: 80 })
    .toBuffer();

  return {
    cleanedOriginal,
    thumbnail,
    metadata: {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      format: meta.format ?? 'unknown',
    },
  };
}
