'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Phase 7 M5 — SSE consumer for the agent stream.
 *
 * The endpoint at /api/agent/[id]/stream returns text/event-stream
 * with `data: <json>` lines per AgentStreamEvent. We consume via
 * fetch + ReadableStream rather than EventSource so we can POST the
 * userMessage in the same request.
 *
 * State exposed to the UI:
 *   - streamingText: partial assistant text accumulated this turn
 *   - toolCalls: tool calls completed so far this turn (cleared on
 *     each new send)
 *   - status: 'idle' | 'streaming' | 'error'
 *   - lastError: server-emitted error message
 *   - finalizedRedirectTo: set when the agent's finalize_draft tool
 *     ran; the page navigates here
 */
export type AgentToolCallEvent = {
  id: string;
  name: string;
  output?: unknown;
  error?: string;
};

interface UseAgentStreamArgs {
  conversationId: string;
  onTurnComplete?: () => void;
}

export function useAgentStream({
  conversationId,
  onTurnComplete,
}: UseAgentStreamArgs) {
  const [streamingText, setStreamingText] = useState('');
  const [toolCalls, setToolCalls] = useState<AgentToolCallEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>(
    'idle',
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const [finalizedRedirectTo, setFinalizedRedirectTo] = useState<string | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (userMessage: string) => {
      // Reset per-turn buffers.
      setStreamingText('');
      setToolCalls([]);
      setStatus('streaming');
      setLastError(null);
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/agent/${conversationId}/stream`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userMessage }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Stream failed (${res.status}).`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames separated by \n\n
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 2);
            if (!frame.startsWith('data:')) continue;
            const json = frame.slice('data:'.length).trim();
            try {
              const evt = JSON.parse(json);
              applyEvent(evt);
            } catch {
              // Malformed frame — ignore
            }
          }
        }
        setStatus('idle');
        onTurnComplete?.();
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        const message =
          err instanceof Error ? err.message : 'Stream error.';
        setLastError(message);
        setStatus('error');
      }
    },
    [conversationId, onTurnComplete],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  const applyEvent = (evt: {
    type: string;
    text?: string;
    name?: string;
    id?: string;
    output?: unknown;
    error?: string;
    message?: string;
    reason?: string;
  }) => {
    switch (evt.type) {
      case 'token':
        if (typeof evt.text === 'string') {
          setStreamingText((s) => s + evt.text);
        }
        break;
      case 'tool-call-start':
        // We append the result below once it lands; just register
        // the call so the UI can show "Calling X..."
        if (evt.name && evt.id) {
          setToolCalls((prev) => [
            ...prev,
            { id: evt.id!, name: evt.name! },
          ]);
        }
        break;
      case 'tool-call-result':
        if (evt.id) {
          setToolCalls((prev) =>
            prev.map((t) =>
              t.id === evt.id
                ? { ...t, output: evt.output, error: evt.error }
                : t,
            ),
          );
          // Detect agent-side finalize: any finalize_draft tool whose
          // result includes a redirectTo.
          if (
            evt.name === 'finalize_draft' &&
            evt.output &&
            typeof evt.output === 'object' &&
            'redirectTo' in (evt.output as Record<string, unknown>)
          ) {
            const dest = (evt.output as { redirectTo?: unknown }).redirectTo;
            if (typeof dest === 'string') setFinalizedRedirectTo(dest);
          }
        }
        break;
      case 'turn-complete':
        // Reason is end_turn | finalize | max_turns
        break;
      case 'error':
        if (typeof evt.message === 'string') {
          setLastError(evt.message);
          setStatus('error');
        }
        break;
    }
  };

  return {
    streamingText,
    toolCalls,
    status,
    lastError,
    finalizedRedirectTo,
    send,
    stop,
  };
}
