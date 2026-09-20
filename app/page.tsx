"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate, motion } from "framer-motion";
import {
  INTENT_OPTIONS,
  JUDGMENT_COUNT,
  TONE_LABELS,
  type IntentOption,
  type JudgeResponse,
  type Judgment,
} from "@/lib/questions";

const SPRING = { type: "spring", stiffness: 170, damping: 24, mass: 0.6 } as const;
const DEBOUNCE_MS = 300;

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "Sarcastic praise",
    text: "Wow, great job shipping an update that deleted my whole dashboard. Really love what you've done here.",
  },
  {
    label: 'Delete the word "not"',
    text: "I'm not cancelling my subscription, I just want to know how to change the billing email.",
  },
  {
    label: "Genuinely on the fence",
    text: "Is there any way to get a refund for last month? Not a huge deal either way.",
  },
  {
    label: "Genuine praise",
    text: "Honestly the new editor is fantastic. Thank you for building it, it saved me an hour today.",
  },
  {
    label: "Last straw",
    text: "THIS IS THE THIRD TIME. Fix it by tonight or I'm moving my whole team to a competitor.",
  },
];

const INTENT_ORDER = Object.keys(INTENT_OPTIONS) as IntentOption[];

const EMPTY: Judgment = {
  intent: {
    choice: "other",
    confidence: 0,
    probabilities: { question: 0, complaint: 0, praise: 0, request: 0, other: 0 },
  },
  tone: { score: 0, confidence: 0, probabilities: [0, 0, 0, 0, 0] },
  needsHuman: 0,
  sarcasm: 0,
  churnRisk: 0,
};

type Status = "idle" | "pending" | "ready" | "error";

export default function Page() {
  const [text, setText] = useState("");
  const [judgment, setJudgment] = useState<Judgment>(EMPTY);
  const [status, setStatus] = useState<Status>("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  // Optional deep link: /?q=some+text prefills the box (handy for recording).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setText(q);
  }, []);

  useEffect(() => {
    // Anything in flight belongs to older text: cancel it immediately.
    abortRef.current?.abort();
    const seq = ++seqRef.current;

    if (text.trim().length === 0) {
      setJudgment(EMPTY);
      setStatus("idle");
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("pending");
      setError(null);
      try {
        const res = await fetch("/api/judge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (seq !== seqRef.current) return; // superseded while waiting
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as JudgeResponse;
        if (seq !== seqRef.current) return;
        setJudgment(data.judgment);
        setLatency(data.latencyMs);
        setModel(data.model);
        setCalls((c) => c + 1);
        setStatus("ready");
      } catch (err) {
        if ((err as Error).name === "AbortError" || seq !== seqRef.current) return;
        setError((err as Error).message);
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [text]);

  const pick = useCallback((t: string) => setText(t), []);

  const live = status === "ready" || status === "pending";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-5 py-8 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="text-[var(--accent)]">Jev</span> Live
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Type anything. Jev returns {JUDGMENT_COUNT} typed judgments per keystroke, with probabilities, not prose.
          </p>
        </div>
        <StatsChip status={status} latency={latency} model={model} calls={calls} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Input column */}
        <section className="flex flex-col gap-4">
          <div className="relative rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-1 shadow-[0_0_0_1px_rgba(124,140,255,0.05),0_20px_60px_-30px_rgba(124,140,255,0.35)]">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Say something to your support team…"
              spellCheck={false}
              className="h-56 w-full rounded-xl bg-transparent px-5 py-4 text-xl leading-relaxed outline-none md:h-72 md:text-2xl"
              autoFocus
            />
            <div className="flex items-center justify-between px-4 pb-3 text-xs text-[var(--muted)]">
              <span className="mono">{text.length} chars</span>
              <StatusDot status={status} />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-[var(--hot)]/40 bg-[var(--hot)]/10 px-4 py-2 text-sm text-[var(--hot)]">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider text-[var(--muted)]">Try one</span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => pick(ex.text)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                    text === ex.text
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                      : "border-[var(--line)] bg-[var(--panel)] text-[var(--text)] hover:border-[var(--accent)]/60"
                  }`}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Results column */}
        <section className={`flex flex-col gap-4 transition-opacity duration-300 ${live ? "opacity-100" : "opacity-60"}`}>
          <Panel title="Intent" hint="choice · one of five" confidence={judgment.intent.confidence}>
            <div className="flex flex-col gap-2.5">
              {INTENT_ORDER.map((opt) => (
                <ProbBar
                  key={opt}
                  label={opt}
                  value={judgment.intent.probabilities[opt]}
                  winner={live && judgment.intent.choice === opt}
                />
              ))}
            </div>
          </Panel>

          <Panel title="Tone" hint="score · calm → furious" confidence={judgment.tone.confidence}>
            <ToneMeter probabilities={judgment.tone.probabilities} score={judgment.tone.score} live={live} />
          </Panel>

          <div className="grid grid-cols-3 gap-4">
            <Dial label="Needs a human" value={judgment.needsHuman} color="var(--accent-2)" />
            <Dial label="Sarcasm" value={judgment.sarcasm} color="var(--warn)" />
            <Dial label="Churn risk" value={judgment.churnRisk} color="var(--hot)" />
          </div>
        </section>
      </div>
    </main>
  );
}

/* ---------- Pieces ---------- */

function Panel({
  title,
  hint,
  confidence,
  children,
}: {
  title: string;
  hint: string;
  confidence: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
          <span className="text-xs text-[var(--muted)]">{hint}</span>
        </div>
        <span className="mono text-xs text-[var(--muted)]">
          conf <AnimatedNumber value={confidence} format={(v) => v.toFixed(2)} />
        </span>
      </div>
      {children}
    </div>
  );
}

function ProbBar({ label, value, winner }: { label: string; value: number; winner: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-20 shrink-0 text-sm capitalize ${winner ? "text-white" : "text-[var(--muted)]"}`}>
        {label}
      </span>
      <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-[var(--panel-2)]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-md"
          style={{
            background: winner
              ? "linear-gradient(90deg, var(--accent), #a5b1ff)"
              : "linear-gradient(90deg, #3b4266, #4a5280)",
          }}
          initial={false}
          animate={{ width: `${Math.max(value * 100, 0.5)}%` }}
          transition={SPRING}
        />
      </div>
      <span className={`mono w-12 shrink-0 text-right text-sm ${winner ? "text-white" : "text-[var(--muted)]"}`}>
        <AnimatedNumber value={value} format={(v) => `${Math.round(v * 100)}%`} />
      </span>
    </div>
  );
}

const TONE_COLORS = ["#4fd1c5", "#7cc6a4", "#f5b942", "#ff8c42", "#ff5f6d"];

function ToneMeter({ probabilities, score, live }: { probabilities: number[]; score: number; live: boolean }) {
  const pct = (score / (TONE_LABELS.length - 1)) * 100;
  return (
    <div className="flex flex-col gap-3">
      {/* probability spread: one column per level */}
      <div className="flex h-24 items-end gap-2">
        {probabilities.map((p, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            <div className="relative flex h-full flex-col justify-end overflow-hidden rounded-md bg-[var(--panel-2)]">
              <motion.div
                className="w-full rounded-md"
                style={{ background: TONE_COLORS[i] }}
                initial={false}
                animate={{ height: `${Math.max(p * 100, 1.5)}%`, opacity: 0.35 + p * 0.65 }}
                transition={SPRING}
              />
            </div>
          </div>
        ))}
      </div>
      {/* gradient track + expected-score marker */}
      <div className="relative">
        <div
          className="h-2.5 rounded-full"
          style={{ background: `linear-gradient(90deg, ${TONE_COLORS.join(", ")})` }}
        />
        <motion.div
          className="absolute -top-1.5 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-[var(--bg)] shadow-[0_0_0_4px_rgba(0,0,0,0.5)]"
          initial={false}
          animate={{ left: `${pct}%`, opacity: live ? 1 : 0 }}
          transition={SPRING}
        />
      </div>
      <div className="flex justify-between">
        {TONE_LABELS.map((l, i) => (
          <span key={l} className="flex-1 text-center text-xs text-[var(--muted)]">
            <span className="block">{l}</span>
            <span className="mono block">
              <AnimatedNumber value={probabilities[i]} format={(v) => `${Math.round(v * 100)}%`} />
            </span>
          </span>
        ))}
      </div>
      <div className="mono text-right text-xs text-[var(--muted)]">
        score <AnimatedNumber value={score} format={(v) => v.toFixed(2)} /> / {TONE_LABELS.length - 1}
      </div>
    </div>
  );
}

function Dial({ label, value, color }: { label: string; value: number; color: string }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const ARC = 0.75; // 270° sweep
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 110 110" className="h-full w-full rotate-[135deg]">
          <circle
            cx="55"
            cy="55"
            r={R}
            fill="none"
            stroke="var(--panel-2)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${C * ARC} ${C}`}
          />
          <motion.circle
            cx="55"
            cy="55"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${C * ARC} ${C}`}
            initial={false}
            animate={{ strokeDashoffset: C * ARC * (1 - value) }}
            transition={SPRING}
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="mono text-2xl font-semibold">
            <AnimatedNumber value={value} format={(v) => `${Math.round(v * 100)}%`} />
          </span>
        </div>
      </div>
      <span className="text-sm text-[var(--muted)]">{label}</span>
    </div>
  );
}

function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const [display, setDisplay] = useState(() => format(value));
  const current = useRef(value);
  const formatRef = useRef(format);
  formatRef.current = format;
  useEffect(() => {
    const controls = animate(current.current, value, {
      ...SPRING,
      onUpdate: (v) => {
        current.current = v;
        setDisplay(formatRef.current(v));
      },
    });
    return () => controls.stop();
  }, [value]);
  return <>{display}</>;
}

function StatusDot({ status }: { status: Status }) {
  const map: Record<Status, { c: string; t: string }> = {
    idle: { c: "bg-[var(--muted)]", t: "waiting for input" },
    pending: { c: "bg-[var(--warn)] animate-pulse", t: "judging…" },
    ready: { c: "bg-[var(--good)]", t: "live" },
    error: { c: "bg-[var(--hot)]", t: "error" },
  };
  return (
    <span className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${map[status].c}`} />
      {map[status].t}
    </span>
  );
}

function StatsChip({
  status,
  latency,
  model,
  calls,
}: {
  status: Status;
  latency: number | null;
  model: string | null;
  calls: number;
}) {
  return (
    <div className="mono flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-sm">
      <Stat label="round trip">
        {latency === null ? "—" : <AnimatedNumber value={latency} format={(v) => `${Math.round(v)} ms`} />}
      </Stat>
      <Divider />
      <Stat label="judgments / req">{JUDGMENT_COUNT}</Stat>
      <Divider />
      <Stat label="calls">{calls}</Stat>
      <Divider />
      <Stat label="model">{model ?? "jev"}</Stat>
      <span
        className={`ml-1 h-2 w-2 rounded-full ${
          status === "pending" ? "bg-[var(--warn)] animate-pulse" : status === "ready" ? "bg-[var(--good)]" : "bg-[var(--line)]"
        }`}
      />
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</span>
      <span className="text-base text-white">{children}</span>
    </span>
  );
}

function Divider() {
  return <span className="h-7 w-px bg-[var(--line)]" />;
}
