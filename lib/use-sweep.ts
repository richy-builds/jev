"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Review } from "@/lib/steam";
import type { SweepEvent } from "@/lib/sweep";

export type SweepRun = {
  criterion: string;
  total: number;
  judged: number;
  /** Reviews at p ≥ 0.5. */
  matched: number;
  tokens: number;
  batches: number;
  landed: number;
  retries: number;
  failed: number;
  /** Final wall time from the server once done; the page runs a stopwatch until then. */
  ms: number | null;
  done: boolean;
  error: string | null;
};

/** A review the feed shows as it lands: the strongest matches of each batch, in landing order. */
export type FeedItem = { i: number; p: number; at: number };

export type Totals = { runs: number; tokens: number; items: number; ms: number };

const FEED_MAX = 12;
const FEED_PER_BATCH = 2;
const FEED_MIN_P = 0.75;

/**
 * Loads the review set once, then runs one sweep at a time. Probabilities live in typed
 * arrays behind refs (10,000 cells repainting through React state would be the bottleneck,
 * not the model); `version` bumps per landed batch so the telemetry and the calibration
 * panel re-render. A new criterion aborts the run in flight, which closes the response and
 * cancels every upstream call.
 */
export function useSweep() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(0);
  /** -1 = not judged yet. */
  const probs = useRef(new Float32Array(0));
  /** performance.now() when each cell landed, for the landing flash. 0 = never. */
  const landed = useRef(new Float32Array(0));
  const [version, setVersion] = useState(0);
  const [run, setRun] = useState<SweepRun | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [totals, setTotals] = useState<Totals>({ runs: 0, tokens: 0, items: 0, ms: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/sweep")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { reviews: Review[]; batch: number }) => {
        if (!alive) return;
        probs.current = new Float32Array(d.reviews.length).fill(-1);
        landed.current = new Float32Array(d.reviews.length);
        setBatchSize(d.batch);
        setReviews(d.reviews);
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    probs.current.fill(-1);
    landed.current.fill(0);
    setFeed([]);
    setVersion((v) => v + 1);
  }, []);

  /** Starts a sweep; resolves when it has finished, failed, or been replaced. */
  const start = useCallback(
    async (criterion: string) => {
      const text = criterion.trim();
      if (!text || !reviews.length) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      reset();
      runningRef.current = true;
      startedAtRef.current = performance.now();
      const cur: SweepRun = { criterion: text, total: reviews.length, judged: 0, matched: 0, tokens: 0, batches: 0, landed: 0, retries: 0, failed: 0, ms: null, done: false, error: null };
      setRun({ ...cur });
      const feedItems: FeedItem[] = [];

      try {
        const res = await fetch("/api/sweep", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ criterion: text }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!line.startsWith("data: ")) continue;
            const e = JSON.parse(line.slice(6)) as SweepEvent;
            if (e.t === "start") {
              cur.batches = e.batches;
            } else if (e.t === "batch") {
              const now = performance.now();
              const best: FeedItem[] = [];
              for (let k = 0; k < e.p.length; k++) {
                const p = e.p[k];
                probs.current[e.from + k] = p;
                landed.current[e.from + k] = now;
                if (p >= 0.5) cur.matched++;
                if (p >= FEED_MIN_P) best.push({ i: e.from + k, p, at: now });
              }
              // The feed shows a couple of the strongest matches per batch, so it reads as the sweep's own voice.
              best.sort((a, b) => b.p - a.p);
              feedItems.push(...best.slice(0, FEED_PER_BATCH));
              if (feedItems.length > FEED_MAX) feedItems.splice(0, feedItems.length - FEED_MAX);
              cur.judged += e.p.length;
              cur.tokens += e.tokens;
              cur.landed++;
              cur.retries += e.retries;
              setFeed([...feedItems]);
              setRun({ ...cur });
              setVersion((v) => v + 1);
            } else if (e.t === "failed") {
              cur.failed++;
              setRun({ ...cur });
            } else if (e.t === "done") {
              cur.ms = e.ms;
              cur.done = true;
              cur.retries = e.retries;
              setRun({ ...cur });
              setTotals((t) => ({ runs: t.runs + 1, tokens: t.tokens + e.tokens, items: t.items + cur.judged, ms: t.ms + e.ms }));
            } else if (e.t === "error") {
              throw new Error(e.message);
            }
          }
        }
        if (!cur.done && !controller.signal.aborted) {
          // The stream ended without a done event: count what landed.
          cur.ms = Math.round(performance.now() - startedAtRef.current);
          cur.done = true;
          setRun({ ...cur });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        cur.error = err instanceof Error ? err.message : String(err);
        cur.done = true;
        setRun({ ...cur });
      } finally {
        if (abortRef.current === controller) runningRef.current = false;
      }
    },
    [reviews.length, reset],
  );

  const running = run !== null && !run.done;
  /** For the script runner: nothing is in flight. */
  const settled = useCallback(() => !runningRef.current, []);

  return { reviews, loadError, batchSize, probs, landed, version, run, running, feed, totals, start, settled, startedAtRef };
}

/** Predicted-probability buckets against Steam's thumbs-up, for the calibration panel. */
export type Bucket = { lo: number; n: number; predicted: number; actual: number };

export function calibration(probs: Float32Array, reviews: Review[], bins = 10): { buckets: Bucket[]; n: number; accuracy: number } {
  const acc = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  let n = 0;
  let correct = 0;
  for (let i = 0; i < reviews.length; i++) {
    const p = probs[i];
    if (p < 0) continue;
    const y = reviews[i].voted_up ? 1 : 0;
    const b = acc[Math.min(bins - 1, Math.floor(p * bins))];
    b.n++;
    b.p += p;
    b.y += y;
    n++;
    if ((p >= 0.5) === (y === 1)) correct++;
  }
  return {
    n,
    accuracy: n ? correct / n : 0,
    buckets: acc.map((b, k) => ({ lo: k / bins, n: b.n, predicted: b.n ? b.p / b.n : 0, actual: b.n ? b.y / b.n : 0 })),
  };
}
