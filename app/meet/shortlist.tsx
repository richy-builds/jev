"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { SPRING } from "@/app/grid/ui";
import type { ShortlistRow } from "@/lib/meet-shortlist";
import { STATION_BY_ID } from "@/lib/stations";

/** What the dial is doing, in words, so the slider's position has a meaning without reading it. */
function priority(lambda: number): string {
  if (lambda < 0.4) return "prioritising equal times";
  if (lambda > 0.6) return "prioritising fastest total";
  return "balancing both";
}

const fmt = (m: number) => (Number.isFinite(m) ? String(Math.round(m)) : "—");

/**
 * The shortlist: the top three of the ranking under a fairness dial, each with
 * everyone's minutes, the spread, and the axis it wins. Hover (or a first tap on a
 * touch screen) previews the routes on the map; click (or the second tap) commits
 * through the same path as Enter, so TfL's verification, the veto and the re-pick
 * are unchanged. The committed pick's row is highlighted.
 */
export function Shortlist({
  rows,
  pick,
  previewed,
  lambda,
  onLambda,
  onPreview,
  onCommit,
  big = false,
  flat = false,
}: {
  rows: ShortlistRow[];
  pick: string | null;
  previewed: string | null;
  lambda: number;
  onLambda: (l: number) => void;
  onPreview: (id: string | null) => void;
  onCommit: (id: string) => void;
  big?: boolean;
  /** Inside the phone sheet: no panel chrome of its own, and the rows as one segmented line (name, minutes, why) so the venues stay in reach at the half state. */
  flat?: boolean;
}) {
  // Touch has no hover: the first tap previews, the second commits. Mouse and pen commit on click.
  const pointerType = useRef<string>("mouse");
  if (!rows.length) return null;
  const n = rows[0].mins.length;
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={SPRING}
      className={`pointer-events-auto flex flex-col ${flat ? "gap-1.5 text-sm" : `rounded-2xl border border-[var(--line)] bg-[var(--panel)]/95 shadow-2xl backdrop-blur ${big ? "gap-2 px-5 py-4 text-lg" : "gap-1.5 px-4 py-3 text-sm"}`}`}
      aria-label="Shortlist"
      onPointerLeave={() => onPreview(null)}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className={`font-semibold uppercase tracking-wider text-[var(--muted)] ${big ? "text-sm" : "text-[10px]"}`}>Shortlist</h2>
        {n > 1 && <span className={`text-[var(--muted)] ${big ? "text-sm" : "text-[11px]"}`}>{priority(lambda)}</span>}
      </header>
      {n > 1 && (
        <label className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[var(--muted)] ${big ? "text-sm" : "text-[10px]"}`}>
          <span>most equal</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(lambda * 100)}
            onChange={(e) => onLambda(Number(e.target.value) / 100)}
            aria-label="Trade most equal times against fastest total"
            className="w-full accent-[var(--accent)]"
          />
          <span>fastest total</span>
        </label>
      )}
      <ul className={flat ? "grid grid-cols-3 gap-1" : "flex flex-col gap-1"}>
        {rows.map((r, i) => {
          const s = STATION_BY_ID[r.id];
          if (!s) return null;
          const on = r.id === pick;
          const lit = on || r.id === previewed;
          const tone = on ? "border-[var(--good)] bg-[var(--good)]/10" : lit ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--line)] hover:border-[var(--muted)]";
          if (flat)
            return (
              <li key={r.id} className="min-w-0">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    pointerType.current = e.pointerType;
                  }}
                  onClick={() => {
                    if (pointerType.current === "touch" && previewed !== r.id) onPreview(r.id);
                    else onCommit(r.id);
                  }}
                  aria-pressed={on}
                  className={`flex w-full min-w-0 flex-col items-start rounded-lg border px-2 py-1.5 text-left transition-colors ${tone}`}
                >
                  <span className="line-clamp-2 w-full text-xs font-semibold leading-tight">
                    {i === 0 && <span className={`mr-1 text-[8px] font-bold uppercase tracking-wider ${on ? "text-[var(--good)]" : "text-[var(--accent)]"}`}>top</span>}
                    {s.name}
                  </span>
                  <span className={`mono w-full truncate text-[10px] tabular-nums ${on ? "text-[var(--good)]" : "text-[var(--muted)]"}`}>
                    {r.mins.map(fmt).join(" / ")}
                    {r.est && " · est."}
                  </span>
                  <span className="w-full truncate text-[10px] text-[var(--muted)]">{[n > 1 ? `${fmt(r.spread)} apart` : null, ...r.why].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            );
          return (
            <li key={r.id}>
              <button
                type="button"
                onPointerDown={(e) => {
                  pointerType.current = e.pointerType;
                }}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "touch") onPreview(r.id);
                }}
                onFocus={() => onPreview(r.id)}
                onClick={() => {
                  if (pointerType.current === "touch" && previewed !== r.id) onPreview(r.id);
                  else onCommit(r.id);
                }}
                aria-pressed={on}
                // Name and times side by side when they fit; on a narrow column the times drop under the name rather than the name losing its end.
                className={`flex w-full flex-wrap items-baseline gap-x-3 rounded-xl border px-3 py-2 text-left transition-colors ${big ? "py-2.5" : ""} ${tone}`}
              >
                <span className="font-semibold">
                  {i === 0 && <span className={`mr-1 font-bold uppercase tracking-wider ${on ? "text-[var(--good)]" : "text-[var(--accent)]"} ${big ? "text-xs" : "text-[9px]"}`}>top</span>}
                  {s.name}
                </span>
                <span className={`mono ml-auto whitespace-nowrap tabular-nums ${on ? "text-[var(--good)]" : "text-[var(--muted)]"} ${big ? "text-base" : "text-xs"}`}>
                  {r.mins.map(fmt).join(" / ")}
                  {n > 1 && ` · ${fmt(r.spread)} apart`}
                  {r.est && <span className="opacity-70"> · est.</span>}
                </span>
                <span className={`basis-full text-[var(--muted)] ${big ? "text-sm" : "text-[11px]"}`}>{r.why.join(" · ")}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
