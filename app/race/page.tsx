"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MOVIES, MOVIE_BY_ID } from "@/lib/movies";
import { EXISTS_FLOOR, useFind } from "@/lib/use-find";
import { useChatRace, type ChatLive } from "@/lib/use-chat-race";
import { CHAT_MODEL } from "@/lib/chat-model";
import { readScriptParams, runScript, typeWords, type Step } from "@/lib/script";
import { useSpeech } from "@/lib/use-speech";
import { HudCell, ListeningBadge, MicButton, money, NotItButton, pct, Poster, PRICE_PER_TOKEN, SPRING, TurnPill, useStopwatch } from "@/app/grid/ui";
import { useTurns } from "@/lib/use-turns";

// The whole catalogue, so "258 films judged per call" is something you can see; the panel scrolls.
const WALL = MOVIES.length;
const COLS = 12;

const EXAMPLES = [
  "the one where the guy can't remember anything and has tattoos",
  "ripley fights the alien queen in a power loader",
  "kids hide from a shark. no wait, dinosaurs",
  "spinning top at the end",
  "the nolan one that isn't inception",
  "space horror but not alien",
];

// /race?demo=1&script=race: two phrases, then the closing card. Each phrase waits for the
// chat model to answer before the hold, so the clip shows both sides finishing.
const SCRIPTS: Record<string, Step[]> = {
  race: [
    { type: "type", text: "the one where the guy can't remember anything and has tattoos", hold: 3000 },
    { type: "clear", hold: 700 },
    { type: "type", text: "ripley fights the alien queen in a power loader", hold: 3000 },
    { type: "endcard", hold: 5000 },
    { type: "wait", ms: 400 },
  ],
  // The X cut: a mid-sentence pivot (Jaws ruled out, Jurassic Park in, while the chat model is
  // still starting over), then a negation that becomes a set, then the card.
  "race-final": [
    { type: "type", text: "kids hide from a shark. no wait, dinosaurs", hold: 3200 },
    { type: "clear", hold: 700 },
    { type: "type", text: "space horror but not alien", hold: 3500 },
    { type: "endcard", hold: 5500 },
    { type: "wait", ms: 400 },
  ],
  "race-voice": [
    { type: "say", text: "ripley fights the alien queen in a power loader", hold: 3000 },
    { type: "endcard", hold: 5000 },
    { type: "wait", ms: 400 },
  ],
};

/** One typed phrase: when it started and when each side first answered, for the closing card. */
type Phrase = { startedAt: number; jevFirstMs: number | null; chatFirstMs: number | null };
type Params = { demo: boolean; script: string | null; delay: number };

export default function RacePage() {
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [params, setParams] = useState<Params>({ demo: false, script: null, delay: 2000 });
  const [scriptRunning, setScriptRunning] = useState(false);
  const [endcard, setEndcard] = useState(false);
  const [listening, setListening] = useState(false);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [jevAnswers, setJevAnswers] = useState(0);

  const speechListeningRef = useRef(false);
  const turns = useTurns();
  const jev = useFind(query, { previous: turns.previous, earlier: turns.earlier, overlap: listening || speechListeningRef.current });
  /** Enter / "not it" / the `commit` script step: assigned every render so it sees the current lock. */
  const commitRef = useRef<() => void>(() => {});
  // The chat model gets each committed turn as history: the typed text, and the answer as it would have written it.
  const chatTurns = useMemo(() => turns.turns.filter((t) => t.answer).map((t) => ({ query: t.query, answer: `${t.answer!.title} (${t.answer!.year})` })), [turns.turns]);
  const chat = useChatRace(query, { turns: chatTurns });
  const { find, fits, inspect, status, fitsPending, inspectPending, totals, startedAtRef, settled } = jev;

  const inputRef = useRef<HTMLInputElement>(null);
  const scriptAbortRef = useRef(false);
  const typeGen = useRef(0);
  const chatSettledRef = useRef(chat.settled);
  chatSettledRef.current = chat.settled;

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
    setParams(readScriptParams());
  }, []);

  // A phrase starts when the box goes from empty to something.
  const prevQueryRef = useRef("");
  useEffect(() => {
    if (prevQueryRef.current.trim() === "" && query.trim() !== "") setPhrases((p) => [...p, { startedAt: performance.now(), jevFirstMs: null, chatFirstMs: null }]);
    prevQueryRef.current = query;
  }, [query]);
  useEffect(() => {
    if (!find) return;
    setJevAnswers((n) => n + 1);
    setPhrases((p) => (p.length && p[p.length - 1].jevFirstMs === null ? [...p.slice(0, -1), { ...p[p.length - 1], jevFirstMs: Math.round(performance.now() - p[p.length - 1].startedAt) }] : p));
  }, [find]);
  useEffect(() => {
    if (!chat.answered) return;
    setPhrases((p) => (p.length && p[p.length - 1].chatFirstMs === null ? [...p.slice(0, -1), { ...p[p.length - 1], chatFirstMs: Math.round(performance.now() - p[p.length - 1].startedAt) }] : p));
  }, [chat.answered]);

  const speech = useSpeech({
    onTranscript: (text) => {
      typeGen.current += 1;
      setTyping(false);
      setQuery(text);
    },
  });
  speechListeningRef.current = speech.listening;

  const typeOut = async (text: string) => {
    const gen = ++typeGen.current;
    await typeWords(text, { setQuery, setTyping, settled, aborted: () => gen !== typeGen.current });
    if (gen === typeGen.current) inputRef.current?.focus();
  };

  useEffect(() => {
    const steps = params.script ? SCRIPTS[params.script] : null;
    if (!steps) return;
    scriptAbortRef.current = false;
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
        phraseSettled: () => chatSettledRef.current(),
        aborted: () => scriptAbortRef.current,
        delay: params.delay,
        hooks: { endcard: async () => setEndcard(true), commit: async () => commitRef.current() },
      });
      setScriptRunning(false);
    })();
    return () => {
      window.removeEventListener("keydown", onKey);
      scriptAbortRef.current = true;
    };
  }, [params.script, params.delay, settled]);

  // Same ranking rules as /grid, trimmed to what the race shows.
  const mode = find?.mode ?? "idle";
  const exists = find?.exists ?? 0;
  const probs = useMemo(() => {
    if (!find) return null;
    if (mode !== "finder" || !inspect) return find.probabilities;
    const mass = inspect.ids.reduce((s, id) => s + (find.probabilities[id] ?? 0), 0);
    const out = { ...find.probabilities };
    for (const id of inspect.ids) out[id] = (inspect.probabilities[id] ?? 0) * mass;
    return out;
  }, [find, inspect, mode]);
  const finding = mode === "finder" && !!probs && exists >= EXISTS_FLOOR;
  const emphasis = Math.min(1, Math.max(0, (exists - EXISTS_FLOOR) / 0.5));
  const lit = (id: string) => !!fits && (fits.fits[id] ?? 0) >= fits.threshold;
  const ranked = useMemo(() => {
    const list = [...MOVIES];
    if (finding && probs) return list.sort((a, b) => (probs[b.id] ?? 0) - (probs[a.id] ?? 0));
    if (mode === "set" && fits) return list.sort((a, b) => (fits.fits[b.id] ?? 0) - (fits.fits[a.id] ?? 0));
    return list;
  }, [finding, probs, mode, fits]);
  const max = probs ? Math.max(...MOVIES.map((m) => probs[m.id] ?? 0), 1e-6) : 0;
  const top = finding ? ranked[0] : null;
  const topP = top && probs ? probs[top.id] ?? 0 : 0;
  const locked = !!top && exists >= 0.5 && topP >= 0.35 && !(inspect?.close ?? false);
  const lockedAnswer = locked && top ? { id: top.id, title: top.title, year: top.year, director: top.director } : null;
  commitRef.current = () => {
    typeGen.current += 1;
    setTyping(false);
    if (turns.commit(query, lockedAnswer)) setQuery("");
  };
  const excluded = find?.excluded ? MOVIE_BY_ID[find.excluded] : null;
  const busy = fitsPending || inspectPending;
  const demo = params.demo;

  const jevRunning = status === "pending";
  const jevElapsed = useStopwatch(jevRunning, startedAtRef);
  const jevMs = jevRunning ? `${jevElapsed} ms` : find ? `${find.latencyMs} ms` : "—";
  const jevTone = jevRunning ? "text-[var(--warn)]" : find ? "text-[var(--good)]" : "text-[var(--muted)]";
  const jevCost = totals.tokens * PRICE_PER_TOKEN;
  const size = demo ? "lg" : "md";

  return (
    <main className={`mx-auto flex h-screen w-full max-w-[1560px] flex-col gap-4 overflow-hidden px-8 ${demo ? "py-6" : "py-5"}`}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-[var(--accent)]">Jev</span> vs {CHAT_MODEL.label}
          </h1>
          {!demo && (
            <p className="mt-1 text-sm text-[var(--muted)]">
              Same description, same {MOVIES.length} films, every keystroke to both.{" "}
              <a href="/grid" className="text-[var(--accent)] hover:underline">
                The full wall →
              </a>
            </p>
          )}
        </div>
        {!demo && (
          <div className="flex flex-wrap justify-end gap-2">
            {EXAMPLES.map((t) => (
              <button key={t} onClick={() => typeOut(t)} className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)]">
                {t}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            typeGen.current += 1;
            setTyping(false);
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !scriptRunning) commitRef.current();
          }}
          placeholder="the one where…"
          spellCheck={false}
          autoFocus
          readOnly={scriptRunning}
          className="w-full rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-6 py-4 text-3xl outline-none transition placeholder:text-[#4b5064] focus:border-[var(--accent)]"
        />
        <span className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-3">
          <AnimatePresence>
            {turns.previous && (
              <TurnPill
                key={turns.previous.id}
                size="lg"
                answer={turns.previous}
                onReset={() => {
                  turns.reset();
                  inputRef.current?.focus();
                }}
              />
            )}
          </AnimatePresence>
          {(listening || speech.listening) && <ListeningBadge size="lg" />}
          {typing && !demo && !listening && <span className="pointer-events-none text-xs text-[var(--muted)]">typing…</span>}
          {!scriptRunning && !demo && (query.trim() !== "" || turns.previous) && (
            <NotItButton size="lg" disabled={!lockedAnswer && !turns.previous} onClick={() => commitRef.current()} />
          )}
          {!scriptRunning && (
            <MicButton
              size="lg"
              listening={speech.listening}
              supported={speech.supported}
              onToggle={() => {
                if (speech.listening) speech.stop();
                else {
                  typeGen.current += 1;
                  setTyping(false);
                  setQuery("");
                  speech.start();
                }
              }}
            />
          )}
        </span>
      </div>

      <div className="relative grid min-h-0 flex-1 grid-cols-2 gap-5">
        {/* Jev */}
        <section className="flex min-h-0 flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
          <ColumnHead name="Jev" tone="text-[var(--accent)]" detail={`System One · ${MOVIES.length} films judged per call · probabilities, not prose`} />
          <div className="mono flex flex-wrap items-stretch gap-x-6 gap-y-2">
            <HudCell size={size} label="this keystroke" value={jevMs} width={demo ? 7.5 : 6.5} tone={jevTone} pulse={jevRunning} sub={busy ? "second look…" : find ? `${find.candidates} films read` : "per keystroke"} />
            <HudCell size={size} label="answers" value={String(jevAnswers)} width={3} sub="one per keystroke" />
            <HudCell size={size} label="cost so far" value={money(jevCost)} width={5} sub={`${totals.calls} calls · list price, no caching`} />
          </div>
          <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pr-1" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridAutoRows: "min-content" }}>
            {ranked.slice(0, WALL).map((m, i) => {
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
                if (i < 6 && p >= 0.02) label = pct(p);
              } else if (mode === "set" && fits) {
                if (lit(m.id)) {
                  ring = "0 0 0 2px var(--accent-2)";
                  if (i < 6) label = pct(fits.fits[m.id] ?? 0);
                } else {
                  opacity = 0.3;
                  saturate = 0.4;
                }
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
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity, scale: 1 }}
                  className="relative aspect-[2/3] overflow-hidden rounded-lg bg-[var(--panel-2)]"
                  style={{ filter: `saturate(${saturate})`, boxShadow: ring, zIndex: i === 0 && finding ? 2 : undefined }}
                >
                  <Poster m={m} />
                  {label && <span className="mono absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 py-0.5 text-[11px] text-white">{label}</span>}
                  {isExcluded && (
                    <span className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-[var(--hot)]" aria-label="ruled out">
                      ✕
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* The chat model */}
        <ChatPanel chat={chat} size={size} jevTop={locked && top ? top.title : null} />

        <AnimatePresence>
          {endcard && <EndCard phrases={phrases} jevAnswers={jevAnswers} jevCost={jevCost} chat={chat} />}
        </AnimatePresence>
      </div>
    </main>
  );
}

function ColumnHead({ name, tone, detail }: { name: string; tone: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-xl font-semibold ${tone}`}>{name}</span>
      <span className="truncate text-xs text-[var(--muted)]">{detail}</span>
    </div>
  );
}

/** Titles as the chat model would write them, for checking its answer against the catalogue. */
const TITLE_SET = new Set(MOVIES.map((m) => m.title.toLowerCase()));

/**
 * What the chat model's finished line names, checked against the catalogue and Jev's pick.
 * A chat model can name any film it knows; Jev's answer is a distribution over the 258, so
 * the honest disagreement to show is "that film is not one of the options".
 */
function verdictFor(text: string, jevTop: string | null): { label: string; tone: "good" | "warn" | "hot" } | null {
  const m = /^\s*\*{0,2}(.+?)\*{0,2}\s*\((\d{4})\)/.exec(text);
  if (!m) return null;
  const title = m[1].trim();
  if (!TITLE_SET.has(title.toLowerCase())) return { label: `“${title}” is not one of the ${MOVIES.length}`, tone: "hot" };
  if (jevTop && title.toLowerCase() === jevTop.toLowerCase()) return { label: "same film as Jev", tone: "good" };
  if (jevTop) return { label: `Jev says ${jevTop}`, tone: "warn" };
  return null;
}

function ChatPanel({ chat, size, jevTop }: { chat: ChatLive; size: "lg" | "md"; jevTop: string | null }) {
  const running = chat.phase === "waiting" || chat.phase === "streaming";
  const verdict = chat.phase === "answered" ? verdictFor(chat.text, jevTop) : null;
  const elapsed = useStopwatch(running, chat.startedAtRef);
  const lastAnswered = [...chat.history].reverse().find((a) => a.outcome === "answered");
  const ms = running ? `${elapsed} ms` : chat.phase === "answered" && lastAnswered ? `${lastAnswered.ms} ms` : "—";
  const tone = running ? "text-[var(--warn)]" : chat.phase === "answered" ? "text-[var(--good)]" : chat.phase === "error" ? "text-[var(--hot)]" : "text-[var(--muted)]";
  const abandoned = chat.history.filter((a) => a.outcome === "abandoned").slice(-4);
  const attemptCost = chat.cost ?? (running ? null : null);

  return (
    <section className="flex min-h-0 flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <ColumnHead name={CHAT_MODEL.label} tone="text-[var(--warn)]" detail={`the same ${MOVIES.length} films in its prompt · restarted on every keystroke`} />
      <div className="mono flex flex-wrap items-stretch gap-x-6 gap-y-2">
        <HudCell
          size={size}
          label="this attempt"
          value={ms}
          width={size === "lg" ? 7.5 : 6.5}
          tone={tone}
          pulse={running}
          sub={chat.phase === "waiting" ? "waiting for the first token…" : chat.phase === "streaming" ? "writing…" : chat.phase === "answered" ? `first token at ${chat.firstTokenMs ?? "?"} ms` : "per attempt"}
        />
        <HudCell size={size} label="answers" value={String(chat.answered)} width={3} sub={chat.attempt ? `${chat.abandoned} of ${chat.attempt} attempts abandoned` : "—"} />
        <HudCell
          size={size}
          label="cost so far"
          value={money(chat.sessionCost)}
          width={5}
          sub={chat.sessionCost ? `as billed, with prompt caching · ${money(chat.sessionUncached)} at list price` : attemptCost ? "" : "—"}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-[var(--panel-2)] p-5">
        {chat.phase === "idle" && <p className="text-lg text-[var(--muted)]">Waiting for a description.</p>}
        {chat.phase === "waiting" && (
          <p className="text-lg text-[var(--warn)]">
            <span className="animate-pulse">re-reading {MOVIES.length} films…</span>
          </p>
        )}
        {/* A finished answer stays visible while the next keystroke makes it start over: it had it, and is now re-reading everything. */}
        {chat.phase === "waiting" && lastAnswered?.text && (
          <p className={`${size === "lg" ? "text-3xl" : "text-2xl"} mt-2 leading-snug text-[var(--muted)] opacity-60`}>
            {lastAnswered.text}
            <span className="mono ml-3 align-middle text-xs">
              attempt {lastAnswered.n} · “{lastAnswered.query}” · starting over
            </span>
          </p>
        )}
        {chat.phase === "error" && <p className="text-lg text-[var(--hot)]">{chat.error}</p>}
        {(chat.phase === "streaming" || chat.phase === "answered") && (
          <p className={`${size === "lg" ? "text-3xl" : "text-2xl"} leading-snug`}>
            {chat.text}
            {chat.phase === "streaming" && <span className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.15em] animate-pulse bg-[var(--warn)]" />}
          </p>
        )}
        <AnimatePresence>
          {verdict && (
            <motion.p
              key={verdict.label}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mono mt-4 inline-block rounded-full px-3 py-1 ${size === "lg" ? "text-base" : "text-sm"} ${
                verdict.tone === "hot" ? "bg-[var(--hot)]/15 text-[var(--hot)]" : verdict.tone === "good" ? "bg-[var(--good)]/15 text-[var(--good)]" : "bg-[var(--warn)]/15 text-[var(--warn)]"
              }`}
            >
              {verdict.label}
            </motion.p>
          )}
        </AnimatePresence>
        {abandoned.length > 0 && (
          <ul className="absolute inset-x-5 bottom-4 flex flex-col gap-1 text-xs text-[var(--muted)]">
            <AnimatePresence initial={false}>
              {abandoned.map((a) => (
                <motion.li key={a.n} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 0.7, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mono truncate">
                  <span className="line-through">
                    attempt {a.n} · “{a.query}”
                  </span>{" "}
                  · abandoned after {a.ms} ms{a.text ? ` with “${a.text.slice(0, 40)}…”` : ""}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

function EndCard({ phrases, jevAnswers, jevCost, chat }: { phrases: Phrase[]; jevAnswers: number; jevCost: number; chat: ChatLive }) {
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const jevFirst = avg(phrases.map((p) => p.jevFirstMs));
  const chatFirst = avg(phrases.map((p) => p.chatFirstMs));
  const rows: [string, string, string][] = [
    ["answers given", `${jevAnswers}`, `${chat.answered} of ${chat.attempt} attempts`],
    ["first answer after", jevFirst !== null ? `${jevFirst} ms` : "—", chatFirst !== null ? `${(chatFirst / 1000).toFixed(1)} s` : "never"],
    ["cost", money(jevCost), `${money(chat.sessionCost)} billed · ${money(chat.sessionUncached)} list`],
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[var(--bg)]/85 backdrop-blur-sm"
    >
      <motion.div initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} transition={SPRING} className="mono w-[min(900px,90%)] rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-8">
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-6 gap-y-5 text-right">
          <span />
          <span className="text-lg text-[var(--accent)]">Jev</span>
          <span className="text-lg text-[var(--warn)]">{CHAT_MODEL.label}</span>
          {rows.map(([label, a, b]) => (
            <RowCells key={label} label={label} a={a} b={b} />
          ))}
        </div>
        <p className="mt-6 text-right text-xs text-[var(--muted)]">
          Same {MOVIES.length} films, same keystrokes. {CHAT_MODEL.label} was restarted on every keystroke, like Jev; it only finishes when the typing stops.
        </p>
      </motion.div>
    </motion.div>
  );
}

function RowCells({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <>
      <span className="self-center text-left text-sm uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <span className="text-4xl font-semibold text-[var(--text)]">{a}</span>
      <span className="text-4xl font-semibold text-[var(--text)]">{b}</span>
    </>
  );
}
