"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API has no lib.dom types in this TypeScript; the slice used here is small.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Microphone → text, with interim results, so a wall can re-rank as words are recognised.
 * Chrome and Edge only (they send audio to Google's recogniser); the first `start()` asks
 * for microphone permission, which needs https or localhost. Headless recordings never
 * call `start()`; they feed a scripted transcript instead (lib/script.ts `say`).
 */
export function useSpeech({ onTranscript, lang = "en-US" }: { onTranscript: (text: string, final: boolean) => void; lang?: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  useEffect(() => {
    setSupported(ctor() !== null);
    return () => recRef.current?.abort();
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return;
    recRef.current?.abort();
    const rec = new C();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      let final = true;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (!e.results[i].isFinal) final = false;
      }
      text = text.replace(/\s+/g, " ").trim();
      setInterim(text);
      cbRef.current(text, final);
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted") setError(e.error);
    };
    rec.onend = () => {
      if (recRef.current === rec) {
        recRef.current = null;
        setListening(false);
      }
    };
    recRef.current = rec;
    setError(null);
    setInterim("");
    setListening(true);
    rec.start();
  }, [lang]);

  return { supported, listening, start, stop, interim, error };
}
