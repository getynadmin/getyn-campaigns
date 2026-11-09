'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Press-to-dictate button for any textarea feeding an AI prompt.
 *
 * Uses the Web Speech API with `continuous: true` and
 * `interimResults: true` so partial words stream into the field as
 * they're recognised (same feel as Claude Code's own dictation).
 * Click again to stop.
 *
 * Graceful degrade: if `SpeechRecognition` isn't on `window`
 * (Firefox, older Safari) the button renders null — no broken UI.
 *
 * The caller owns the textarea value. We send:
 *   - `onFinal(appendedChunk)` whenever a segment is finalised
 *   - `onInterim(fullInterimTranscript)` on every partial update
 * so the caller can either preview the interim text in-place or
 * leave it untouched until final. The simplest integration is to
 * concatenate both to the stored value in render time.
 */
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: Array<
    ArrayLike<{ transcript: string }> & { isFinal: boolean; 0: { transcript: string } }
  >;
};

function getSpeechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceInputButton({
  onInterim,
  onFinal,
  className,
  title = 'Dictate',
}: {
  /** Called with the current in-flight interim transcript (not yet committed). */
  onInterim?: (text: string) => void;
  /** Called with a newly finalised chunk to append to the stored value. */
  onFinal: (chunk: string) => void;
  className?: string;
  title?: string;
}): JSX.Element | null {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getSpeechCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    const r = recRef.current;
    if (r) {
      try {
        r.stop();
      } catch {
        // ignore
      }
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e: SpeechRecognitionEventLike) => {
      let interim = '';
      let finalChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const text = res[0].transcript;
        if (res.isFinal) finalChunk += text;
        else interim += text;
      }
      if (finalChunk) onFinal(finalChunk);
      if (onInterim) onInterim(interim);
    };
    r.onend = () => {
      setListening(false);
      if (onInterim) onInterim('');
    };
    r.onerror = () => {
      setListening(false);
      if (onInterim) onInterim('');
    };
    recRef.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [onFinal, onInterim]);

  useEffect(() => {
    return () => {
      const r = recRef.current;
      if (r) {
        try {
          r.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      title={listening ? 'Stop dictation' : title}
      aria-label={listening ? 'Stop dictation' : title}
      aria-pressed={listening}
      className={cn(
        'relative inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted',
        listening && 'border-red-500/60 text-red-600 dark:text-red-400',
        className,
      )}
    >
      {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
      {listening ? (
        <span
          className="voice-dot absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
