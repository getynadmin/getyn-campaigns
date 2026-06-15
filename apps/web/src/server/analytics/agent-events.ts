/**
 * Phase 7 M7 — agent observability.
 *
 * Two sinks:
 *   1. PostHog — product analytics. Fired via direct REST POST to
 *      /capture/ so we don't need a server SDK dep. Skips silently
 *      when NEXT_PUBLIC_POSTHOG_KEY isn't set.
 *   2. Sentry — alert sink. captureMessage with level + tags so the
 *      Sentry rules engine can trigger the P2/P3 channels per spec.
 *
 * All emits are fire-and-forget — we never await them in a hot path.
 */
import * as Sentry from '@sentry/nextjs';

import { publicEnv } from '@/lib/env';

type AgentEventName =
  | 'agent.conversation.started'
  | 'agent.conversation.completed'
  | 'agent.conversation.abandoned'
  | 'agent.conversation.failed'
  | 'agent.draft.opened_in_editor'
  | 'agent.draft.sent';

interface AgentEventProps {
  conversationId: string;
  tenantId: string;
  userId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  /** Extra context — token totals, draft id, etc. */
  [extra: string]: unknown;
}

export function emitAgentEvent(
  event: AgentEventName,
  props: AgentEventProps,
): void {
  // PostHog capture — non-blocking.
  void postHogCapture(event, props).catch(() => {
    // Analytics failure must never affect the hot path.
  });

  // Sentry alert routing — captureMessage with tags lets rules in
  // the Sentry UI route to the right channel.
  if (event === 'agent.conversation.failed') {
    Sentry.captureMessage('agent.conversation.failed', {
      level: 'warning',
      tags: {
        agent: 'true',
        channel: props.channel,
        kind: 'finalize_failure',
      },
      extra: { ...props },
    });
  }
}

/**
 * Sentry-only signal for runtime-internal events that aren't
 * PostHog-worthy (e.g. cost overruns mid-turn, tool retry burst).
 */
export function emitAgentSentryAlert(args: {
  message: string;
  level: 'warning' | 'error';
  tags: Record<string, string>;
  extra?: Record<string, unknown>;
}): void {
  Sentry.captureMessage(args.message, {
    level: args.level,
    tags: { agent: 'true', ...args.tags },
    extra: args.extra,
  });
}

async function postHogCapture(
  event: AgentEventName,
  props: AgentEventProps,
): Promise<void> {
  const key = publicEnv.posthogKey();
  if (!key) return;
  const host = publicEnv.posthogHost();
  await fetch(`${host.replace(/\/$/, '')}/capture/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      event,
      // PostHog: distinct_id is the user; we tag tenant via properties
      // so the same Insights surface can break out by workspace.
      distinct_id: props.userId,
      // Spread props first so the explicit fields below override
      // (PostHog drops the latter on conflict; we want the explicit
      // shape to win deterministically).
      properties: {
        ...props,
        $groups: { tenant: props.tenantId },
      },
    }),
  });
}
