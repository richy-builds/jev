"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CHUNKS, MOVIES, MOVIE_BY_ID, type FindResponse, type Mode } from "@/lib/movies";
import type { Tag } from "@/lib/inspect";
import { composite, DIM_LABELS, DIMS, weightsActive, ZERO_WEIGHTS, type Dim, type Weights } from "@/lib/scores";
import { EXISTS_FLOOR, INSPECT_TOP, useFind, type Status, type Totals, type TracePoint } from "@/lib/use-find";
import { readScriptParams, runScript, typeWords, type Step } from "@/lib/script";
import { useSpeech } from "@/lib/use-speech";
import { CHAT_PRICE_PER_TOKEN, HudCell, ListeningBadge, MicButton, money, NotItButton, pct, Pill, Poster, PRICE_PER_TOKEN, Sparkline, SPRING, TOKENS_PER_PAGE, TurnPill, useStopwatch } from "@/app/grid/ui";
import { useTurns } from "@/lib/use-turns";

// Probabilities returned per call, i.e. verdicts Jev gives in one round trip. The main call
// asks "is it you?" per film, "is any of you ruled out?" per film (+ one "none" per chunk),
// a chunk weight per chunk, "does this describe anything?", and a three-way router.
const FIND_VERDICTS = 2 * MOVIES.length + (CHUNKS.length > 1 ? 2 * CHUNKS.length : 1) + 4;

const TAG_THRESHOLD = 0.6;
const TAG_LABELS: Record<Tag, string> = { plot: "plot", scene: "a scene", line: "a line", actor: "a name", era: "the era" };

const EXAMPLES: string[] = [
  "the one where the guy can't remember anything and has tattoos",
  "kids hide from a shark. no wait, dinosaurs",
  "sad little robot alone on earth stacking trash",
  "poor family sneaks into rich family's house, secret basement",
  "two magicians who hate each other",
  "he talks to a volleyball",
  "spinning top at the end",
  "grumpy old man, balloons, talking dog",
  "the nolan one that isn't inception",
  "ripley and the xenomorph",
  "a comedy",
];

// Recording mode (/grid?demo=1): the wall shows only the current top DEMO_WALL films, big,
// and the telemetry moves into a strip under the input where a phone viewer can read it.
const DEMO_WALL = 48;
const DEMO_COLS = 12;

const SCRIPTS: Record<string, Step[]> = {
  main: [
    { type: "type", text: "kids hide from a shark. no wait, dinosaurs", hold: 2500 },
    { type: "clear", hold: 400 },
    { type: "type", text: "a comedy", hold: 2000 },
    { type: "slider", dim: "funny", to: 1, ms: 1200, hold: 2500 },
    { type: "wait", ms: 2000 },
  ],
  // Spoken description: words land at speaking pace, calls fire as they would from a microphone.
  "grid-voice": [
    { type: "say", text: "grumpy old man, balloons, talking dog", hold: 3000 },
    { type: "wait", ms: 500 },
  ],
  // Follow-ups: each Enter keeps the answer as the thing the next description refers to.
  "grid-refine": [
    { type: "type", text: "alien on the spaceship, chestburster", hold: 1800 },
    { type: "commit", hold: 600 },
    { type: "type", text: "no, the sequel", hold: 2500 },
    { type: "commit", hold: 600 },
    { type: "type", text: "same director, the liquid metal one", hold: 3000 },
    { type: "wait", ms: 800 },
  ],
};

type WallMode = Mode | "idle";
type Params = { demo: boolean; script: string | null; delay: number };

export default function GridPage() {
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [weights, setWeights] = useState<Weights>(ZERO_WEIGHTS);
  const [params, setParams] = useState<Params>({ demo: false, script: null, delay: 2000 });
  const [scriptRunning, setScriptRunning] = useState(false);
  /** Scripted "listening" (a recording); the real microphone has its own flag in `speech`. */
  const [listening, setListening] = useState(false);

  // Declared before the speech hook so `listening` (scripted or real) can switch the call strategy.
  const speechListeningRef = useRef(false);
  const turns = useTurns();
  const { find, fits, inspect, status, error, fitsPending, inspectPending, totals, trace, startedAtRef, settled } = useFind(query, {
    previous: turns.previous,
    earlier: turns.earlier,
    overlap: listening || speechListeningRef.current,
  });
  /** Enter / "not it" / the `commit` script step: assigned every render so it sees the current lock. */
  const commitRef = useRef<() => void>(() => {});

  const inputRef = useRef<HTMLInputElement>(null);
  const scriptAbortRef = useRef(false);
  const weightsRef = useRef(weights);
  weightsRef.current = weights;

  // Deep link: /grid?q=some+text prefills the box (handy for recording).
  // /grid?demo=1 switches to the recording layout; &script=main&delay=2000 drives it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
    setParams(readScriptParams());
  }, []);

  // Presets type out word by word (lib/script.ts). A real keystroke cancels the preset.
  const typeGen = useRef(0);
  const typeOut = useCallback(
    async (text: string) => {
      const gen = ++typeGen.current;
      await typeWords(text, { setQuery, setTyping, settled, aborted: () => gen !== typeGen.current });
      if (gen === typeGen.current) inputRef.current?.focus();
    },
    [settled],
  );
  const cancelTypeOut = useCallback(() => {
    typeGen.current += 1;
    setTyping(false);
  }, []);

  useEffect(() => () => void (typeGen.current += 1), []);

  // The microphone drives the same query state, so interim words re-rank the wall as they land.
  const speech = useSpeech({
    onTranscript: (text) => {
      cancelTypeOut();
      setQuery(text);
    },
  });
  speechListeningRef.current = speech.listening;

  // Script runner: lib/script.ts plays the steps; this page adds the slider tween. Escape aborts.
  useEffect(() => {
    const steps = params.script ? SCRIPTS[params.script] : null;
    if (!steps) return;
    scriptAbortRef.current = false;
    let raf = 0;
    const aborted = () => scriptAbortRef.current;
    const tween = (dim: Dim, to: number, ms: number) =>
      new Promise<void>((resolve) => {
        const from = weightsRef.current[dim];
        const t0 = performance.now();
        const frame = (now: number) => {
          const k = Math.min(1, (now - t0) / ms);
          const e = 1 - Math.pow(1 - k, 3);
          setWeights((w) => ({ ...w, [dim]: Math.round((from + (to - from) * e) * 20) / 20 }));
          if (k < 1 && !aborted()) raf = requestAnimationFrame(frame);
          else resolve();
        };
        raf = requestAnimationFrame(frame);
      });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") scriptAbortRef.current = true;
    };
    window.addEventListener("keydown", onKey);

    (async () => {
      setScriptRunning(true);
      await runScript(steps, {
        setQuery,
        setTyping,
        setListening,
        settled,
        aborted,
        delay: params.delay,
        hooks: {
          slider: async (s) => (s.type === "slider" ? tween(s.dim, s.to, s.ms) : undefined),
          commit: async () => commitRef.current(),
        },
      });
      setScriptRunning(false);
    })();

    return () => {
      window.removeEventListener("keydown", onKey);
      scriptAbortRef.current = true;
      cancelAnimationFrame(raf);
    };
  }, [params.script, params.delay, settled]);

  const mode: WallMode = find?.mode ?? "idle";
  const exists = find?.exists ?? 0;
  const excluded = find?.excluded ? MOVIE_BY_ID[find.excluded] : null;
  // Sliders re-sort the wall from the offline scores, no API call. While the person
  // is hunting for one particular film they would only fight the ranking, so they pause.
  const slidersOn = weightsActive(weights) && mode !== "finder";

  // Finder mode: the second pass re-read the top few films with their full summary,
  // director and cast. Its probabilities redistribute the mass those films already
  // held, so it can only reorder the shortlist, never promote a film from nowhere.
  const probs = useMemo(() => {
    if (!find) return null;
    if (mode !== "finder" || !inspect) return find.probabilities;
    const mass = inspect.ids.reduce((s, id) => s + (find.probabilities[id] ?? 0), 0);
    const out = { ...find.probabilities };
    for (const id of inspect.ids) out[id] = (inspect.probabilities[id] ?? 0) * mass;
    return out;
  }, [find, inspect, mode]);

  // How much to trust the finder ranking. Choice probabilities always sum to 1, so a
  // meaningless description still crowns some film; the Noul says whether the
  // description points at anything. Below the floor the wall stays flat and unsorted.
  const emphasis = Math.min(1, Math.max(0, (exists - EXISTS_FLOOR) / 0.5));
  const finding = mode === "finder" && !!probs && exists >= EXISTS_FLOOR;
  const fitOf = (id: string) => fits?.fits[id] ?? 0;
  const lit = (id: string) => !!fits && fitOf(id) >= fits.threshold;

  const comp = useMemo(() => {
    const map: Record<string, number> = {};
    if (!slidersOn) return { map, min: 0, max: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const m of MOVIES) {
      const c = composite(m.id, weights);
      map[m.id] = c;
      if (c < min) min = c;
      if (c > max) max = c;
    }
    return { map, min, max: max > min ? max : min + 1e-6 };
  }, [slidersOn, weights]);
  const compRel = (id: string) => (comp.map[id] - comp.min) / (comp.max - comp.min);

  const ranked = useMemo(() => {
    const list = [...MOVIES];
    if (finding && probs) return list.sort((a, b) => (probs[b.id] ?? 0) - (probs[a.id] ?? 0));
    if (mode === "set" && fits) {
      return list.sort((a, b) => {
        const la = lit(a.id);
        const lb = lit(b.id);
        if (la !== lb) return la ? -1 : 1;
        return slidersOn ? comp.map[b.id] - comp.map[a.id] : fitOf(b.id) - fitOf(a.id);
      });
    }
    if (slidersOn) return list.sort((a, b) => comp.map[b.id] - comp.map[a.id]);
    return MOVIES;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding, probs, mode, fits, slidersOn, comp]);

  const max = probs ? Math.max(...MOVIES.map((m) => probs[m.id] ?? 0), 1e-6) : 0;
  const top = finding ? ranked[0] : null;
  const topP = top && probs ? probs[top.id] ?? 0 : 0;
  const locked = !!top && exists >= 0.5 && topP >= 0.35 && !(inspect?.close ?? false);
  const lockedAnswer = locked && top ? { id: top.id, title: top.title, year: top.year, director: top.director } : null;
  commitRef.current = () => {
    cancelTypeOut();
    if (turns.commit(query, lockedAnswer)) setQuery("");
  };
  const tags: Tag[] = top && inspect?.evidence[top.id] ? (Object.keys(TAG_LABELS) as Tag[]).filter((t) => inspect.evidence[top.id][t] >= TAG_THRESHOLD) : [];
  const split = inspect?.close && probs ? [...inspect.ids].sort((a, b) => (probs[b] ?? 0) - (probs[a] ?? 0)).slice(0, 2) : null;
  const setCount = mode === "set" && fits ? fits.count : null;
  const tokens = find?.tokens != null ? find.tokens + (fits?.tokens ?? 0) + (inspect?.tokens ?? 0) : null;
  const extraMs = (mode === "set" ? fits?.latencyMs : inspect?.latencyMs) ?? 0;
  // Verdicts this keystroke: the main call, plus one yes/no per film for a set, plus the
  // second look (a re-rank over the shortlist and five evidence questions for each of the top 3).
  const verdicts = find ? FIND_VERDICTS + (fits ? MOVIES.length : 0) + (inspect ? inspect.ids.length + 5 * Math.min(3, inspect.ids.length) : 0) : null;

  const demo = params.demo;
  const busy = fitsPending || inspectPending;
  const wall = demo ? ranked.slice(0, DEMO_WALL) : ranked;

  const tiles = wall.map((m, i) => {
    const isExcluded = excluded?.id === m.id;
    let opacity = 1;
    let saturate = 1;
    let ring: string | undefined;
    let label: string | null = null;
    if (finding && probs) {
      const p = probs[m.id] ?? 0;
      const rel = p / max;
      opacity = 1 - 0.78 * emphasis * (1 - Math.pow(rel, 0.6));
      saturate = 1 - 0.75 * emphasis * (1 - rel);
      if (i === 0 && locked) ring = "0 0 0 3px var(--good), 0 0 28px 4px rgba(61,220,151,.45)";
      else if (split?.includes(m.id)) ring = "0 0 0 2px var(--warn)";
      if (i < 8 && p >= 0.02) label = pct(p);
    } else if (mode === "set" && fits) {
      const f = fitOf(m.id);
      if (lit(m.id)) {
        ring = "0 0 0 2px var(--accent-2)";
        if (i < 8) label = pct(f);
      } else {
        // Gradient below the threshold: a near miss stays readable, a clear miss recedes.
        const rel = Math.pow(f / fits.threshold, 1.5);
        opacity = 0.16 + 0.5 * rel;
        saturate = 0.25 + 0.5 * rel;
      }
    } else if (slidersOn) {
      const rel = compRel(m.id);
      opacity = 0.22 + 0.78 * Math.pow(rel, 0.8);
      saturate = 0.3 + 0.7 * rel;
    } else if (mode === "set") {
      opacity = 0.6;
    }
    if (isExcluded) {
      opacity = Math.min(opacity, 0.35);
      saturate = 0;
      ring = "0 0 0 2px var(--hot)";
    }
    return (
      <motion.div
        key={m.id}
        layout
        transition={SPRING}
        // Demo wall: films entering the top DEMO_WALL fade in; films leaving just unmount.
        // (AnimatePresence popLayout left ghost tiles behind when a film left and re-entered
        // within one word, so exits are not animated.)
        initial={demo ? { opacity: 0, scale: 0.85 } : false}
        animate={demo ? { opacity, scale: 1 } : undefined}
        className={`relative aspect-[2/3] overflow-hidden bg-[var(--panel-2)] ${demo ? "rounded-lg" : "rounded-md"}`}
        style={{ opacity: demo ? undefined : opacity, filter: `saturate(${saturate})`, boxShadow: ring, zIndex: i === 0 && finding ? 2 : undefined }}
      >
        <Poster m={m} />
        {label && (
          <span className={`mono absolute bottom-1 left-1 rounded bg-black/70 text-white ${demo ? "px-1.5 py-0.5 text-sm" : "px-1 text-[10px] leading-4"}`}>{label}</span>
        )}
        {isExcluded && (
          <span className={`absolute inset-0 flex items-center justify-center font-semibold text-[var(--hot)] ${demo ? "text-5xl" : "text-2xl"}`} aria-label="ruled out">
            ✕
          </span>
        )}
      </motion.div>
    );
  });

  return (
    <main className={demo ? "mx-auto flex h-screen w-full max-w-[1560px] flex-col gap-4 overflow-hidden px-8 py-6" : "flex min-h-screen flex-col gap-5 px-5 py-6 md:px-8"}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-[var(--accent)]">Jev</span> Finds the Movie
          </h1>
          {!demo && (
            <p className="mt-1 text-sm text-[var(--muted)]">
              Describe it badly. Every keystroke, Jev reads all {MOVIES.length} films and returns {FIND_VERDICTS.toLocaleString()} probabilities in one call. No generated text.{" "}
              <Link href="/" className="text-[var(--accent)] hover:underline">
                Jev Live →
              </Link>
              {" · "}
              <a href="/race" className="text-[var(--accent)] hover:underline">
                Race a chat model →
              </a>
              {" · "}
              <a href="/sweep" className="text-[var(--accent)] hover:underline">
                Sweep 10,000 reviews →
              </a>
            </p>
          )}
        </div>
      </header>

      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            cancelTypeOut();
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !scriptRunning) commitRef.current();
          }}
          placeholder="the one where…"
          spellCheck={false}
          autoFocus
          readOnly={scriptRunning}
          className={`w-full rounded-2xl border border-[var(--line)] bg-[var(--panel)] outline-none transition placeholder:text-[#4b5064] focus:border-[var(--accent)] ${
            demo ? "px-6 py-4 text-3xl" : "px-5 py-4 text-xl"
          }`}
        />
        <span className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-3">
          <AnimatePresence>
            {turns.previous && (
              <TurnPill
                key={turns.previous.id}
                size={demo ? "lg" : "md"}
                answer={turns.previous}
                onReset={() => {
                  turns.reset();
                  inputRef.current?.focus();
                }}
              />
            )}
          </AnimatePresence>
          {(listening || speech.listening) && <ListeningBadge size={demo ? "lg" : "md"} />}
          {typing && !demo && !listening && <span className="pointer-events-none text-xs text-[var(--muted)]">typing…</span>}
          {!scriptRunning && !demo && (query.trim() !== "" || turns.previous) && (
            <NotItButton size={demo ? "lg" : "md"} disabled={!lockedAnswer && !turns.previous} onClick={() => commitRef.current()} />
          )}
          {!scriptRunning && (
            <MicButton
              size={demo ? "lg" : "md"}
              listening={speech.listening}
              supported={speech.supported}
              onToggle={() => {
                if (speech.listening) speech.stop();
                else {
                  cancelTypeOut();
                  setQuery("");
                  speech.start();
                }
              }}
            />
          )}
        </span>
      </div>

      {demo ? (
        <DemoHud status={status} busy={busy} find={find} mode={mode} tokens={tokens} extraMs={extraMs} totals={totals} startedAt={startedAtRef} />
      ) : (
        <Telemetry status={status} busy={busy} find={find} mode={mode} tokens={tokens} verdicts={verdicts} extraMs={extraMs} totals={totals} trace={trace} startedAt={startedAtRef} />
      )}

      {!demo && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((t) => (
            <button
              key={t}
              onClick={() => typeOut(t)}
              className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-[var(--hot)]">{error}</p>}

      <div className={demo ? "min-h-0 flex-1" : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]"}>
        {/* The wall */}
        <section
          // Remount when the recording layout kicks in, so every tile mounts with its animate props.
          key={demo ? "demo" : "full"}
          className={demo ? "grid gap-3" : "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(68px,1fr))]"}
          style={demo ? { gridTemplateColumns: `repeat(${DEMO_COLS}, minmax(0, 1fr))` } : undefined}
          aria-label={mode === "set" ? "Film posters, films that fit lit up" : "Film posters ranked by probability"}
        >
          {tiles}
        </section>

        {!demo && (
        <aside className="flex flex-col gap-4">
          {/* Best match / set / nothing */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-[var(--muted)]">
              <span>{mode === "set" ? "A set of films" : mode === "nothing" ? "Nothing yet" : "Best match"}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <AnimatePresence>
                  {excluded && (
                    <Pill key="excluded" tone="hot">
                      ruled out: {excluded.title}
                    </Pill>
                  )}
                  {locked && (
                    <Pill key="found" tone="good">
                      found it
                    </Pill>
                  )}
                  {setCount !== null && (
                    <Pill key="count" tone="accent-2">
                      {setCount} {setCount === 1 ? "film fits" : "films fit"}
                    </Pill>
                  )}
                </AnimatePresence>
              </span>
            </div>

            <AnimatePresence mode="popLayout" initial={false}>
              {mode === "set" ? (
                <motion.div key="set" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                  {fits ? (
                    <>
                      <div className="mono text-3xl font-semibold text-[var(--accent-2)]">{fits.count}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        of {MOVIES.length} films fit the description (fit ≥ {pct(fits.threshold)}). One yes/no per film, all in one request.
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-[var(--muted)]">Counting… asking {MOVIES.length} films at once.</div>
                  )}
                </motion.div>
              ) : top ? (
                <motion.div
                  key={top.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="flex gap-3"
                >
                  <div className="w-24 shrink-0 overflow-hidden rounded-lg">
                    <Poster m={top} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium leading-tight">{top.title}</div>
                    <div className="mono mt-0.5 text-xs text-[var(--muted)]">{top.year}</div>
                    <div className="mono mt-3 text-3xl font-semibold text-[var(--accent)]">{pct(topP)}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      matches something: <span className="mono text-[var(--text)]">{pct(exists)}</span>
                    </div>
                    {/* Evidence: one Noul per kind of clue, over the top film. Only the passing ones show. */}
                    <div className="mt-2 flex min-h-5 flex-wrap gap-1">
                      {tags.map((t) => (
                        <motion.span
                          key={t}
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--accent-2)]"
                          title={`matched on ${TAG_LABELS[t]}: ${pct(inspect!.evidence[top.id][t])}`}
                        >
                          {TAG_LABELS[t]}
                        </motion.span>
                      ))}
                      {tags.length === 0 && inspectPending && <span className="text-[10px] text-[var(--muted)]">checking why…</span>}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div key="none" className="text-sm text-[var(--muted)]">
                  {find ? (
                    <>
                      {mode === "nothing" ? "That doesn't point at a film yet." : "Nothing yet."} Matches something:{" "}
                      <span className="mono text-[var(--text)]">{pct(exists)}</span>
                    </>
                  ) : (
                    "Start typing."
                  )}
                </div>
              )}
            </AnimatePresence>

            {/* Near-duplicate split: the second pass re-read the shortlist with full summaries and still can't separate two. */}
            <AnimatePresence>
              {split && probs && (
                <motion.div
                  key="split"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 overflow-hidden"
                >
                  <div className="flex justify-between text-[11px]">
                    <span className="truncate pr-2">{MOVIE_BY_ID[split[0]].title}</span>
                    <span className="truncate pl-2 text-right">{MOVIE_BY_ID[split[1]].title}</span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded bg-[var(--panel-2)]">
                    <motion.span className="h-full bg-[var(--accent)]" animate={{ width: `${splitShare(probs, split) * 100}%` }} transition={SPRING} />
                    <span className="h-full flex-1 bg-[var(--warn)]" />
                  </div>
                  <div className="mono mt-1 flex justify-between text-[10px] text-[var(--muted)]">
                    <span>{pct(splitShare(probs, split))}</span>
                    <span>{pct(1 - splitShare(probs, split))}</span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--warn)]">Too close to call. Add a detail — a year, a name, a scene — to split them.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Runners up / in the set */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="mb-3 text-xs uppercase tracking-wide text-[var(--muted)]">{mode === "set" ? "In the set" : "Runners up"}</div>
            <ol className="flex flex-col gap-2">
              {(mode === "set" && fits
                ? ranked.slice(0, 5).filter((m) => lit(m.id))
                : finding && probs
                  ? ranked.slice(1, 6).filter((m) => (probs[m.id] ?? 0) >= 0.005)
                  : []
              ).map((m) => {
                const v = mode === "set" ? fitOf(m.id) : probs![m.id] ?? 0;
                const width = mode === "set" ? v * 100 : (v / max) * 100;
                return (
                  <motion.li key={m.id} layout transition={SPRING} className="flex items-center gap-2 text-sm">
                    <span className="w-10 shrink-0 overflow-hidden rounded">
                      <Poster m={m} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{m.title}</span>
                      <span className="mt-1 block h-1 overflow-hidden rounded bg-[var(--panel-2)]">
                        <motion.span className="block h-full bg-[var(--accent-2)]" animate={{ width: `${Math.max(2, width)}%` }} transition={SPRING} />
                      </span>
                    </span>
                    <span className="mono w-10 text-right text-xs text-[var(--muted)]">{pct(v)}</span>
                  </motion.li>
                );
              })}
              {mode === "set" && fits && fits.count > 5 && (
                <li className="text-xs text-[var(--muted)]">and {fits.count - 5} more lit on the wall</li>
              )}
              {mode === "set" && fits && fits.count === 0 && <li className="text-sm text-[var(--muted)]">No film clears the bar.</li>}
              {mode === "set" && !fits && <li className="text-sm text-[var(--muted)]">—</li>}
              {mode !== "set" && (!finding || (probs![ranked[1].id] ?? 0) < 0.005) && (
                <li className="text-sm text-[var(--muted)]">{finding ? "Nothing else comes close." : "—"}</li>
              )}
            </ol>
          </div>

          {/* Sliders: offline scores, zero API calls */}
          <div className={`rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 transition ${mode === "finder" ? "opacity-60" : ""}`}>
            <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wide text-[var(--muted)]">
              <span>Rank by quality</span>
              {weightsActive(weights) && (
                <button onClick={() => setWeights(ZERO_WEIGHTS)} className="normal-case text-[var(--accent)] hover:underline">
                  reset
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              {DIMS.map((d) => (
                <Slider key={d} dim={d} value={weights[d]} disabled={mode === "finder"} onChange={(v) => setWeights((w) => ({ ...w, [d]: v }))} />
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
              {mode === "finder"
                ? "Paused while you look for one film."
                : `Every film was scored once, offline, on ${DIMS.length} scales with concrete levels. Dragging re-sorts the wall${mode === "set" ? " inside the set" : ""} with zero API calls.`}
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--muted)]">
            One request asks {MOVIES.length} films “is it you?”, “is any of you ruled out?”, and a router “one film, a set, or nothing?”. A set answer asks {MOVIES.length}{" "}
            yes/no questions in a second request; a confident single film gets a second look over the top {INSPECT_TOP} for evidence. No generated text anywhere. Posters via Wikipedia.
          </p>
        </aside>
        )}
      </div>
    </main>
  );
}

function splitShare(probs: Record<string, number>, split: string[]) {
  const a = probs[split[0]] ?? 0;
  const b = probs[split[1]] ?? 0;
  return a + b > 0 ? a / (a + b) : 0.5;
}

function Slider({ dim, value, disabled, onChange }: { dim: Dim; value: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-[var(--muted)]">{DIM_LABELS[dim]}</span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
        className="h-1 flex-1 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
        aria-label={`${DIM_LABELS[dim]} weight`}
      />
      <span className={`mono w-9 text-right ${value === 0 ? "text-[var(--muted)]" : value > 0 ? "text-[var(--accent)]" : "text-[var(--hot)]"}`}>
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}
      </span>
    </label>
  );
}

/**
 * Telemetry for the full page. Every figure is framed as work done rather than a raw
 * count: the main call's latency is the hero (the second look is shown separately, it
 * never delays the wall), tokens become pages, cost sits next to what a chat model
 * would charge for the same tokens, and the sparkline shows confidence climbing
 * keystroke by keystroke, which is the part no text-generating model can show.
 */
function Telemetry({
  status,
  busy,
  find,
  mode,
  tokens,
  verdicts,
  extraMs,
  totals,
  trace,
  startedAt,
}: {
  status: Status;
  busy: boolean;
  find: FindResponse | null;
  mode: WallMode;
  tokens: number | null;
  verdicts: number | null;
  extraMs: number;
  totals: Totals;
  trace: TracePoint[];
  startedAt: React.RefObject<number>;
}) {
  const pending = status === "pending";
  const elapsed = useStopwatch(pending || busy, startedAt);
  // The stopwatch runs for the main call only; once the wall has re-sorted the number is final.
  const ms = pending ? `${elapsed} ms` : find ? `${find.latencyMs} ms` : "—";
  const msTone = pending ? "text-[var(--warn)]" : find ? "text-[var(--good)]" : "text-[var(--muted)]";
  const second = busy ? "second look…" : extraMs ? `+${extraMs} ms ${mode === "set" ? `for ${MOVIES.length} yes/no` : "second look"}` : find ? "one round trip" : "per keystroke";
  const pages = tokens ? Math.max(1, Math.round(tokens / TOKENS_PER_PAGE)) : null;
  const routerP = find ? find.router[mode === "finder" ? "specific" : mode === "set" ? "set" : "nothing"] : null;
  const modeText = mode === "idle" ? "—" : mode === "finder" ? "one film" : mode === "set" ? "a set" : "nothing";
  const modeTone = mode === "finder" ? "text-[var(--accent)]" : mode === "set" ? "text-[var(--accent-2)]" : "text-[var(--muted)]";

  return (
    <div className="mono flex flex-wrap items-stretch gap-x-7 gap-y-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-5 py-3">
      <HudCell size="md" label="per keystroke" value={ms} width={7} tone={msTone} pulse={pending} sub={second} />
      <HudCell size="md" label="verdicts" value={verdicts ? verdicts.toLocaleString() : "—"} width={5} sub={`across ${MOVIES.length} films`} />
      <HudCell size="md" label="tokens read" value={tokens ? tokens.toLocaleString() : "—"} width={6} sub={pages ? `≈ ${pages} pages of plot` : "every film, every time"} />
      <HudCell
        size="md"
        label="this keystroke"
        value={tokens ? money(tokens * PRICE_PER_TOKEN) : "—"}
        width={5}
        sub={tokens ? `chat model: ${money(tokens * CHAT_PRICE_PER_TOKEN)} to read the same` : "—"}
      />
      <HudCell size="md" label="session" value={`${totals.calls} calls · ${money(totals.tokens * PRICE_PER_TOKEN)}`} width={12} sub={totals.calls ? `avg ${Math.round(totals.ms / totals.calls)} ms a call` : "—"} />
      <HudCell size="md" label="router" value={modeText} width={7} tone={modeTone} sub={routerP != null ? `${pct(routerP)} sure` : "one film, a set, or nothing?"} />
      <div className="flex basis-full flex-col justify-center">
        <Sparkline trace={trace} />
        <span className="mt-1.5 flex justify-between gap-3 text-[10px] uppercase tracking-wide text-[var(--muted)]">
          <span className="truncate">
            confidence, keystroke by keystroke
            {trace.length > 0 && trace[trace.length - 1].title && <span className="normal-case"> · {trace[trace.length - 1].title}</span>}
          </span>
          <span className="shrink-0 normal-case">{find?.model ?? "jev"}</span>
        </span>
      </div>
    </div>
  );
}

/** Recording-mode telemetry: big enough to read on a phone after X re-encodes the clip. */
function DemoHud({
  status,
  busy,
  find,
  mode,
  tokens,
  extraMs,
  totals,
  startedAt,
}: {
  status: Status;
  busy: boolean;
  find: FindResponse | null;
  mode: WallMode;
  tokens: number | null;
  extraMs: number;
  totals: Totals;
  startedAt: React.RefObject<number>;
}) {
  const running = status === "pending" || busy;
  // Stopwatch: counts while any request for this keystroke is in flight, then snaps to the real figure.
  const elapsed = useStopwatch(running, startedAt);

  const finalMs = find ? find.latencyMs + extraMs : null;
  const rt = running ? `${elapsed} ms` : finalMs != null ? `${finalMs} ms` : "—";
  const rtTone = running ? "text-[var(--warn)]" : finalMs != null ? "text-[var(--good)]" : "text-[var(--muted)]";
  const routerP = find ? find.router[mode === "finder" ? "specific" : mode === "set" ? "set" : "nothing"] : null;
  const modeText = mode === "idle" ? "—" : `${mode}${routerP != null ? ` ${pct(routerP)}` : ""}`;
  const modeTone = mode === "finder" ? "text-[var(--accent)]" : mode === "set" ? "text-[var(--accent-2)]" : "text-[var(--muted)]";

  return (
    <div className="mono flex items-stretch gap-6 rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-7 py-4">
      <HudCell label="round trip" value={rt} width={8.5} tone={rtTone} pulse={running} />
      <HudCell label="tokens" value={tokens ? tokens.toLocaleString() : "—"} width={7} />
      <HudCell label="this keystroke" value={tokens ? money(tokens * PRICE_PER_TOKEN) : "—"} width={6} />
      <HudCell label="total" value={`${totals.calls} calls · ${money(totals.tokens * PRICE_PER_TOKEN)}`} width={17} />
      <HudCell label="mode" value={modeText} width={11} tone={modeTone} />
      <div className="ml-auto flex flex-col items-end justify-center whitespace-nowrap text-sm text-[var(--muted)]">
        <span className="text-[var(--text)]">{find?.model ?? "jev"}</span>
        <span>{MOVIES.length} films per call</span>
      </div>
    </div>
  );
}
