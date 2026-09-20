"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CANDIDATES, STATIONS, STATION_BY_ID, type MeetLocateResponse, type Origin } from "@/lib/stations";
import { shortName } from "@/lib/use-tube-graph";

export const MAX_ORIGINS = 5;
export const BUDGETS = [20, 30, 40, 45, 60] as const;

const norm = (s: string) => s.toLowerCase().replace(/[’'.]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const NAMES = STATIONS.map((s) => ({ id: s.id, n: norm(s.name), words: norm(s.name).split(" ") }));

/** Local fuzzy match on station names: prefix, then word start, then substring. Covers the outer stations locate mode cannot rank. */
export function matchStations(text: string, exclude: Set<string>, limit = 6): string[] {
  const q = norm(text);
  if (!q) return [];
  const scored = NAMES.filter((s) => !exclude.has(s.id))
    .map((s) => ({ id: s.id, score: s.n.startsWith(q) ? 3 : s.words.some((w) => w.startsWith(q)) ? 2 : s.n.includes(q) ? 1 : 0 }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || STATION_BY_ID[a.id].name.length - STATION_BY_ID[b.id].name.length);
  return scored.slice(0, limit).map((s) => s.id);
}

/**
 * Origin chips (2–5 people) with a station search. A name match is local and instant;
 * anything else ("near the Emirates", "tate modern") goes to Jev's locate question over
 * the candidate stations and the top answer is added if it is sure enough.
 */
export function OriginPicker({
  origins,
  onChange,
  budget,
  budgetStated,
  onBudget,
}: {
  origins: Origin[];
  onChange: (o: Origin[]) => void;
  budget: number;
  /** The budget came from the typed description; the control shows it but a manual change overrides. */
  budgetStated: boolean;
  onBudget: (b: number | null) => void;
}) {
  const [text, setText] = useState("");
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const have = useMemo(() => new Set(origins.map((o) => o.id)), [origins]);
  const matches = useMemo(() => matchStations(text, have), [text, have]);
  const full = origins.length >= MAX_ORIGINS;

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);

  const add = (id: string, label?: string) => {
    if (have.has(id) || full) return;
    onChange([...origins, label ? { id, label } : { id }]);
    setText("");
  };
  const remove = (id: string) => onChange(origins.filter((o) => o.id !== id));

  const locate = async () => {
    const q = text.trim();
    if (!q || locating) return;
    setLocating(true);
    try {
      const res = await fetch("/api/meet/find", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q, kind: "locate" }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MeetLocateResponse;
      if (data.exists < 0.5 || (data.probabilities[data.top] ?? 0) < 0.25) {
        setNote(`couldn't place "${q}"`);
        return;
      }
      add(data.top, q);
      setNote(`"${q}" → ${STATION_BY_ID[data.top]?.name}`);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setLocating(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (matches.length) add(matches[0]);
      else void locate();
    } else if (e.key === "Backspace" && !text && origins.length) {
      remove(origins[origins.length - 1].id);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
      <AnimatePresence initial={false}>
        {origins.map((o, i) => {
          const s = STATION_BY_ID[o.id];
          return (
            <motion.button
              key={o.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => remove(o.id)}
              title={o.label ? `${o.label} → ${s.name} · remove` : "remove"}
              className="group flex items-center gap-1.5 rounded-full border border-[var(--accent-2)]/40 bg-[var(--accent-2)]/10 py-0.5 pl-1.5 pr-2 text-xs text-[var(--text)] sm:py-1 sm:pl-2 sm:pr-2.5 sm:text-sm"
            >
              <span className="mono grid h-5 w-5 place-items-center rounded-full bg-[var(--accent-2)] text-[11px] font-bold text-[var(--on-accent)]">{i + 1}</span>
              <span className="sm:hidden">{shortName(o.label ?? s.name)}</span>
              <span className="hidden sm:inline">{o.label ?? s.name}</span>
              <span className="text-[var(--muted)] group-hover:text-[var(--hot)]">×</span>
            </motion.button>
          );
        })}
      </AnimatePresence>
      {!full && (
        <div className="relative min-w-[9rem] flex-1">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={origins.length ? "add someone's station…" : "who's coming? type a station or a place…"}
            className="w-full rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-sm outline-none sm:py-1.5 placeholder:text-[var(--placeholder)] focus:border-[var(--accent-2)]"
            aria-label="Add an origin station"
          />
          {text && (
            <div className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] text-sm shadow-xl">
              {matches.map((id, i) => (
                <button key={id} onClick={() => add(id)} className={`flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--panel-2)] ${i === 0 ? "text-[var(--text)]" : "text-[var(--muted)]"}`}>
                  <span>{STATION_BY_ID[id].name}</span>
                  <span className="mono text-[10px] uppercase text-[var(--muted)]">
                    {STATION_BY_ID[id].candidate ? "" : "outer · "}zone {STATION_BY_ID[id].zone}
                  </span>
                </button>
              ))}
              {!matches.length && (
                <button onClick={() => void locate()} disabled={locating} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--muted)] hover:bg-[var(--panel-2)]">
                  {locating && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--warn)]" />}
                  {locating ? "asking jev which station is nearest…" : `no station called that · ask jev where "${text}" is`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
      <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--muted)]">
        <span className="hidden sm:inline">{budgetStated ? "text says" : "everyone within"}</span>
        <select
          value={budget}
          onChange={(e) => onBudget(Number(e.target.value))}
          className={`mono rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-xs ${budgetStated ? "text-[var(--accent-2)]" : "text-[var(--text)]"}`}
          aria-label="Travel budget in minutes"
        >
          {[...new Set([...BUDGETS, budget])].sort((a, b) => a - b).map((b) => (
            <option key={b} value={b}>
              {b} min
            </option>
          ))}
        </select>
      </label>
      <span className="sr-only">{CANDIDATES.length} stations can be ranked</span>
    </div>
  );
}
