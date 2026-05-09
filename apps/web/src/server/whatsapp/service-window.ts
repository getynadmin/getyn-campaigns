/**
 * Service-window math (Phase 4 M10).
 *
 * Per Meta's rule: a 24h "customer service window" opens or extends
 * each time the contact sends an INBOUND message; outbound replies
 * do not extend it. Inside the window the tenant can send free-form
 * text. Outside, only APPROVED templates.
 *
 * Pure helper extracted for unit testing — the inbox UI consumes it
 * for the composer state + indicators.
 */

export interface ServiceWindowState {
  /** True when the window is currently open. */
  open: boolean;
  /** Milliseconds until the window closes, or 0 if already closed. */
  remainingMs: number;
  /** Human-readable label (empty for "never opened"). */
  label: string;
  /** Coarse bucket the UI uses for badge tone. */
  tone: 'open' | 'closing-soon' | 'closed' | 'never';
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function computeServiceWindow(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): ServiceWindowState {
  if (!expiresAt) {
    return { open: false, remainingMs: 0, label: '', tone: 'never' };
  }
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const remainingMs = at.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return {
      open: false,
      remainingMs: 0,
      label: 'Window closed',
      tone: 'closed',
    };
  }
  if (remainingMs <= TWO_HOURS_MS) {
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    return {
      open: true,
      remainingMs,
      label: `Closing soon (${minutes}m)`,
      tone: 'closing-soon',
    };
  }
  const hours = Math.floor(remainingMs / 3_600_000);
  return {
    open: true,
    remainingMs,
    label: `Window open (${hours}h)`,
    tone: 'open',
  };
}

/**
 * After an INBOUND message arrives, compute the new
 * `serviceWindowExpiresAt`. Always sentAt + 24h.
 */
export function bumpServiceWindowOnInbound(sentAt: Date): Date {
  return new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Outbound replies do NOT extend the window. This helper exists so
 * call sites that look like they "should" pass through the window
 * helper read clearly — the function name documents the rule.
 */
export function bumpServiceWindowOnOutbound(
  current: Date | null,
): Date | null {
  return current; // intentional no-op; documents Meta's rule
}
