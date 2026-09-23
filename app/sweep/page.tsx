"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CHAT_PRICE_PER_TOKEN, HudCell, money, PRICE_PER_TOKEN, SPRING, useStopwatch } from "@/app/grid/ui";
import { readScriptParams, runScript, typeWords, type Step } from "@/lib/script";
import { STEAM_GAME, type Review } from "@/lib/steam";
import { calibration, useSweep, type SweepRun, type Totals } from "@/lib/use-sweep";
import { LIVE_CELLS, LIVE_COLS, useLive, type LiveStats } from "@/lib/use-live";

const COLS = 100;
/** The calibration panel compares against Steam's thumb, which only means something for this criterion. */
const RECOMMENDS = "the reviewer recommends this game";
const PRESETS = [
  RECOMMENDS,
  "complains about performance but still loves it",
  "would refund if they could",
  "is joking or being sarcastic",
  "recommends it to people who did not like Dark Souls",
];
/** Criteria for the firehose (`?live=1`): it is whatever people are posting right now, so these are broad. */
const LIVE_PRESETS = ["is about sport", "is complaining about something", "is an ad or self-promotion", "is a question asked in good faith", "mentions the weather"];
/** How long a live criterion runs in the recording script before the next one. */
const LIVE_HOLD_MS = 9000;

/**
 * Recording scripts (`/sweep?demo=1&script=main`). `main` is the 16:9 cut; `mobile` is the
 * 4:5 cut (`&layout=portrait`) with captions, since X autoplays muted.
 */
const SCRIPTS: Record<string, Step[]> = {
  main: [
    { type: "type", text: RECOMMENDS, hold: 300 },
    { type: "enter", hold: 2600 },
    { type: "type", text: "complains about performance but still loves it", hold: 300 },
    { type: "enter", hold: 2600 },
    { type: "type", text: "is joking or being sarcastic", hold: 300 },
    { type: "enter", hold: 3500 },
  ],
  mobile: [
    { type: "caption", text: `10,000 ${STEAM_GAME} reviews. One question, in English.`, hold: 1600 },
    { type: "type", text: RECOMMENDS, hold: 200 },
    { type: "caption", text: "Every dot is a review. Brightness is how sure Jev is.", hold: 0 },
    { type: "enter", hold: 2400 },
    { type: "caption", text: "Ask it anything.", hold: 900 },
    { type: "type", text: "complains about performance but still loves it", hold: 200 },
    { type: "caption", text: "", hold: 0 },
    { type: "enter", hold: 2400 },
    { type: "caption", text: "Same 10,000. New question.", hold: 900 },
    { type: "type", text: "is joking or being sarcastic", hold: 200 },
    { type: "caption", text: "", hold: 0 },
    { type: "enter", hold: 3500 },
  ],
  // `/sweep?live=1&demo=1&script=live`: the firehose. Enter starts the stream and the hold lets it run.
  live: [
    { type: "type", text: "is about sport", hold: 200 },
    { type: "enter", hold: LIVE_HOLD_MS },
    { type: "type", text: "is complaining about something", hold: 200 },
    { type: "enter", hold: LIVE_HOLD_MS + 2000 },
  ],
};

type Mode = "steam" | "live";
/** What the tooltip and the feed show for one cell, whichever source filled it. */
type Entry = { key: string; text: string | null; p: number; meta: string };

type Params = { demo: boolean; script: string | null; delay: number; portrait: boolean; live: boolean };

export default function SweepPage() {
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [caption, setCaption] = useState("");
  const [params, setParams] = useState<Params>({ demo: false, script: null, delay: 2000, portrait: false, live: false });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>("steam");
  const { reviews, loadError, batchSize, probs, landed, version, run, running, feed, totals, start, settled, startedAtRef } = useSweep();
  const live = useLive();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const scriptAbortRef = useRef(false);
  const autoRunRef = useRef<string | null>(null);

  // Deep links: ?q= prefills, &run=1 starts it once the reviews are in (screenshots);
  // ?demo=1 is the recording layout, &layout=portrait the 4:5 cut, &script=main drives it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("q");
    if (q) {
      setQuery(q);
      if (sp.get("run") === "1") autoRunRef.current = q;
    }
    const isLive = sp.get("live") === "1";
    setParams({ ...readScriptParams(), portrait: sp.get("layout") === "portrait", live: isLive });
    if (isLive) setMode("live");
  }, []);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const liveStart = live.start;
  const liveStop = live.stop;
  /** Enter, a preset, or the script's `enter` step: the Steam sweep resolves when done; the firehose resolves at once and keeps running. */
  const submit = useCallback(
    async (text: string) => {
      if (modeRef.current === "live") void liveStart(text);
      else await start(text);
    },
    [start, liveStart],
  );
  const switchMode = useCallback(
    (m: Mode) => {
      if (m === modeRef.current) return;
      liveStop();
      setMode(m);
      setHover(null);
    },
    [liveStop],
  );
  useEffect(() => {
    if (reviews.length && autoRunRef.current) {
      const q = autoRunRef.current;
      autoRunRef.current = null;
      void submit(q);
    }
  }, [reviews.length, submit]);

  // Presets type out word by word (lib/script.ts) and then run. A real keystroke cancels the preset.
  const typeGen = useRef(0);
  const typeOut = useCallback(
    async (text: string) => {
      const gen = ++typeGen.current;
      await typeWords(text, { setQuery, setTyping, settled: () => true, aborted: () => gen !== typeGen.current });
      if (gen === typeGen.current) {
        inputRef.current?.focus();
        void submit(text);
      }
    },
    [submit],
  );
  useEffect(() => () => void (typeGen.current += 1), []);

  // The firehose runs until told otherwise: Escape stops it and leaves the board as it stands.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modeRef.current === "live") liveStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [liveStop]);

  // Script runner (lib/script.ts): typing, Enter, captions. Escape aborts.
  useEffect(() => {
    const steps = params.script ? SCRIPTS[params.script] : null;
    if (!steps || !reviews.length) return;
    scriptAbortRef.current = false;
    const aborted = () => scriptAbortRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") scriptAbortRef.current = true;
    };
    window.addEventListener("keydown", onKey);
    void runScript(steps, {
      setQuery,
      setTyping,
      settled,
      aborted,
      delay: params.delay,
      // Enough reviews that every worker opens its connection before the clip starts; the recorder trims it.
      warm: () => fetch("/api/sweep", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ criterion: "warm up", limit: 4000 }) }).then((r) => r.text()),
      hooks: {
        enter: () => submit(queryRef.current),
        caption: async (s) => {
          if (s.type === "caption") setCaption(s.text);
        },
      },
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      scriptAbortRef.current = true;
    };
  }, [params.script, params.delay, reviews.length, settled, submit]);

  const demo = params.demo;
  const portrait = params.portrait;
  const isLive = mode === "live";
  const isRecommends = run?.criterion.toLowerCase() === RECOMMENDS;
  const entryAt = (i: number): Entry | null => {
    if (isLive) {
      const post = live.posts.current[i];
      return post ? { key: post.id, text: post.text, p: post.p, meta: post.hidden ? `hidden by the safety check · ${Math.round(post.safe * 100)}% unsafe` : `Bluesky · ${new Date(post.t).toLocaleTimeString()}` } : null;
    }
    const r = reviews[i];
    return r ? { key: r.id, text: r.text, p: probs.current[i], meta: `Steam ${r.voted_up ? "👍" : "👎"} · ${r.hours.toLocaleString()} h` } : null;
  };
  const hovered = hover ? entryAt(hover.i) : null;
  const feedEntries: Entry[] = (isLive ? live.feed : feed).map((f) => entryAt(f.i)).filter((e): e is Entry => !!e);
  const criterion = isLive ? live.stats?.criterion : run?.criterion;
  const busy = isLive ? live.running : running;

  const input = (
    <div className="relative flex items-center gap-3">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          typeGen.current += 1;
          setTyping(false);
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit(query);
        }}
        placeholder="a criterion, in plain English…"
        autoFocus={!demo}
        spellCheck={false}
        aria-label="Criterion"
        className={`w-full rounded-2xl border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] outline-none transition focus:border-[var(--accent)] ${
          demo ? (portrait ? "px-6 py-4 text-3xl" : "px-6 py-4 text-3xl") : "px-5 py-4 text-xl"
        }`}
      />
      {isLive && busy && !typing ? (
        <button
          type="button"
          onClick={liveStop}
          aria-label="Stop listening"
          className={`absolute right-5 flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg)] text-[var(--muted)] transition hover:border-[var(--hot)] hover:text-[var(--text)] ${demo ? "px-4 py-1.5 text-lg" : "px-3 py-1 text-xs"}`}
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--hot)]" />
          live · stop <span className="text-[var(--muted)]">Esc</span>
        </button>
      ) : (
        <span className={`pointer-events-none absolute right-5 text-[var(--muted)] ${demo ? "text-lg" : "text-xs"}`}>
          {typing ? "typing…" : busy ? "sweeping…" : isLive && live.stats ? "stopped · ↵ to listen again" : isLive ? "↵ to listen" : "↵ to sweep"}
        </span>
      )}
    </div>
  );

  const matrix = isLive ? (
    <Matrix n={LIVE_CELLS} cols={LIVE_COLS} fit="width" probs={live.probs} landed={live.landed} hidden={live.hidden} version={live.version} hovered={hover?.i ?? -1} onHover={demo ? undefined : setHover} big={demo} />
  ) : (
    <Matrix n={reviews.length} probs={probs} landed={landed} version={version} hovered={hover?.i ?? -1} onHover={demo ? undefined : setHover} big={demo} />
  );
  const telemetry = isLive ? (
    <LiveTelemetry stats={live.stats} size={demo ? "lg" : "md"} portrait={portrait} />
  ) : (
    <Telemetry run={run} running={running} totals={totals} startedAt={startedAtRef} batchSize={batchSize} size={demo ? "lg" : "md"} portrait={portrait} />
  );

  if (demo) {
    return (
      <main className={`mx-auto flex h-screen w-full flex-col overflow-hidden ${portrait ? "gap-4 px-8 py-7" : "max-w-[1760px] gap-4 px-10 py-6"}`}>
        <header className="flex items-baseline justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">
            <span className="text-[var(--accent)]">Jev</span> {isLive ? "reads Bluesky as it happens" : `sweeps ${reviews.length ? reviews.length.toLocaleString() : "10,000"} ${STEAM_GAME} reviews`}
          </h1>
          <span className="mono text-lg text-[var(--muted)]">{isLive ? "the live firehose · one question" : "one question · one pass"}</span>
        </header>
        {input}
        {telemetry}
        <div className={`relative min-h-0 flex-1 ${portrait || isLive ? "flex flex-col gap-4" : "flex gap-8"}`}>
          <div className={`relative min-h-0 ${isLive ? "w-full shrink-0" : portrait ? "flex-1" : "aspect-square h-full shrink-0"}`}>
            {matrix}
            <Caption text={caption} />
          </div>
          <Feed entries={feedEntries} criterion={criterion} live={isLive} big portrait={portrait} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-5 px-5 py-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-[var(--accent)]">Jev</span> {isLive ? "Reads Bluesky Live" : `Sweeps ${reviews.length ? reviews.length.toLocaleString() : "10,000"} Reviews`}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {isLive
              ? "Type a criterion, press Enter. Every English post on the Bluesky firehose is judged as it lands, sampled to 200 a second; a safety check hides a post before it can render. The newest post overwrites the oldest dot."
              : `Type a criterion, press Enter. Every ${STEAM_GAME} review on the board is judged against it in one pass, ${batchSize || "…"} to a request. One dot per review, brightness is the probability.`}{" "}
            <a href="/grid" className="text-[var(--accent)] hover:underline">
              Find the movie →
            </a>
            {" · "}
            <a href="/race" className="text-[var(--accent)] hover:underline">
              Race a chat model →
            </a>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loadError && <span className="mono text-sm text-[var(--hot)]">reviews failed to load: {loadError}</span>}
          {run?.error && !isLive && <span className="mono text-sm text-[var(--hot)]">{run.error}</span>}
          {live.stats?.error && isLive && <span className="mono text-sm text-[var(--hot)]">{live.stats.error}</span>}
          <ModeSwitch mode={mode} onChange={switchMode} />
        </div>
      </header>

      {input}
      {telemetry}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className={`relative mx-auto w-full ${isLive ? "" : "max-w-[820px]"}`}>
          {matrix}
          {hovered && hover && <Tooltip entry={hovered} x={hover.x} y={hover.y} />}
        </div>
        <aside className="flex flex-col gap-5">
          <section>
            <h2 className="mb-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">Try</h2>
            <div className="flex flex-wrap gap-2">
              {(isLive ? LIVE_PRESETS : PRESETS).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void typeOut(p)}
                  className={`rounded-full border px-3 py-1 text-left text-sm transition hover:border-[var(--accent)] hover:text-[var(--text)] ${
                    criterion === p ? "border-[var(--accent)] text-[var(--text)]" : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </section>
          {!isLive && <CalibrationPanel probs={probs} reviews={reviews} version={version} run={run} relevant={!!isRecommends} />}
          <Feed entries={feedEntries} criterion={criterion} live={isLive} />
        </aside>
      </div>
    </main>
  );
}

// ---------- matrix ----------

const DIM = [27, 30, 44]; // an unjudged dot
const LOW = [22, 26, 40]; // p = 0
const HIGH = [111, 234, 220]; // p = 1, --accent-2 lifted
const HIDDEN = [96, 34, 46]; // a post the safety check kept off the screen
const FLASH_MS = 650;

/**
 * The 100×100 matrix on a canvas. Ten thousand DOM nodes would spend the frame budget on
 * layout; here a repaint is one pass over two typed arrays. Brightness is the probability
 * (with a curve so the dim end stays legible), and a cell flashes white as it lands, so the
 * sweep reads as batches arriving rather than a fade.
 */
function Matrix({
  n,
  cols = COLS,
  fit = "both",
  probs,
  landed,
  hidden,
  version,
  hovered,
  onHover,
  big,
}: {
  n: number;
  cols?: number;
  /** "both" fits the box's shorter side (a square in a fixed-height box); "width" sizes from the width alone, for a band whose box has no height of its own. */
  fit?: "both" | "width";
  probs: RefObject<Float32Array>;
  landed: RefObject<Float32Array>;
  /** 1 where the safety check hid the post; drawn in its own colour, never bright. */
  hidden?: RefObject<Uint8Array>;
  version: number;
  hovered: number;
  onHover?: (h: { i: number; x: number; y: number } | null) => void;
  big: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cell, setCell] = useState(0);
  const rows = Math.max(1, Math.ceil(n / cols));
  const width = cell * cols;
  const height = cell * rows;

  // Cells are as big as the box allows: its width over 100 columns, unless the rows would overflow its height.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      setCell(Math.max(0, Math.min(w / cols, fit === "both" && h > 0 ? h / rows : Infinity)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows, cols, fit]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !cell) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const gap = Math.max(1, cell * (big ? 0.26 : 0.3));
    const side = cell - gap;
    const radius = Math.min(side / 2, cell >= 20 ? 6 : big ? 2.5 : 1.5);
    let raf = 0;
    const draw = () => {
      const now = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const p = probs.current;
      const l = landed.current;
      const h = hidden?.current;
      let animating = false;
      for (let i = 0; i < n; i++) {
        const x = (i % cols) * cell + gap / 2;
        const y = Math.floor(i / cols) * cell + gap / 2;
        const v = p[i];
        let r: number, g: number, b: number, a: number;
        if (v < 0) {
          [r, g, b] = DIM;
          a = 1;
        } else {
          if (h && h[i]) {
            [r, g, b] = HIDDEN;
          } else {
            const k = Math.pow(v, 1.4);
            r = LOW[0] + (HIGH[0] - LOW[0]) * k;
            g = LOW[1] + (HIGH[1] - LOW[1]) * k;
            b = LOW[2] + (HIGH[2] - LOW[2]) * k;
          }
          a = 1;
          const dt = now - l[i];
          if (dt < FLASH_MS) {
            animating = true;
            const f = 1 - dt / FLASH_MS;
            r += (255 - r) * f * 0.85;
            g += (255 - g) * f * 0.85;
            b += (255 - b) * f * 0.85;
          }
        }
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
        if (radius > 1) {
          ctx.beginPath();
          ctx.roundRect(x, y, side, side, radius);
          ctx.fill();
        } else ctx.fillRect(x, y, side, side);
      }
      if (hovered >= 0 && hovered < n) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect((hovered % cols) * cell - 1, Math.floor(hovered / cols) * cell - 1, cell + 2, cell + 2);
      }
      if (animating) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [n, cols, cell, width, height, version, hovered, big, probs, landed, hidden]);

  const cellOf = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const i = Math.floor(y / cell) * cols + Math.floor(x / cell);
    return i >= 0 && i < n ? { i, x, y } : null;
  };

  return (
    <div ref={wrap} className="flex h-full min-h-0 w-full items-center justify-center">
      <canvas
        ref={canvas}
        style={{ width, height }}
        className="block rounded-xl"
        aria-label={`${n} reviews, one dot each; brightness is the probability the criterion holds`}
        onMouseMove={onHover ? (e) => onHover(cellOf(e)) : undefined}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
      />
    </div>
  );
}

function Tooltip({ entry, x, y }: { entry: Entry; x: number; y: number }) {
  const judged = entry.p >= 0;
  return (
    <div
      className="pointer-events-none absolute z-10 w-72 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 text-sm shadow-xl"
      style={{ left: Math.min(x + 14, 700), top: y + 14 }}
    >
      <p className={entry.text ? "text-[var(--text)]" : "italic text-[var(--hot)]"}>{entry.text ?? "hidden"}</p>
      <p className="mono mt-2 flex justify-between gap-3 text-xs text-[var(--muted)]">
        <span className={judged && entry.p >= 0.5 ? "text-[var(--accent-2)]" : ""}>{judged ? `${Math.round(entry.p * 100)}% match` : "not judged yet"}</span>
        <span className="truncate">{entry.meta}</span>
      </p>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opt = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      aria-pressed={mode === m}
      className={`rounded-full px-3 py-1 text-sm transition ${mode === m ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--panel)] p-1">
      {opt("steam", `${STEAM_GAME} reviews`)}
      {opt("live", "Bluesky live")}
    </div>
  );
}

// ---------- telemetry ----------

/** Every figure framed as work done: reviews through the model, the rate, tokens, and what a chat model would charge to read the same. */
function Telemetry({
  run,
  running,
  totals,
  startedAt,
  batchSize,
  size,
  portrait = false,
}: {
  run: SweepRun | null;
  running: boolean;
  totals: Totals;
  startedAt: RefObject<number>;
  batchSize: number;
  size: "lg" | "md";
  portrait?: boolean;
}) {
  const elapsed = useStopwatch(running, startedAt);
  const ms = running ? elapsed : run?.ms ?? null;
  const judged = run?.judged ?? 0;
  const total = run?.total ?? 0;
  const perS = ms && judged ? Math.round(judged / (ms / 1000)) : null;
  const tokens = run?.tokens ?? 0;
  const msText = ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
  const msTone = running ? "text-[var(--warn)]" : run?.done ? "text-[var(--good)]" : "text-[var(--muted)]";
  const lg = size === "lg";
  return (
    <div className={`mono ${portrait ? "grid grid-cols-3 gap-x-6 gap-y-5" : lg ? "flex items-stretch gap-x-7" : "flex flex-wrap items-stretch gap-x-8 gap-y-4"} rounded-2xl border border-[var(--line)] bg-[var(--panel)] ${lg ? "px-7 py-4" : "px-5 py-3"}`}>
      {portrait ? (
        // The 4:5 frame has no room for "10,000 / 10,000" at phone size; the total moves under the label.
        <HudCell size={size} label="reviews judged" value={run ? judged.toLocaleString() : "—"} width={6} sub={run ? `of ${total.toLocaleString()} · ${run.landed} of ${run.batches} requests` : `${batchSize || "…"} a request`} />
      ) : (
        <HudCell size={size} label="reviews judged" value={run ? `${judged.toLocaleString()} / ${total.toLocaleString()}` : "—"} width={lg ? 15 : 14} sub={run ? `${run.landed} of ${run.batches} requests · ${batchSize} a request` : `${batchSize || "…"} a request`} />
      )}
      <HudCell size={size} label="elapsed" value={msText} width={7} tone={msTone} pulse={running} sub={run?.done ? "one pass, start to finish" : "wall clock"} />
      <HudCell size={size} label="per second" value={perS ? perS.toLocaleString() : "—"} width={6} sub="reviews judged" />
      <HudCell size={size} label="matches" value={run ? run.matched.toLocaleString() : "—"} width={6} tone="text-[var(--accent-2)]" sub={run && judged ? `${Math.round((100 * run.matched) / judged)}% of those judged` : "p ≥ 50%"} />
      <HudCell size={size} label="tokens read" value={tokens ? tokens.toLocaleString() : "—"} width={9} sub={run?.retries ? `${run.retries} retries` : "every review, every question"} />
      <HudCell size={size} label="cost" value={tokens ? money(tokens * PRICE_PER_TOKEN) : "—"} width={6} sub={tokens ? `chat model: ${money(tokens * CHAT_PRICE_PER_TOKEN)} to read the same` : "list price"} />
      {!portrait && lg && (
        <div className="ml-auto flex shrink-0 flex-col items-end justify-center whitespace-nowrap text-sm text-[var(--muted)]">
          <span className="text-[var(--text)]">jev</span>
          <span>{totals.runs ? `${totals.runs} sweeps · ${totals.items.toLocaleString()} judgments · ${money(totals.tokens * PRICE_PER_TOKEN)}` : "session"}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Firehose telemetry. The hero is the lag behind the network: how far the judgments trail
 * the posts, including Jetstream delivery, batching, and the model. The sampler and the
 * safety check report their own counts so the throttle and the hiding are visible.
 */
function LiveTelemetry({ stats, size, portrait = false }: { stats: LiveStats | null; size: "lg" | "md"; portrait?: boolean }) {
  const lg = size === "lg";
  const lag = stats?.lag ?? 0;
  const lagText = !stats ? "—" : lag >= 1000 ? `${(lag / 1000).toFixed(1)} s` : `${lag} ms`;
  const lagTone = !stats?.connected ? "text-[var(--muted)]" : lag > 3000 ? "text-[var(--hot)]" : lag > 1500 ? "text-[var(--warn)]" : "text-[var(--good)]";
  const tokens = stats?.tokens ?? 0;
  return (
    <div className={`mono ${portrait ? "grid grid-cols-3 gap-x-6 gap-y-5" : lg ? "flex items-stretch gap-x-7" : "flex flex-wrap items-stretch gap-x-8 gap-y-4"} rounded-2xl border border-[var(--line)] bg-[var(--panel)] ${lg ? "px-7 py-4" : "px-5 py-3"}`}>
      <HudCell size={size} label="behind the network" value={lagText} width={7} tone={lagTone} pulse={!!stats?.connected} sub={stats ? (stats.backlog ? `${stats.backlog} posts waiting · ${stats.inflight} requests out` : `${stats.inflight} requests out`) : "post → judgment on screen"} />
      <HudCell size={size} label="posts judged" value={stats ? stats.judged.toLocaleString() : "—"} width={7} sub={stats ? `${stats.perS}/s now · sampled to 200/s${stats.dropped ? ` · ${stats.dropped.toLocaleString()} dropped` : ""}` : "live, sampled to 200/s"} />
      <HudCell size={size} label="matches" value={stats ? stats.matched.toLocaleString() : "—"} width={6} tone="text-[var(--accent-2)]" sub={stats && stats.judged ? `${Math.round((100 * stats.matched) / stats.judged)}% of posts` : "p ≥ 50%"} />
      <HudCell size={size} label="hidden" value={stats ? stats.hidden.toLocaleString() : "—"} width={5} tone="text-[var(--hot)]" sub="by the safety check, before render" />
      <HudCell size={size} label="tokens read" value={tokens ? tokens.toLocaleString() : "—"} width={9} sub="two questions a post" />
      <HudCell size={size} label="cost" value={tokens ? money(tokens * PRICE_PER_TOKEN) : "—"} width={6} sub={tokens ? `chat model: ${money(tokens * CHAT_PRICE_PER_TOKEN)} to read the same` : "list price"} />
      {!portrait && lg && (
        <div className="ml-auto flex shrink-0 flex-col items-end justify-center whitespace-nowrap text-sm text-[var(--muted)]">
          <span className="text-[var(--text)]">jev</span>
          <span>{stats?.connected ? "connected to Jetstream" : "not connected"}</span>
        </div>
      )}
    </div>
  );
}

// ---------- feed ----------

/** The sweep's own voice: the strongest matches of each batch as it lands, so the video shows what lit up and why. */
function Feed({ entries, criterion, live = false, big = false, portrait = false }: { entries: Entry[]; criterion: string | undefined; live?: boolean; big?: boolean; portrait?: boolean }) {
  const shown = entries.slice(portrait ? -2 : big ? (live ? -4 : -5) : -6).reverse();
  // Rows in a column can slide; cells in a grid can't without overlapping mid-move, so the grid only fades.
  const slide = !(big && live);
  return (
    <section className={`flex min-h-0 min-w-0 flex-col ${portrait ? "shrink-0" : "flex-1"}`}>
      <h2 className={`mb-2 uppercase tracking-wide text-[var(--muted)] ${big ? "text-sm" : "text-[10px]"}`}>
        {criterion ? (
          <>
            lighting up for <span className="normal-case text-[var(--text)]">“{criterion}”</span>
          </>
        ) : (
          "matches, as they land"
        )}
      </h2>
      <ul className={`min-h-0 ${big && live ? "grid grid-cols-2 gap-3" : `flex flex-col ${big ? "gap-3" : "gap-2"}`}`}>
        <AnimatePresence initial={false}>
          {shown.map((e) => {
            return (
              <motion.li
                key={e.key}
                layout={slide}
                initial={{ opacity: 0, y: slide ? -8 : 0 }}
                animate={{ opacity: 1, y: 0 }}
                exit={slide ? { opacity: 0 } : undefined}
                transition={SPRING}
                className={`rounded-xl border border-[var(--line)] bg-[var(--panel)] ${big ? (portrait ? "px-4 py-2.5 text-lg" : "px-4 py-3 text-xl") : "px-3 py-2 text-sm"}`}
              >
                <p className={`text-[var(--text)] ${portrait ? "line-clamp-1" : "line-clamp-2"}`}>{e.text}</p>
                <p className={`mono mt-1 flex justify-between gap-3 text-[var(--muted)] ${big ? "text-base" : "text-xs"}`}>
                  <span className="text-[var(--accent-2)]">{Math.round(e.p * 100)}%</span>
                  <span className="truncate">{e.meta}</span>
                </p>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {!shown.length && <li className={`text-[var(--muted)] ${big ? "text-lg" : "text-xs"}`}>{criterion ? (live ? "listening to the firehose…" : "waiting for the first batch…") : "press Enter on a criterion"}</li>}
      </ul>
    </section>
  );
}

// ---------- calibration ----------

/** Predicted-probability buckets against Steam's thumb: the ground truth for "recommends", a curiosity for anything else. */
function CalibrationPanel({ probs, reviews, version, run, relevant }: { probs: RefObject<Float32Array>; reviews: Review[]; version: number; run: SweepRun | null; relevant: boolean }) {
  // Recomputed per landed batch; 10,000 cells is nothing next to a repaint.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cal = useMemo(() => calibration(probs.current, reviews), [version, reviews, probs]);
  if (!run || cal.n < 500) return null;
  const H = 60;
  return (
    <section>
      <h2 className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">Calibration · vs Steam’s thumbs-up</h2>
      <p className="mb-2 text-xs text-[var(--muted)]">
        {relevant ? (
          <>
            Predicted bucket (outline) against the actual thumbs-up rate (filled). {Math.round(cal.accuracy * 100)}% agree with Steam at 50%.
          </>
        ) : (
          <>Only meaningful for “{RECOMMENDS}”; shown for this criterion as a curiosity.</>
        )}
      </p>
      {/* Stretched to the column; nothing inside has a shape that would distort. */}
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: 96 }} aria-label="calibration buckets">
        <line x1="0" y1={H - 0.5} x2="100" y2={H - 0.5} stroke="var(--line)" strokeWidth="0.5" />
        {cal.buckets.map((b, k) => {
          const x = k * 10;
          const hp = b.predicted * (H - 2);
          const ha = b.actual * (H - 2);
          return (
            <g key={k}>
              <title>{`${(b.lo * 100).toFixed(0)}–${((b.lo + 0.1) * 100).toFixed(0)}% predicted · ${b.n.toLocaleString()} reviews · ${Math.round(b.actual * 100)}% thumbs-up`}</title>
              <motion.rect x={x + 1.5} width={7} fill="var(--accent-2)" opacity={b.n ? 0.85 : 0.15} initial={false} animate={{ y: H - 1 - ha, height: Math.max(0.5, ha) }} transition={SPRING} />
              <rect x={x + 1.5} y={H - 1 - hp} width={7} height={Math.max(0.5, hp)} fill="none" stroke="var(--text)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" opacity={0.7} />
            </g>
          );
        })}
      </svg>
      <div className="mono mt-1 grid grid-cols-10 text-center text-[10px] text-[var(--muted)]">
        {cal.buckets.map((b, k) => (
          <span key={k}>{b.n >= 1000 ? `${(b.n / 1000).toFixed(1)}k` : b.n}</span>
        ))}
      </div>
      <p className="mono mt-1 flex justify-between text-[10px] text-[var(--muted)]">
        <span>0% predicted</span>
        <span>n per bucket</span>
        <span>100%</span>
      </p>
    </section>
  );
}

// ---------- caption ----------

/** One line over the matrix for the muted 4:5 cut. */
function Caption({ text }: { text: string }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          key={text}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={SPRING}
          className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center"
        >
          <span className="rounded-2xl bg-black/75 px-6 py-3 text-center text-3xl font-semibold leading-snug text-white shadow-2xl backdrop-blur">{text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
