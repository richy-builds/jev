"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveEvent, LivePost } from "@/lib/live";

/** A band of chunky dots: at 25–100 English posts a second a row lands every half second to two seconds, and the ring wraps in under a minute. */
export const LIVE_COLS = 50;
export const LIVE_ROWS = 12;
export const LIVE_CELLS = LIVE_COLS * LIVE_ROWS;
const FEED_MAX = 12;
const FEED_MIN_P = 0.75;
/** Posts per second is a rolling window, so a quiet second reads as quiet rather than the average since the start. */
const RATE_WINDOW_MS = 5000;

export type LiveStats = {
  criterion: string;
  /** Judged posts written to the matrix (wraps around after LIVE_CELLS). */
  judged: number;
  matched: number;
  hidden: number;
  tokens: number;
  /** Server-side sampler counts. */
  seen: number;
  dropped: number;
  backlog: number;
  inflight: number;
  /** ms between a post hitting the network and its judgment reaching the page. */
  lag: number;
  perS: number;
  connected: boolean;
  error: string | null;
  startedAt: number;
};

export type LiveFeedItem = { i: number; p: number; at: number };

/**
 * The firehose on the same matrix: a ring of LIVE_CELLS cells that the newest judged post
 * overwrites in order. Probabilities and landing times live in typed arrays like the
 * Steam sweep; texts sit beside them for hover and the feed. Hidden posts never carry text.
 */
export function useLive() {
  const probs = useRef(new Float32Array(LIVE_CELLS).fill(-1));
  const landed = useRef(new Float32Array(LIVE_CELLS));
  const hidden = useRef(new Uint8Array(LIVE_CELLS));
  const posts = useRef<(LivePost | null)[]>(new Array(LIVE_CELLS).fill(null));
  const cursor = useRef(0);
  const [version, setVersion] = useState(0);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [feed, setFeed] = useState<LiveFeedItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const arrivals = useRef<number[]>([]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStats((s) => (s ? { ...s, connected: false } : s));
  }, []);

  const start = useCallback(async (criterion: string) => {
    const text = criterion.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    probs.current.fill(-1);
    landed.current.fill(0);
    hidden.current.fill(0);
    posts.current.fill(null);
    cursor.current = 0;
    arrivals.current = [];
    setFeed([]);
    setVersion((v) => v + 1);
    const cur: LiveStats = { criterion: text, judged: 0, matched: 0, hidden: 0, tokens: 0, seen: 0, dropped: 0, backlog: 0, inflight: 0, lag: 0, perS: 0, connected: false, error: null, startedAt: performance.now() };
    setStats({ ...cur });
    const feedItems: LiveFeedItem[] = [];

    try {
      const res = await fetch(`/api/live?criterion=${encodeURIComponent(text)}`, { signal: controller.signal });
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
          const e = JSON.parse(line.slice(6)) as LiveEvent;
          if (e.t === "posts") {
            const now = performance.now();
            for (const post of e.items) {
              const i = cursor.current;
              cursor.current = (i + 1) % LIVE_CELLS;
              probs.current[i] = post.p;
              landed.current[i] = now;
              hidden.current[i] = post.hidden ? 1 : 0;
              posts.current[i] = post;
              cur.judged++;
              if (post.hidden) cur.hidden++;
              else if (post.p >= 0.5) cur.matched++;
              if (!post.hidden && post.p >= FEED_MIN_P) feedItems.push({ i, p: post.p, at: now });
              arrivals.current.push(now);
            }
            if (feedItems.length > FEED_MAX) feedItems.splice(0, feedItems.length - FEED_MAX);
            while (arrivals.current.length && arrivals.current[0] < now - RATE_WINDOW_MS) arrivals.current.shift();
            cur.perS = Math.round((arrivals.current.length / Math.min(RATE_WINDOW_MS, Math.max(1000, now - cur.startedAt))) * 1000);
            cur.tokens += e.tokens;
            cur.lag = e.lag;
            cur.connected = true;
            setFeed([...feedItems]);
            setStats({ ...cur });
            setVersion((v) => v + 1);
          } else if (e.t === "stats") {
            cur.seen = e.seen;
            cur.dropped = e.dropped;
            cur.backlog = e.backlog;
            cur.inflight = e.inflight;
            cur.connected = e.connected;
            if (e.lag) cur.lag = e.lag;
            const now = performance.now();
            while (arrivals.current.length && arrivals.current[0] < now - RATE_WINDOW_MS) arrivals.current.shift();
            cur.perS = Math.round((arrivals.current.length / Math.min(RATE_WINDOW_MS, Math.max(1000, now - cur.startedAt))) * 1000);
            setStats({ ...cur });
          } else if (e.t === "error") {
            throw new Error(e.message);
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      cur.error = err instanceof Error ? err.message : String(err);
      cur.connected = false;
      setStats({ ...cur });
    }
  }, []);

  return { probs, landed, hidden, posts, version, stats, feed, start, stop, running: !!stats?.connected };
}
