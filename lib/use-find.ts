"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { MOVIE_BY_ID, type FindResponse, type FitsResponse, type Mode } from "@/lib/movies";
import type { InspectResponse } from "@/lib/inspect";

export const DEBOUNCE_MS = 220;
/** Sparkline keeps this many keystrokes. */
export const TRACE_MAX = 48;

// Mirrors of server thresholds (lib/find.ts, lib/inspect.ts). Those modules import the
// SDK, so the client keeps its own copies rather than pulling the SDK into the bundle.
export const EXISTS_FLOOR = 0.15;
/** Second pass (evidence tags + near-duplicate re-rank) fires only when the description points at something. */
export const INSPECT_MIN_EXISTS = 0.5;
export const INSPECT_TOP = 5;
/** Films below this probability are not worth a second look. */
export const INSPECT_MIN_P = 0.01;

export type Status = "idle" | "pending" | "ready" | "error";
export type Totals = { calls: number; tokens: number; ms: number };
/** One landed keystroke: how sure Jev was, and of what. Drives the confidence sparkline. */
export type TracePoint = { q: string; mode: Mode; p: number; exists: number; ms: number; title: string | null };
/** The answer a follow-up refers to ("no, the sequel"). Sent as an id; the server looks it up. */
export type Previous = { id: string; title: string; year: number; director?: string };

export const NO_TOTALS: Totals = { calls: 0, tokens: 0, ms: 0 };

export type FindLive = {
  find: FindResponse | null;
  fits: FitsResponse | null;
  inspect: InspectResponse | null;
  status: Status;
  error: string | null;
  fitsPending: boolean;
  inspectPending: boolean;
  totals: Totals;
  trace: TracePoint[];
  /** When the current keystroke's first request left; stopwatches count from here. */
  startedAtRef: RefObject<number>;
  /** True once every request for the current keystroke has landed (or failed). Stable identity. */
  settled: () => boolean;
};

/**
 * The per-keystroke loop shared by every wall: debounce, abort the previous keystroke,
 * one `/api/find` call, then `/api/fits` for a set or `/api/inspect` for a confident
 * single film. Superseded responses are dropped by sequence number.
 */
export function useFind(query: string, opts: { previous?: Previous | null; earlier?: string[]; overlap?: boolean } = {}): FindLive {
  const previousId = opts.previous?.id ?? null;
  /** Earlier turns' text, so "same director but older" after "no, the sequel" still reads right. */
  const earlier = opts.earlier ?? [];
  const earlierKey = earlier.join("\u0000");
  // Speech: words arrive faster than a call returns. Aborting on every word would mean the
  // wall never re-ranks while someone talks, so while listening the calls overlap and the
  // wall shows the newest result that has landed, like live captions trailing the speaker.
  const overlap = opts.overlap ?? false;
  const overlapRef = useRef(overlap);
  overlapRef.current = overlap;
  /** Sequence of the newest response the wall is showing; older ones landing later are dropped. */
  const shownSeqRef = useRef(0);
  const [find, setFind] = useState<FindResponse | null>(null);
  const [fits, setFits] = useState<FitsResponse | null>(null);
  const [fitsPending, setFitsPending] = useState(false);
  const [inspect, setInspect] = useState<InspectResponse | null>(null);
  const [inspectPending, setInspectPending] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals>(NO_TOTALS);
  const [trace, setTrace] = useState<TracePoint[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const lastModeRef = useRef<Mode | "idle">("idle");
  const startedAtRef = useRef(0);
  /** Latest request state, readable from script runners without re-subscribing. */
  const liveRef = useRef({ status: "idle" as Status, fitsPending: false, inspectPending: false });
  liveRef.current = { status, fitsPending, inspectPending };

  useEffect(() => {
    if (!overlapRef.current) abortRef.current?.abort();
    const seq = ++seqRef.current;

    if (query.trim().length === 0) {
      setFind(null);
      setFits(null);
      setInspect(null);
      setFitsPending(false);
      setInspectPending(false);
      setStatus("idle");
      setError(null);
      setTrace([]);
      lastModeRef.current = "idle";
      return;
    }

    const timer = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      startedAtRef.current = performance.now();
      setStatus("pending");
      setError(null);
      const body = previousId ? { query, previous: { id: previousId }, earlier } : { query };

      const post = async <T extends { tokens: number | null; latencyMs: number }>(path: string, extra: unknown = {}): Promise<T> => {
        const res = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, ...(extra as object) }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as T;
        setTotals((t) => ({ calls: t.calls + 1, tokens: t.tokens + (data.tokens ?? 0), ms: t.ms + data.latencyMs }));
        return data;
      };

      // When the previous keystroke was already a set search, the next one almost
      // certainly is too, so the per-film Nouls go out alongside the main call
      // instead of after it. If the router disagrees the answer is simply dropped.
      const prefetch = lastModeRef.current === "set" ? post<FitsResponse>("/api/fits").catch(() => null) : null;
      if (prefetch) setFitsPending(true);

      try {
        const data = await post<FindResponse>("/api/find");
        // Newest wins: with overlapping calls an older word's answer may land after a newer one.
        if (seq !== seqRef.current && !(overlapRef.current && seq > shownSeqRef.current)) return;
        shownSeqRef.current = seq;
        setFind(data);
        setInspect(null);
        // A trailing answer must not stop the stopwatch of the call that is still out.
        if (seq === seqRef.current) setStatus("ready");
        lastModeRef.current = data.mode;
        // Confidence for the trace: the top film's share in finder mode, the router's
        // own vote otherwise, so a set search still draws a bar rather than a gap.
        const [bestId, bestP] = Object.entries(data.probabilities).reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0]);
        const finder = data.mode === "finder" && data.exists >= EXISTS_FLOOR;
        setTrace((t) =>
          [
            ...t,
            {
              q: query,
              mode: data.mode,
              p: finder ? bestP : data.mode === "set" ? data.router.set : 0,
              exists: data.exists,
              ms: data.latencyMs,
              title: finder ? MOVIE_BY_ID[bestId]?.title ?? null : null,
            },
          ].slice(-TRACE_MAX),
        );

        // Follow-ups only for the keystroke that is still current; a trailing answer stops here.
        if (seq !== seqRef.current) return;
        if (data.mode === "set") {
          setFitsPending(true);
          let f = prefetch ? await prefetch : null;
          if (!f) f = await post<FitsResponse>("/api/fits");
          if (seq !== seqRef.current) return;
          setFits(f);
          setFitsPending(false);
        } else {
          setFits(null);
          setFitsPending(false);
          if (data.mode === "finder" && data.exists >= INSPECT_MIN_EXISTS) {
            const ids = topIds(data.probabilities, INSPECT_TOP, INSPECT_MIN_P);
            if (ids.length >= 2) {
              setInspectPending(true);
              const ins = await post<InspectResponse>("/api/inspect", { ids });
              if (seq !== seqRef.current) return;
              setInspect(ins);
              setInspectPending(false);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError" || seq !== seqRef.current) return;
        setError((err as Error).message);
        setStatus("error");
        setFitsPending(false);
        setInspectPending(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, previousId, earlierKey]);

  const settled = useCallback(() => {
    const l = liveRef.current;
    return (l.status === "ready" || l.status === "error") && !l.fitsPending && !l.inspectPending;
  }, []);

  return { find, fits, inspect, status, error, fitsPending, inspectPending, totals, trace, startedAtRef, settled };
}

export function topIds(probs: Record<string, number>, n: number, minP: number): string[] {
  return Object.entries(probs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .filter(([, p], i) => i < 2 || p >= minP)
    .map(([id]) => id);
}
