/**
 * Phase 7.2 — DALL-E 3 image generation.
 *
 * Thin wrapper around the REST endpoint — we don't pull the official
 * openai SDK because (a) the dep is heavy, (b) we only call one
 * endpoint, (c) the SDK's image response shape doesn't expose the
 * URL → buffer download cleanly anyway.
 *
 * Pricing (dall-e-3, USD per image):
 *   - standard 1024x1024            : $0.040
 *   - standard 1024x1792 / 1792x1024: $0.080
 *   - hd       1024x1024            : $0.080
 *   - hd       1024x1792 / 1792x1024: $0.120
 */

export type DalleSize = '1024x1024' | '1792x1024' | '1024x1792';
export type DalleQuality = 'standard' | 'hd';
export type DalleStyle = 'vivid' | 'natural';

export interface GenerateImageArgs {
  prompt: string;
  apiKey: string;
  model?: string;
  size?: DalleSize;
  quality?: DalleQuality;
  style?: DalleStyle;
}

export interface GenerateImageResult {
  /** PNG bytes downloaded from OpenAI's URL — caller uploads to
   *  Supabase Storage and persists the AgentAttachment row. */
  imageBytes: Buffer;
  /** OpenAI's notion of the prompt it actually ran (DALL-E 3 rewrites
   *  prompts internally). Surface this to the user via the
   *  "AI generated" badge tooltip so they understand what they got. */
  revisedPrompt: string;
  costUsd: number;
  size: DalleSize;
  quality: DalleQuality;
  style: DalleStyle;
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

export function computeDalleCost(
  size: DalleSize,
  quality: DalleQuality,
): number {
  if (quality === 'hd') {
    return size === '1024x1024' ? 0.08 : 0.12;
  }
  return size === '1024x1024' ? 0.04 : 0.08;
}

/**
 * Run a single DALL-E generation + download the resulting bytes.
 * Throws on any failure — callers catch and surface to the agent
 * tool result so the conversation can continue.
 */
export async function generateImage(
  args: GenerateImageArgs,
): Promise<GenerateImageResult> {
  const model = args.model ?? 'dall-e-3';
  const size = args.size ?? '1024x1024';
  const quality = args.quality ?? 'standard';
  const style = args.style ?? 'vivid';

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
      quality,
      style,
      response_format: 'url',
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
    data: Array<{ url: string; revised_prompt?: string }>;
  };
  const item = json.data[0];
  if (!item?.url) {
    throw new DalleGenerationError(
      'OpenAI returned no image URL.',
      500,
      'no_url',
    );
  }

  // OpenAI's hosted URL is valid ~1h. We download immediately so the
  // bytes are ours.
  const dl = await fetch(item.url);
  if (!dl.ok) {
    throw new DalleGenerationError(
      `Could not download generated image: ${dl.status} ${dl.statusText}`,
      dl.status,
      'download_failed',
    );
  }
  const imageBytes = Buffer.from(await dl.arrayBuffer());

  return {
    imageBytes,
    revisedPrompt: item.revised_prompt ?? args.prompt,
    costUsd: computeDalleCost(size, quality),
    size,
    quality,
    style,
    model,
  };
}
