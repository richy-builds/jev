import { noul, APIUserAbortError } from "@typesafe-ai/sdk";
import { client } from "@/lib/typesafe";

/**
 * Phase 2 of the sweep: the Bluesky Jetstream firehose judged live against the same
 * criterion. Posts are sampled to `MAX_POSTS_PER_S`, batched every `FLUSH_MS`, and each
 * batch carries two Nouls per post: the criterion, and a safety check that decides
 * whether the text may reach the browser at all. A post the safety Noul flags is sent
 * as `hidden` with no text, so nothing unsafe is ever rendered. `lag` on every batch is
 * how far the judgments trail the network: now minus the oldest post's Jetstream time.
 */
export const JETSTREAM_URL = "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post";
export const MAX_POSTS_PER_S = 200;
const FLUSH_MS = 150;
const FLUSH_AT = 40;
const MAX_IN_FLIGHT = 8;
const MAX_CHARS = 280;
const MIN_CHARS = 12;
/** A post the safety Noul puts at or above this is hidden. */
const HIDE_AT = 0.5;
const STATS_MS = 500;

export type LivePost = { id: string; text: string | null; hidden: boolean; p: number; safe: number; t: number };
export type LiveEvent =
  | { t: "open"; criterion: string; maxPerS: number }
  | { t: "posts"; items: LivePost[]; lag: number; ms: number; tokens: number }
  | { t: "stats"; seen: number; kept: number; dropped: number; backlog: number; inflight: number; lag: number; connected: boolean }
  | { t: "error"; message: string };

type Raw = { id: string; text: string; t: number };

/** Mostly Latin letters, for posts with no `langs`: enough to keep the judged stream English. */
function looksEnglish(text: string) {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return letters >= text.length * 0.6;
}

function buildBatch(criterion: string, posts: Raw[]) {
  const questions: Record<string, ReturnType<typeof noul>> = {};
  posts.forEach((post, i) => {
    const quoted = JSON.stringify(post.text);
    questions[`m${i}`] = noul(`Is \`criterion\` true of this post: ${quoted}?`, {
      true: "The criterion, read plainly, describes this post",
      false: "It does not describe this post, or the post is about something else",
    });
    questions[`u${i}`] = noul(`Would this post be unsafe to show unfiltered on a public screen: ${quoted}?`, {
      true: "It contains slurs, hate, sexual content, graphic violence, harassment, or self-harm content",
      false: "It is safe to show as ordinary public conversation",
    });
  });
  return { state: { criterion }, questions };
}

/**
 * Connects to Jetstream and yields judged posts until `signal` aborts. Every 500 ms a
 * `stats` event reports what the sampler dropped and how deep the backlog is, so the
 * page can show the throttle and the lag honestly.
 */
export async function* runLive(criterion: string, signal: AbortSignal): AsyncGenerator<LiveEvent> {
  yield { t: "open", criterion, maxPerS: MAX_POSTS_PER_S };

  const queue: LiveEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (e: LiveEvent) => {
    queue.push(e);
    wake?.();
    wake = null;
  };

  let pending: Raw[] = [];
  let seen = 0;
  let kept = 0;
  let dropped = 0;
  let inflight = 0;
  let lastLag = 0;
  let connected = false;
  // Sampler: a bucket of MAX_POSTS_PER_S that refills continuously; a post with no token is dropped.
  let bucket = MAX_POSTS_PER_S;
  let bucketAt = performance.now();
  const take = () => {
    const now = performance.now();
    bucket = Math.min(MAX_POSTS_PER_S, bucket + ((now - bucketAt) / 1000) * MAX_POSTS_PER_S);
    bucketAt = now;
    if (bucket < 1) return false;
    bucket -= 1;
    return true;
  };

  async function judge(posts: Raw[]) {
    inflight++;
    const t0 = performance.now();
    try {
      const res = await client.systemOne(buildBatch(criterion, posts), { signal, timeout: 20_000, retry: { maxRetries: 1 } });
      const items: LivePost[] = posts.map((post, i) => {
        const p = (res.answers[`m${i}`] as { noul?: number } | undefined)?.noul ?? 0;
        const safe = (res.answers[`u${i}`] as { noul?: number } | undefined)?.noul ?? 1;
        const hidden = safe >= HIDE_AT;
        return { id: post.id, text: hidden ? null : post.text, hidden, p: Math.round(p * 1000) / 1000, safe: Math.round(safe * 1000) / 1000, t: post.t };
      });
      const oldest = Math.min(...posts.map((p) => p.t));
      lastLag = Math.max(0, Math.round(Date.now() - oldest));
      push({ t: "posts", items, lag: lastLag, ms: Math.round(performance.now() - t0), tokens: res.usage.input_tokens });
    } catch (err) {
      if (!(err instanceof APIUserAbortError) && !signal.aborted) console.warn("[live] batch failed:", err instanceof Error ? err.message : err);
    } finally {
      inflight--;
    }
  }

  const flush = () => {
    if (!pending.length || inflight >= MAX_IN_FLIGHT) return;
    const batch = pending.splice(0, FLUSH_AT);
    void judge(batch);
  };

  const ws = new WebSocket(JETSTREAM_URL);
  ws.onopen = () => {
    connected = true;
  };
  ws.onclose = () => {
    connected = false;
  };
  ws.onerror = () => push({ t: "error", message: "Jetstream connection failed" });
  ws.onmessage = (m) => {
    let e: { kind?: string; time_us?: number; did?: string; commit?: { operation?: string; rkey?: string; record?: { text?: string; langs?: string[]; reply?: unknown } } };
    try {
      e = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (e.kind !== "commit" || e.commit?.operation !== "create") return;
    const rec = e.commit.record;
    const text = (rec?.text ?? "").replace(/\s+/g, " ").trim();
    if (text.length < MIN_CHARS || text.length > MAX_CHARS) return;
    if (rec?.langs ? !rec.langs.includes("en") : !looksEnglish(text)) return;
    seen++;
    if (!take()) {
      dropped++;
      return;
    }
    kept++;
    pending.push({ id: `${e.did}/${e.commit.rkey}`, text, t: Math.round((e.time_us ?? 0) / 1000) });
    if (pending.length >= FLUSH_AT) flush();
  };

  const flushTimer = setInterval(flush, FLUSH_MS);
  const statsTimer = setInterval(() => push({ t: "stats", seen, kept, dropped, backlog: pending.length, inflight, lag: lastLag, connected }), STATS_MS);
  const stop = () => {
    clearInterval(flushTimer);
    clearInterval(statsTimer);
    try {
      ws.close();
    } catch {}
    pending = [];
    wake?.();
    wake = null;
  };
  signal.addEventListener("abort", stop, { once: true });

  try {
    while (!signal.aborted) {
      if (!queue.length) await new Promise<void>((r) => (wake = r));
      while (queue.length && !signal.aborted) yield queue.shift()!;
    }
  } finally {
    stop();
  }
}
