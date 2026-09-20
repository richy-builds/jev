import { noul, APIError, APIUserAbortError, RateLimitError } from "@typesafe-ai/sdk";
import { client } from "@/lib/typesafe";

/**
 * The sweep: thousands of short texts judged against one plain-English criterion, one
 * Noul per text, `BATCH` texts per request, `IN_FLIGHT` requests at once, paced by a
 * token budget. The 429 wall on this key is tokens per second (~400–500k), not requests
 * (scripts/throughput.mjs), so the pacer meters tokens.
 *
 * Batch size and request shape were chosen against Steam's thumbs-up flag
 * (docs/sweep-calibration.md): with the text behind a state path the answers decay by
 * position inside the batch (AUC 0.93 at batch 10, 0.56 at 250); with the text inline in
 * the question they are flat at every size, so the batch is set for throughput.
 */
export const DEFAULT_BATCH = 125;
export const IN_FLIGHT = 16;
export const DEFAULT_SHAPE: Shape = "inline";
export const TOKEN_BUDGET_PER_S = 350_000;
/** How a review reaches the model: inline in its question, or behind a state path (`reviews[i].text`). Compared in docs/sweep-calibration.md. */
export type Shape = "inline" | "state";
const MAX_ATTEMPTS = 4;
const MIN_BATCH = 5;
const MAX_BATCH = 250;
const MAX_IN_FLIGHT = 96;

export type SweepEvent =
  | { t: "start"; total: number; batches: number; batch: number }
  /** One request landed: `p[k]` is the probability for text `from + k`. */
  | { t: "batch"; i: number; from: number; p: number[]; ms: number; tokens: number; retries: number }
  /** One request gave up after every retry; its texts stay unjudged. */
  | { t: "failed"; i: number; from: number; n: number; message: string }
  | { t: "done"; ms: number; tokens: number; ok: number; failed: number; retries: number }
  | { t: "error"; message: string };

export function clampBatch(n: unknown): number {
  const b = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : DEFAULT_BATCH;
  return Math.min(MAX_BATCH, Math.max(MIN_BATCH, b));
}

export function clampInFlight(n: unknown): number {
  const b = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : IN_FLIGHT;
  return Math.min(MAX_IN_FLIGHT, Math.max(1, b));
}

/** One Noul per review. `inline` quotes the review in its question; `state` (the probe's shape) points at `reviews[i].text`. */
export function buildBatch(criterion: string, texts: string[], shape: Shape = DEFAULT_SHAPE) {
  const state: { criterion: string; reviews?: { text: string }[] } = { criterion };
  if (shape === "state") state.reviews = texts.map((text) => ({ text }));
  const questions: Record<string, ReturnType<typeof noul>> = {};
  texts.forEach((text, i) => {
    const subject = shape === "state" ? `the review in \`reviews[${i}].text\`` : `this review: ${JSON.stringify(text)}`;
    questions[`r${i}`] = noul(`Is \`criterion\` true of ${subject}?`, {
      true: "The criterion, read plainly, describes this review",
      false: "It does not describe this review, or the review is about something else",
    });
  });
  return { state, questions };
}

/**
 * Token budget pacer. Every request reserves its estimated tokens up front, which may drive
 * the balance negative; the caller then sleeps until the balance would have refilled to
 * zero. A 429 charges a penalty so every worker backs off together instead of one at a time.
 */
class TokenPacer {
  private balance: number;
  private last = performance.now();
  constructor(private readonly perSecond: number) {
    this.balance = perSecond;
  }
  private refill() {
    const now = performance.now();
    this.balance = Math.min(this.perSecond, this.balance + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
  }
  async take(tokens: number, signal?: AbortSignal) {
    this.refill();
    this.balance -= tokens;
    if (this.balance < 0) await sleep((-this.balance / this.perSecond) * 1000, signal);
  }
  penalise(fraction: number) {
    this.refill();
    this.balance -= this.perSecond * fraction;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new APIUserAbortError());
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new APIUserAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Rough size of one batch before any response has told us the real tokens-per-character. */
const CHARS_PER_TOKEN = 3.6;
/** Question text plus criteria per Noul, in characters. */
const OVERHEAD_CHARS = 170;

/**
 * Runs the sweep and yields events as requests land, in landing order. Retries are our own
 * loop (SDK retries off) so a 429 can pause every worker through the pacer and be counted
 * for the telemetry. Cancelling `signal` (a client disconnect) aborts every upstream call.
 */
export async function* runSweep(criterion: string, texts: string[], opts: { batch?: number; inflight?: number; shape?: Shape; signal?: AbortSignal } = {}): AsyncGenerator<SweepEvent> {
  const batch = clampBatch(opts.batch);
  const inflight = clampInFlight(opts.inflight);
  const shape = opts.shape ?? DEFAULT_SHAPE;
  const signal = opts.signal;
  const ranges: Array<{ i: number; from: number; texts: string[] }> = [];
  for (let from = 0, i = 0; from < texts.length; from += batch, i++) ranges.push({ i, from, texts: texts.slice(from, from + batch) });
  yield { t: "start", total: texts.length, batches: ranges.length, batch };

  const pacer = new TokenPacer(TOKEN_BUDGET_PER_S);
  let charsPerToken = CHARS_PER_TOKEN;
  const estimate = (r: (typeof ranges)[number]) => Math.round((r.texts.reduce((s, t) => s + t.length, 0) + r.texts.length * OVERHEAD_CHARS) / charsPerToken);

  // Workers push events into a queue; the generator drains it. `wake` resolves when
  // something new is there, or when the last worker is done.
  const queue: SweepEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (e: SweepEvent) => {
    queue.push(e);
    wake?.();
    wake = null;
  };
  let next = 0;
  let ok = 0;
  let failed = 0;
  let retries = 0;
  let tokens = 0;
  const started = performance.now();

  async function worker() {
    while (next < ranges.length && !signal?.aborted) {
      const r = ranges[next++];
      const body = buildBatch(criterion, r.texts, shape);
      let lastError = "";
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await pacer.take(estimate(r), signal);
        const t0 = performance.now();
        try {
          const res = await client.systemOne(body, { signal, timeout: 30_000, retry: { maxRetries: 0 } });
          const used = res.usage.input_tokens;
          tokens += used;
          const chars = r.texts.reduce((s, t) => s + t.length, 0) + r.texts.length * OVERHEAD_CHARS;
          charsPerToken = charsPerToken * 0.7 + (chars / Math.max(1, used)) * 0.3;
          const p = r.texts.map((_, k) => {
            const a = res.answers[`r${k}`] as { noul?: number } | undefined;
            return Math.round((a?.noul ?? 0) * 1000) / 1000;
          });
          ok++;
          push({ t: "batch", i: r.i, from: r.from, p, ms: Math.round(performance.now() - t0), tokens: used, retries: attempt });
          lastError = "";
          break;
        } catch (err) {
          if (signal?.aborted || err instanceof APIUserAbortError) return;
          lastError = err instanceof Error ? err.message : String(err);
          const status = err instanceof APIError ? err.status : 0;
          if (attempt === MAX_ATTEMPTS - 1) break;
          retries++;
          console.warn(`[sweep] retry ${attempt + 1} for batch ${r.i}: ${status || (err as Error)?.name} ${lastError.slice(0, 100)}`);
          // Back off: honour retry-after on a 429 and make every worker wait with us.
          let wait = Math.min(6000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.25);
          if (err instanceof RateLimitError) {
            if (err.retryAfterMs) wait = Math.max(wait, Math.min(10_000, err.retryAfterMs));
            pacer.penalise(0.5);
          } else if (status && status < 500 && status !== 408) {
            // A 4xx that isn't a rate limit won't get better on retry.
            break;
          }
          try {
            await sleep(wait, signal);
          } catch {
            return;
          }
        }
      }
      if (lastError) {
        failed++;
        push({ t: "failed", i: r.i, from: r.from, n: r.texts.length, message: lastError.slice(0, 160) });
      }
    }
  }

  const pool = Promise.all(Array.from({ length: Math.min(inflight, ranges.length) }, worker)).then(() => push({ t: "done", ms: 0, tokens: 0, ok: 0, failed: 0, retries: 0 }));
  pool.catch(() => null);

  for (;;) {
    if (!queue.length) await new Promise<void>((r) => (wake = r));
    while (queue.length) {
      const e = queue.shift()!;
      if (e.t === "done") {
        yield { t: "done", ms: Math.round(performance.now() - started), tokens, ok, failed, retries };
        return;
      }
      yield e;
    }
  }
}
