/**
 * Phase 7.2 — OpenAI image generation (gpt-image-2).
 *
 * NOTE: file is named `dalle` for historical reasons. OpenAI retired
 * `dall-e-3` in 2026 and consolidated image generation under
 * `gpt-image-2` — the request shape changed:
 *   - `quality` enum is now low|medium|high|auto (not standard|hd)
 *   - `style` parameter is gone (no vivid/natural)
 *   - response is `b64_json` by default (no URL round-trip)
 *   - new sizes: 1024x1024, 1024x1536, 1536x1024
 *
 * Thin wrapper around the REST endpoint — we don't pull the official
 * openai SDK because (a) the dep is heavy, (b) we only call one
 * endpoint, (c) it's trivial.
 *
 * Pricing (gpt-image-2, USD per image, from OpenAI docs):
 *   quality | 1024x1024 | non-square (1024x1536 / 1536x1024)
 *   low     | $0.006    | $0.005
 *   medium  | $0.053    | $0.041
 *   high    | $0.211    | $0.165
 */

export type DalleSize =
  | '1024x1024'
  | '1024x1536'
  | '1536x1024'
  | 'auto';

export type DalleQuality = 'low' | 'medium' | 'high' | 'auto';

/** Kept in the public type for backward-compat with config rows
 *  written by the old DALL-E 3 schema. The new API ignores it; we
 *  drop it before sending. */
export type DalleStyle = 'vivid' | 'natural';

export interface GenerateImageArgs {
  prompt: string;
  apiKey: string;
  model?: string;
  size?: DalleSize;
  quality?: DalleQuality;
  /** Ignored on gpt-image-2; accepted only for backward compatibility
   *  with persisted DALL-E 3 config rows. */
  style?: DalleStyle;
}

export interface GenerateImageResult {
  /** PNG bytes — decoded from the API's b64_json response. */
  imageBytes: Buffer;
  /** gpt-image-2 doesn't expose a `revised_prompt` field; we echo
   *  the user's prompt so the badge tooltip still has something to
   *  show. */
  revisedPrompt: string;
  costUsd: number;
  size: DalleSize;
  quality: DalleQuality;
  model: string;
}

export class DalleGenerationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'DalleGenerationError';
  }
}

/** Compute the per-image cost. `auto` collapses to `medium` /
 *  `1024x1024` for the estimator — the real call may pick something
 *  else but we cost-check up front so we never blow the conversation
 *  cap by surprise. */
export function computeDalleCost(
  size: DalleSize,
  quality: DalleQuality,
): number {
  const q: 'low' | 'medium' | 'high' = quality === 'auto' ? 'medium' : quality;
  const square = size === '1024x1024' || size === 'auto';
  if (q === 'low') return square ? 0.006 : 0.005;
  if (q === 'medium') return square ? 0.053 : 0.041;
  return square ? 0.211 : 0.165;
}

/** Wire-format quality — the API accepts low/medium/high/auto. */
function wireQuality(q: DalleQuality): DalleQuality {
  return q;
}

/**
 * Run a single image generation. Throws on any failure — callers
 * catch and surface to the agent tool result so the conversation
 * can continue.
 */
export async function generateImage(
  args: GenerateImageArgs,
): Promise<GenerateImageResult> {
  const model = args.model ?? 'gpt-image-2';
  const size = args.size ?? '1024x1024';
  const quality = args.quality ?? 'medium';

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: args.prompt,
      n: 1,
      size,
      quality: wireQuality(quality),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    throw new DalleGenerationError(
      body?.error?.message ?? `OpenAI returned ${res.status} ${res.statusText}`,
      res.status,
      body?.error?.code,
    );
  }
  const json = (await res.json()) as {
    data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  const item = json.data[0];
  if (!item) {
    throw new DalleGenerationError(
      'OpenAI returned no image data.',
      500,
      'no_image',
    );
  }

  let imageBytes: Buffer;
  if (item.b64_json) {
    imageBytes = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const dl = await fetch(item.url);
    if (!dl.ok) {
      throw new DalleGenerationError(
        `Could not download generated image: ${dl.status} ${dl.statusText}`,
        dl.status,
        'download_failed',
      );
    }
    imageBytes = Buffer.from(await dl.arrayBuffer());
  } else {
    throw new DalleGenerationError(
      'OpenAI returned neither b64_json nor url.',
      500,
      'no_image',
    );
  }

  return {
    imageBytes,
    revisedPrompt: item.revised_prompt ?? args.prompt,
    costUsd: computeDalleCost(size, quality),
    size,
    quality,
    model,
  };
}
