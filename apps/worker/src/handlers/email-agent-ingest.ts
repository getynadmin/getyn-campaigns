/* eslint-disable no-console */
/**
 * Phase 8 M6 — knowledge-source ingest.
 *
 * Runs on the `email-agent` queue; job name
 * `email-agent-ingest-knowledge-source`. Handles the URL and FILE
 * kinds — TEXT sources come in pre-populated by the tRPC mutation
 * and never enter this queue.
 *
 * Flow (URL):
 *   1. Fetch the URL with a Getyn user-agent + 15s timeout.
 *   2. Reject non-HTML content types loudly (the operator gave us a
 *      URL they thought would work — surface the mismatch in the row's
 *      metadata rather than silently storing garbage).
 *   3. Convert HTML → plaintext via html-to-text, skipping nav/header/
 *      footer/script/style/aside so we retain body copy only.
 *   4. Trim to 50k chars; store in extractedText.
 *   5. Haiku summarizes the first ~10k chars into ~800 chars.
 *   6. Update the row + clear metadata.ingestPending.
 *
 * Flow (FILE): stubbed with a placeholder summary — parser wiring
 * lands when we plumb the M4 file-upload path.
 */
import { convert } from 'html-to-text';
import type { Job } from 'bullmq';
import * as Sentry from '@sentry/node';

import { getAnthropicClient } from '@getyn/ai';
import { KnowledgeSourceKind, prisma } from '@getyn/db';
import type { EmailAgentIngestKnowledgeSourcePayload } from '@getyn/types';

import { getAnthropicApiKey } from '../integrations/anthropic';

// Extraction cap. The agent prompt only uses the summary, but we
// keep the full text for the operator's inspection UI + future
// vector-retrieval work. 50k chars ≈ 12k tokens ≈ well under any
// reasonable Sonnet context.
const MAX_EXTRACTED_CHARS = 50_000;

// Summary length target — Haiku is very cheap, and shorter summaries
// leave more room in the agent's per-message prompt (5-8 sources are
// common for a well-configured agent).
const SUMMARY_TARGET_CHARS = 800;

// Fetch guardrails.
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; GetynBot/1.0; +https://getyn.com/docs/agent-crawler)';

// Haiku model.
const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';
const MAX_SUMMARY_TOKENS = 800;

export async function handleEmailAgentIngestKnowledgeSource(
  job: Job<EmailAgentIngestKnowledgeSourcePayload>,
): Promise<void> {
  const { knowledgeSourceId } = job.data;
  const row = await prisma.emailAgentKnowledgeSource.findUnique({
    where: { id: knowledgeSourceId },
    select: {
      id: true,
      kind: true,
      sourceUrl: true,
      rawTitle: true,
      metadata: true,
    },
  });
  if (!row) {
    console.warn(`[ingest] source ${knowledgeSourceId} vanished`);
    return;
  }

  if (row.kind === KnowledgeSourceKind.TEXT) {
    // TEXT sources are already populated. Re-summarize in case the
    // operator manually edited the text — a Refresh should refresh
    // the summary.
    await resummarizeExisting(row.id);
    return;
  }

  if (row.kind === KnowledgeSourceKind.URL) {
    if (!row.sourceUrl) {
      await markIngestFailed(row.id, 'no_source_url');
      return;
    }
    try {
      const { extractedText, resolvedTitle } = await fetchAndExtractUrl(row.sourceUrl);
      const summary = await summarize(extractedText, resolvedTitle ?? row.rawTitle);
      await prisma.emailAgentKnowledgeSource.update({
        where: { id: row.id },
        data: {
          extractedText: extractedText.slice(0, MAX_EXTRACTED_CHARS),
          summary: summary || fallbackSummary(extractedText),
          rawTitle: resolvedTitle || row.rawTitle,
          extractedAt: new Date(),
          metadata: {
            ingestPending: false,
            lastExtractedAt: new Date().toISOString(),
            source: 'html_extractor',
          },
        },
      });
    } catch (err) {
      console.error(`[ingest] URL fetch failed for ${row.id}`, err);
      Sentry.captureException(err, {
        tags: { handler: 'email-agent-ingest', kind: 'url' },
        extra: { knowledgeSourceId: row.id, sourceUrl: row.sourceUrl },
      });
      await markIngestFailed(row.id, `fetch_failed: ${(err as Error).message ?? 'unknown'}`);
    }
    return;
  }

  if (row.kind === KnowledgeSourceKind.FILE) {
    // Wiring the file parser needs the upload path from M4 to land
    // first — the wizard currently disables file uploads. Stub with a
    // clear message so the operator sees where we're at.
    await prisma.emailAgentKnowledgeSource.update({
      where: { id: row.id },
      data: {
        summary: 'File parsing not wired yet — extraction lands in a follow-up.',
        metadata: { ingestPending: false, source: 'file_stub' },
      },
    });
    return;
  }
}

// -----------------------------------------------------------------
// URL fetch + extraction
// -----------------------------------------------------------------

async function fetchAndExtractUrl(
  url: string,
): Promise<{ extractedText: string; resolvedTitle: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/') && !contentType.includes('application/xhtml')) {
      throw new Error(`unsupported content-type: ${contentType}`);
    }
    const html = await res.text();
    if (html.length === 0) {
      throw new Error('empty response body');
    }
    return htmlToText(html);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert page HTML to plain text, aggressively dropping structure
 * that's chrome (nav, footer, ads) rather than content. html-to-text
 * accepts CSS-selector rules; we skip common wrappers so most sites
 * end up with just their article content.
 */
function htmlToText(html: string): {
  extractedText: string;
  resolvedTitle: string | null;
} {
  // Pull the <title> before html-to-text strips it (default drop).
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const resolvedTitle = titleMatch?.[1]?.trim().slice(0, 200) ?? null;

  const text = convert(html, {
    wordwrap: 120,
    selectors: [
      // Nav-ish elements — usually links, no content.
      { selector: 'nav', format: 'skip' },
      { selector: 'header', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      { selector: 'aside', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'noscript', format: 'skip' },
      { selector: 'form', format: 'skip' },
      { selector: 'button', format: 'skip' },
      { selector: 'iframe', format: 'skip' },
      // Common ad/menu classes across CMS templates. These aren't
      // universal — false positives are unlikely to cost us relevance
      // vs. the noise they'd add.
      { selector: '[role="navigation"]', format: 'skip' },
      { selector: '[role="banner"]', format: 'skip' },
      { selector: '[role="contentinfo"]', format: 'skip' },
      { selector: '[aria-hidden="true"]', format: 'skip' },
      // Keep images as inline text — alt text is usually useful.
      { selector: 'img', format: 'inline', options: { ignoreHref: true } },
    ],
  });
  return {
    extractedText: text.replace(/\n{3,}/g, '\n\n').trim(),
    resolvedTitle,
  };
}

// -----------------------------------------------------------------
// Haiku summarization
// -----------------------------------------------------------------

async function summarize(text: string, title: string | null): Promise<string> {
  const key = await getAnthropicApiKey();
  if (!key) {
    console.warn('[ingest] no Anthropic key — skipping summary');
    return fallbackSummary(text);
  }
  const truncated = text.slice(0, 10_000);
  const prompt = [
    'Summarize the following source into a dense reference the agent can consult while writing personalized outreach and reply drafts.',
    '',
    `TITLE: ${title ?? '(none)'}`,
    '',
    'GUIDELINES:',
    `- Aim for ~${SUMMARY_TARGET_CHARS} characters.`,
    "- Keep concrete facts (prices, features, positioning, quotes) — that's what the agent needs.",
    '- Drop marketing filler and CTAs.',
    '- Use bullet points when the source is structured, prose when it flows.',
    '',
    'SOURCE:',
    truncated,
  ].join('\n');
  try {
    const client = getAnthropicClient(key);
    const res = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: MAX_SUMMARY_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    const out = (res.content as { type: string; text?: string }[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    return out || fallbackSummary(text);
  } catch (err) {
    console.error('[ingest] Haiku summarize failed', err);
    Sentry.captureException(err, { tags: { handler: 'email-agent-ingest-summarize' } });
    return fallbackSummary(text);
  }
}

/**
 * Cheap fallback when Haiku isn't reachable — first paragraph, capped.
 * Better than an empty summary because the agent prompt still gets
 * *some* context from the source.
 */
function fallbackSummary(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= SUMMARY_TARGET_CHARS) return trimmed;
  return `${trimmed.slice(0, SUMMARY_TARGET_CHARS - 1)}…`;
}

// -----------------------------------------------------------------
// TEXT re-summarize (Refresh on a text source)
// -----------------------------------------------------------------

async function resummarizeExisting(id: string): Promise<void> {
  const row = await prisma.emailAgentKnowledgeSource.findUnique({
    where: { id },
    select: { extractedText: true, rawTitle: true },
  });
  if (!row) return;
  const summary = await summarize(row.extractedText, row.rawTitle);
  await prisma.emailAgentKnowledgeSource.update({
    where: { id },
    data: {
      summary,
      metadata: { ingestPending: false, source: 'text_resummarize' },
    },
  });
}

// -----------------------------------------------------------------
// Error path
// -----------------------------------------------------------------

async function markIngestFailed(id: string, reason: string): Promise<void> {
  await prisma.emailAgentKnowledgeSource.update({
    where: { id },
    data: {
      summary: `(Extraction failed: ${reason})`,
      metadata: { ingestPending: false, ingestError: reason },
    },
  });
}
