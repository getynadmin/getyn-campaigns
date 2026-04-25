import type { AbTest } from '@getyn/types';

/**
 * Pre-send content scanner — Phase 3 M5 stub, full ruleset in M6.
 *
 * The kickoff prompt calls for a deterministic ruleset (no AI yet) that
 * checks subject + body for spam markers. Returns warnings (block at
 * "Send" with confirm dialog) and errors (hard block with explanation).
 *
 * For M5, we surface only the most obvious cases as the wizard's
 * pre-flight check. M6 expands this to the full kickoff list:
 *   - ALL CAPS subject
 *   - excessive exclamation
 *   - blacklisted phrases
 *   - missing unsubscribe link  (M6: rendered HTML check)
 *   - missing physical address footer (M6)
 *   - image-to-text ratio (M6)
 *
 * Outputs are intentionally short-circuited so the UI can render them
 * inline next to the offending field.
 */

export interface ScanInput {
  subject: string;
  fromEmail: string;
  /** Currently unused at M5; M6 reads body for unsubscribe + footer checks. */
  renderedHtml?: string | null;
  abTest?: AbTest | null;
}

export interface ScanIssue {
  level: 'error' | 'warning';
  message: string;
  field?: 'subject' | 'fromEmail' | 'renderedHtml' | 'abTest';
}

export interface ScanResult {
  issues: ScanIssue[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

const ALL_CAPS_THRESHOLD = 0.7; // 70% uppercase letters → flag

export function scanCampaignContent(input: ScanInput): ScanResult {
  const issues: ScanIssue[] = [];
  const subjects: { variantLabel: string; value: string }[] = input.abTest
    ?.enabled
    ? input.abTest.variants.map((v) => ({
        variantLabel: `subject (variant ${v.id})`,
        value: v.subject,
      }))
    : [{ variantLabel: 'subject', value: input.subject }];

  for (const { variantLabel, value: subject } of subjects) {
    if (subject.trim().length === 0) {
      issues.push({
        level: 'error',
        field: 'subject',
        message: `Email ${variantLabel} is empty.`,
      });
      continue;
    }
    if (subject.length > 200) {
      issues.push({
        level: 'error',
        field: 'subject',
        message: `Email ${variantLabel} exceeds 200 characters (${subject.length}).`,
      });
    }

    // ALL CAPS check — counts only letters, so "WIN $$$" doesn't count
    // the symbols against the ratio.
    const letters = subject.match(/[A-Za-z]/g) ?? [];
    const upperLetters = subject.match(/[A-Z]/g) ?? [];
    if (
      letters.length >= 8 &&
      upperLetters.length / letters.length >= ALL_CAPS_THRESHOLD
    ) {
      issues.push({
        level: 'warning',
        field: 'subject',
        message: `Email ${variantLabel} is mostly uppercase — looks like spam to most clients.`,
      });
    }

    // Excessive exclamation
    const bangs = (subject.match(/!/g) ?? []).length;
    if (bangs >= 3) {
      issues.push({
        level: 'warning',
        field: 'subject',
        message: `Email ${variantLabel} has ${bangs} exclamation marks — soften for deliverability.`,
      });
    }

    // Common spam phrases (very short list for MVP — not exhaustive)
    const spamPatterns = [
      /\b(?:free)\s+\$/i,
      /\$\$\$/,
      /\b(?:click here)\b/i,
      /\b100%\s+free\b/i,
    ];
    for (const re of spamPatterns) {
      if (re.test(subject)) {
        issues.push({
          level: 'warning',
          field: 'subject',
          message: `Email ${variantLabel} matched a spam phrase pattern (${re}).`,
        });
        break; // one warning per subject is enough
      }
    }
  }

  // Basic from-email shape check (server schema already validates email
  // format, but a verified-domain check happens at send time in M6).
  if (!/.+@.+\..+/.test(input.fromEmail)) {
    issues.push({
      level: 'error',
      field: 'fromEmail',
      message: 'From address is not a valid email.',
    });
  }

  // Body-level checks — only run when renderedHtml is present (i.e. after
  // the user has saved the design). Until then the wizard's pre-flight
  // surfaces "Save the design" instead.
  if (input.renderedHtml) {
    const html = input.renderedHtml;

    // Strip HTML tags + collapse whitespace to estimate visible text content.
    const visibleText = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (visibleText.length < 20) {
      issues.push({
        level: 'error',
        field: 'renderedHtml',
        message: 'Email body has almost no text content. Empty designs send poorly.',
      });
    }

    // Image-to-text ratio. Spam filters flag emails that are mostly images
    // with little text. Count <img> tags vs visible text length.
    const imgCount = (html.match(/<img[\s>]/gi) ?? []).length;
    if (imgCount > 0 && visibleText.length < imgCount * 80) {
      issues.push({
        level: 'warning',
        field: 'renderedHtml',
        message: `Email is mostly images (${imgCount} images, ${visibleText.length} chars of text). Many spam filters flag this — add some text body copy.`,
      });
    }

    // Unsubscribe link presence. We accept either the merge tag
    // `{{unsubscribeUrl}}` (substituted at send time) or a literal `/u/`
    // path. The kickoff requires this, and it's law in most jurisdictions.
    if (!/{{\s*unsubscribeUrl\s*}}/i.test(html) && !/\/u\//.test(html)) {
      issues.push({
        level: 'error',
        field: 'renderedHtml',
        message:
          'Missing unsubscribe link. Add an Unlayer "Unsubscribe" element or insert {{unsubscribeUrl}} as a link.',
      });
    }

    // ALL CAPS body — same heuristic as subject.
    const bodyLetters = visibleText.match(/[A-Za-z]/g) ?? [];
    const bodyUpperLetters = visibleText.match(/[A-Z]/g) ?? [];
    if (
      bodyLetters.length >= 200 &&
      bodyUpperLetters.length / bodyLetters.length >= ALL_CAPS_THRESHOLD
    ) {
      issues.push({
        level: 'warning',
        field: 'renderedHtml',
        message: 'Body is mostly uppercase text — toned-down formatting reads better.',
      });
    }
  }

  return {
    issues,
    hasErrors: issues.some((i) => i.level === 'error'),
    hasWarnings: issues.some((i) => i.level === 'warning'),
  };
}
