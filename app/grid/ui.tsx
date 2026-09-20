"use client";

import { useEffect, useState, type RefObject } from "react";
import { motion } from "framer-motion";
import type { Movie } from "@/lib/movies";
import { TRACE_MAX, type Previous, type TracePoint } from "@/lib/use-find";

export const SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.8 } as const;
export const PRICE_PER_TOKEN = 0.042e-6;
/** A page of prose is ~500 words; tokens read are shown as pages so the number has a size. */
export const TOKENS_PER_PAGE = 650;
/** What the same input tokens cost through a frontier chat model (input rate only, no output). Update when list prices move. */
export const CHAT_PRICE_PER_TOKEN = 1.25e-6;

export function pct(p: number) {
  return p >= 0.1 ? `${Math.round(p * 100)}%` : `${(p * 100).toFixed(1)}%`;
}

/** Cents until a dollar: "$0.0009" reads as free on video, "0.09¢" reads as a number. */
export function money(usd: number) {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  const cents = usd * 100;
  if (cents >= 1) return `${cents.toFixed(1)}¢`;
  return `${cents.toFixed(2)}¢`;
}

/** Counts up while a keystroke's requests are in flight; the caller snaps to the real figure after. */
export function useStopwatch(running: boolean, startedAt: RefObject<number>) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      setElapsed(Math.round(performance.now() - startedAt.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, startedAt]);
  return elapsed;
}

export function Poster({ m }: { m: Movie }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.poster} alt={`${m.title} (${m.year})`} width={m.w} height={m.h} loading="lazy" draggable={false} className="block h-full w-full object-cover" />
  );
}

export function Pill({ tone, children }: { tone: "good" | "hot" | "accent-2"; children: React.ReactNode }) {
  const cls = tone === "good" ? "bg-[var(--good)]/15 text-[var(--good)]" : tone === "hot" ? "bg-[var(--hot)]/15 text-[var(--hot)]" : "bg-[var(--accent-2)]/15 text-[var(--accent-2)]";
  return (
    <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className={`max-w-[200px] truncate rounded-full px-2 py-0.5 normal-case ${cls}`}>
      {children}
    </motion.span>
  );
}

export function HudCell({
  label,
  value,
  width,
  tone = "text-[var(--text)]",
  pulse = false,
  size = "lg",
  sub,
}: {
  label: string;
  value: string;
  width: number;
  tone?: string;
  pulse?: boolean;
  /** lg is the recording strip (readable on a phone), md the full page. */
  size?: "lg" | "md";
  /** One line under the label that gives the number its frame ("≈ 40 pages", "+120 ms second look"). */
  sub?: string;
}) {
  const lg = size === "lg";
  return (
    <div className="flex flex-col justify-center">
      {/* Width is fixed in ch of the value's own font size so the strip never reflows as digits change. */}
      <span className={`flex items-center gap-2 font-semibold leading-none ${lg ? "text-4xl" : "text-2xl"}`} style={{ minWidth: `${width}ch` }}>
        {pulse && <span className={`animate-pulse rounded-full bg-[var(--warn)] ${lg ? "h-2.5 w-2.5" : "h-2 w-2"}`} />}
        <motion.span key={pulse ? "live" : value} initial={{ scale: 1.12, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING} className={`inline-block origin-left ${tone}`}>
          {value}
        </motion.span>
      </span>
      <span className={`uppercase tracking-wide text-[var(--muted)] ${lg ? "mt-2 text-xs" : "mt-1.5 text-[10px]"}`}>{label}</span>
      {sub && <span className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{sub}</span>}
    </div>
  );
}

/** One bar per landed keystroke: the top film's share (or the router's vote for a set). A faint bar behind it is "does this describe anything at all?". */
export function Sparkline({ trace, height = 40 }: { trace: TracePoint[]; height?: number }) {
  const H = height;
  // Bars fill the width until there are a dozen, then pack; the first words of a description
  // are where the climb from flat to sure happens, so they need to stay wide enough to read.
  const slots = Math.min(TRACE_MAX, Math.max(12, trace.length));
  const w = 100 / slots;
  return (
    <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }} aria-label="confidence per keystroke">
      <line x1="0" y1={H - 0.5} x2="100" y2={H - 0.5} stroke="var(--line)" strokeWidth="0.5" />
      {trace.map((t, i) => {
        const x = (slots - trace.length + i) * w;
        const fill = t.mode === "finder" ? "var(--accent)" : t.mode === "set" ? "var(--accent-2)" : "var(--line)";
        const h = Math.max(1, t.p * (H - 2));
        const eh = Math.max(0.5, t.exists * (H - 2));
        return (
          <g key={i}>
            <title>{`"${t.q}" → ${t.title ?? t.mode} ${pct(t.p)} · describes something ${pct(t.exists)} · ${t.ms} ms`}</title>
            <rect x={x + w * 0.15} y={H - 1 - eh} width={w * 0.7} height={eh} fill="var(--text)" opacity="0.12" />
            <motion.rect x={x + w * 0.15} width={w * 0.7} fill={fill} initial={{ y: H - 1, height: 0 }} animate={{ y: H - 1 - h, height: h }} transition={SPRING} />
          </g>
        );
      })}
    </svg>
  );
}

/** Microphone toggle. Pulses while listening; explains itself when the browser can't do it. */
export function MicButton({ listening, supported, onToggle, size = "md" }: { listening: boolean; supported: boolean; onToggle: () => void; size?: "lg" | "md" }) {
  const lg = size === "lg";
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!supported}
      title={supported ? (listening ? "Stop listening" : "Describe it out loud") : "Speech input needs Chrome or Edge"}
      aria-pressed={listening}
      className={`flex shrink-0 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40 ${
        listening ? "border-[var(--hot)] bg-[var(--hot)]/15 text-[var(--hot)]" : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
      } ${lg ? "h-12 w-12" : "h-10 w-10"}`}
    >
      <svg viewBox="0 0 24 24" width={lg ? 22 : 18} height={lg ? 22 : 18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
    </button>
  );
}

/** "● listening" next to the input, big enough for a phone in the recording layout. */
export function ListeningBadge({ size = "md" }: { size?: "lg" | "md" }) {
  return (
    <span className={`mono flex items-center gap-2 text-[var(--hot)] ${size === "lg" ? "text-lg" : "text-xs"}`}>
      <span className={`animate-pulse rounded-full bg-[var(--hot)] ${size === "lg" ? "h-3 w-3" : "h-2 w-2"}`} />
      listening
    </span>
  );
}

/** The answer a follow-up is read against, pinned beside the input once a turn is committed. */
export function TurnPill({ answer, onReset, size = "md" }: { answer: Previous; onReset: () => void; size?: "lg" | "md" }) {
  const lg = size === "lg";
  return (
    <motion.span
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      className={`flex max-w-[360px] items-center gap-2 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)] ${lg ? "px-4 py-1.5 text-lg" : "px-3 py-1 text-sm"}`}
    >
      <span className="truncate">
        <span className="text-[var(--muted)]">after: </span>
        {answer.title} ({answer.year})
      </span>
      <button type="button" onClick={onReset} title="Forget the previous answer" className="shrink-0 text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)]">
        start over
      </button>
    </motion.span>
  );
}

/** Commits the current description as the turn the next one refers to; Enter does the same. */
export function NotItButton({ onClick, disabled, size = "md" }: { onClick: () => void; disabled?: boolean; size?: "lg" | "md" }) {
  const lg = size === "lg";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Keep this answer as context and describe what you meant (Enter)"
      className={`shrink-0 rounded-full border border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40 ${
        lg ? "h-12 px-4 text-lg" : "h-10 px-3 text-sm"
      }`}
    >
      not it ↵
    </button>
  );
}
