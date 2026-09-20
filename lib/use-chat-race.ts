"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { DEBOUNCE_MS } from "@/lib/use-find";
import { chatCost, type ChatEvent, type ChatUsage } from "@/lib/chat-model";

/** Prompt size to charge for an attempt cancelled before the provider reported usage. Mirrors lib/chat-find.ts. */
const PROMPT_TOKENS_FALLBACK = 9700;

export type ChatPhase = "idle" | "waiting" | "streaming" | "answered" | "error";
export type Attempt = {
  n: number;
  query: string;
  outcome: "answered" | "abandoned" | "error";
  /** Wall-clock ms the attempt was alive. */
  ms: number;
  /** ms to the first token, when one arrived. */
  firstTokenMs: number | null;
  text: string;
  /** What the provider billed (or, for a cancelled attempt, our estimate of it). */
  cost: number;
  uncached: number;
  estimated: boolean;
  /** performance.now() when the answer completed, for time-to-answer. */
  doneAt: number | null;
};

export type ChatLive = {
  phase: ChatPhase;
  text: string;
  attempt: number;
  abandoned: number;
  answered: number;
  firstTokenMs: number | null;
  usage: ChatUsage | null;
  cost: { billed: number; uncached: number; estimated: boolean } | null;
  sessionCost: number;
  sessionUncached: number;
  history: Attempt[];
  error: string | null;
  startedAtRef: RefObject<number>;
  /** The current attempt has finished, one way or the other. Stable identity. */
  settled: () => boolean;
};

/**
 * The chat model's side of the race. Same shape as useFind: every keystroke debounces,
 * aborts the attempt in flight and starts a new one. An attempt that never finished is
 * counted as abandoned and still charged, because the provider bills the prompt either way.
 */
export type ChatTurn = { query: string; answer: string };

export function useChatRace(query: string, opts: { enabled?: boolean; debounceMs?: number; turns?: ChatTurn[] } = {}): ChatLive {
  const enabled = opts.enabled ?? true;
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  /** Committed turns, sent as chat history so follow-ups are as fair to the chat model as to Jev. */
  const turns = opts.turns ?? [];
  const turnsKey = JSON.stringify(turns);

  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [abandoned, setAbandoned] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [cost, setCost] = useState<ChatLive["cost"]>(null);
  const [sessionCost, setSessionCost] = useState(0);
  const [sessionUncached, setSessionUncached] = useState(0);
  const [history, setHistory] = useState<Attempt[]>([]);
  const [error, setError] = useState<string | null>(null);

  const startedAtRef = useRef(0);
  const phaseRef = useRef<ChatPhase>("idle");
  phaseRef.current = phase;
  /** The attempt in flight, mutable so the next keystroke's cleanup can book it as abandoned. */
  const curRef = useRef<{ n: number; query: string; text: string; startedAt: number; firstTokenMs: number | null; controller: AbortController } | null>(null);
  /** Last usage the provider reported; the cached ratio is reused to price cancelled attempts. */
  const lastUsageRef = useRef<ChatUsage | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    if (query.trim().length === 0) {
      setPhase("idle");
      setText("");
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      const controller = new AbortController();
      const n = ++attemptRef.current;
      const startedAt = performance.now();
      startedAtRef.current = startedAt;
      const cur = { n, query, text: "", startedAt, firstTokenMs: null as number | null, controller };
      curRef.current = cur;
      setAttempt(n);
      setPhase("waiting");
      setText("");
      setFirstTokenMs(null);
      setUsage(null);
      setCost(null);
      setError(null);

      let reported: ChatUsage | null = null;
      try {
        const res = await fetch("/api/chat-find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(turns.length ? { query, turns } : { query }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let doneMs: number | null = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!line.startsWith("data: ")) continue;
            const ev = JSON.parse(line.slice(6)) as ChatEvent;
            if (ev.t === "delta") {
              if (cur.firstTokenMs === null) {
                cur.firstTokenMs = Math.round(performance.now() - startedAt);
                setFirstTokenMs(cur.firstTokenMs);
                setPhase("streaming");
              }
              cur.text += ev.text;
              setText(cur.text);
            } else if (ev.t === "usage") {
              reported = { prompt: ev.prompt, cached: ev.cached, completion: ev.completion };
              lastUsageRef.current = reported;
              setUsage(reported);
            } else if (ev.t === "done") {
              doneMs = ev.ms;
            } else if (ev.t === "error") {
              throw new Error(ev.message);
            }
          }
        }
        if (curRef.current !== cur) return;
        const c = reported ? chatCost(reported) : estimate(lastUsageRef.current);
        const est = !reported;
        curRef.current = null;
        setCost({ ...c, estimated: est });
        setSessionCost((s) => s + c.billed);
        setSessionUncached((s) => s + c.uncached);
        setAnswered((a) => a + 1);
        setPhase("answered");
        setHistory((h) =>
          [
            ...h,
            {
              n,
              query,
              outcome: "answered" as const,
              ms: doneMs ?? Math.round(performance.now() - startedAt),
              firstTokenMs: cur.firstTokenMs,
              text: cur.text,
              cost: c.billed,
              uncached: c.uncached,
              estimated: est,
              doneAt: performance.now(),
            },
          ].slice(-40),
        );
      } catch (err) {
        if ((err as Error).name === "AbortError" || curRef.current !== cur) return;
        curRef.current = null;
        setError((err as Error).message);
        setPhase("error");
        setHistory((h) => [...h, { n, query, outcome: "error" as const, ms: Math.round(performance.now() - startedAt), firstTokenMs: null, text: cur.text, cost: 0, uncached: 0, estimated: true, doneAt: null }].slice(-40));
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      // A new keystroke (or an unmount) while an attempt is alive: cancel it, book it.
      const cur = curRef.current;
      if (cur) {
        curRef.current = null;
        cur.controller.abort();
        const c = estimate(lastUsageRef.current);
        setAbandoned((a) => a + 1);
        setSessionCost((s) => s + c.billed);
        setSessionUncached((s) => s + c.uncached);
        setHistory((h) =>
          [
            ...h,
            {
              n: cur.n,
              query: cur.query,
              outcome: "abandoned" as const,
              ms: Math.round(performance.now() - cur.startedAt),
              firstTokenMs: cur.firstTokenMs,
              text: cur.text,
              cost: c.billed,
              uncached: c.uncached,
              estimated: true,
              doneAt: null,
            },
          ].slice(-40),
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled, debounceMs, turnsKey]);

  const settledRef = useRef(() => {
    const p = phaseRef.current;
    return p === "answered" || p === "error" || p === "idle";
  });

  return { phase, text, attempt, abandoned, answered, firstTokenMs, usage, cost, sessionCost, sessionUncached, history, error, startedAtRef, settled: settledRef.current };
}

/** Price of a cancelled attempt: the last reported prompt at its cached ratio, no completion. */
function estimate(last: ChatUsage | null) {
  const u: ChatUsage = last ? { prompt: last.prompt, cached: last.cached, completion: 0 } : { prompt: PROMPT_TOKENS_FALLBACK, cached: 0, completion: 0 };
  return chatCost(u);
}
