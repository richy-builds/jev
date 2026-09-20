"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { STATION_BY_ID, type MeetFindResponse } from "@/lib/stations";
import type { Status, Totals, TracePoint } from "@/lib/use-find";
import { NO_TOTALS, TRACE_MAX } from "@/lib/use-find";

export const DEBOUNCE_MS = 220;
/** Mirror of lib/meet-find.ts THRESHOLDS (that module imports the SDK; the client keeps its own copy). */
export const EXISTS_FLOOR = 0.15;
export const BUDGET_MIN_P = 0.5;

export type MeetLive = {
  find: MeetFindResponse | null;
  status: Status;
  error: string | null;
  totals: Totals;
  trace: TracePoint[];
  /** When the current keystroke's request left; the stopwatch counts from here. */
  startedAtRef: RefObject<number>;
  /** True once the current keystroke's request has landed (or failed). Stable identity. */
  settled: () => boolean;
};

export type MeetOpts = {
  /** Origin station ids; the server turns them into names for state. */
  origins: string[];
  /** Station ids within everyone's budget; only these go into the Choice. */
  candidates: string[];
  previous?: { id: string } | null;
  earlier?: string[];
};

/**
 * The per-keystroke loop for /meet, copied from lib/use-find.ts: debounce, abort the
 * previous keystroke, one `/api/meet/find` call, newest response wins by sequence
 * number. A change of origins or candidate set re-sends the same query, since the
 * Choice's option list changed underneath it.
 */
export function useMeet(query: string, opts: MeetOpts): MeetLive {
  const originsKey = opts.origins.join(",");
  const candidatesKey = opts.candidates.join(",");
  const previousId = opts.previous?.id ?? null;
  const earlier = opts.earlier ?? [];
  const earlierKey = earlier.join("\u0000");
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [find, setFind] = useState<MeetFindResponse | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals>(NO_TOTALS);
  const [trace, setTrace] = useState<TracePoint[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const startedAtRef = useRef(0);
  const statusRef = useRef<Status>("idle");
  statusRef.current = status;

  useEffect(() => {
    abortRef.current?.abort();
    const seq = ++seqRef.current;

    if (query.trim().length === 0 || opts.candidates.length === 0) {
      setFind(null);
      setStatus("idle");
      setError(null);
      if (query.trim().length === 0) setTrace([]);
      return;
    }

    const timer = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      startedAtRef.current = performance.now();
      setStatus("pending");
      setError(null);
      const o = optsRef.current;
      const body = {
        query,
        origins: o.origins,
        candidates: o.candidates,
        ...(previousId ? { previous: { id: previousId }, earlier } : {}),
      };
      try {
        const res = await fetch("/api/meet/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as MeetFindResponse;
        if (seq !== seqRef.current) return;
        setTotals((t) => ({ calls: t.calls + 1, tokens: t.tokens + (data.tokens ?? 0), ms: t.ms + data.latencyMs }));
        setFind(data);
        setStatus("ready");
        const lit = data.exists >= EXISTS_FLOOR;
        const p = data.probabilities[data.top] ?? 0;
        setTrace((t) =>
          [...t, { q: query, mode: lit ? "finder" : "nothing", p: lit ? p : 0, exists: data.exists, ms: data.latencyMs, title: lit ? STATION_BY_ID[data.top]?.name ?? null : null } as TracePoint].slice(
            -TRACE_MAX,
          ),
        );
      } catch (err) {
        if ((err as Error).name === "AbortError" || seq !== seqRef.current) return;
        setError((err as Error).message);
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, originsKey, candidatesKey, previousId, earlierKey]);

  const settled = useCallback(() => statusRef.current === "ready" || statusRef.current === "error", []);

  return { find, status, error, totals, trace, startedAtRef, settled };
}
