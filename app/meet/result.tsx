"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { SPRING } from "@/app/grid/ui";
import type { JourneyResponse } from "@/app/api/meet/journey/route";
import { changeStations, changeWait, fairnessLabel, isLanded, spread, type Journey } from "@/lib/meet-times";
import { STATION_BY_ID, lineColour, lineName, lineText, type Origin, type Theme } from "@/lib/stations";
import { shortName } from "@/lib/use-tube-graph";
import type { VenuesState } from "@/lib/use-venues";
import { Venues } from "./venues";

export { isLanded, type Journey };

/** TfL's time against the graph estimate the pick was made on; `over` when it blows the budget or the estimate. */
export type Verdict = { tfl: number; graph: number; over: boolean; line: string | null };

function LegChip({ line, mode, mins, big, theme }: { line: string | null; mode: string; mins: number; big: boolean; theme: Theme }) {
  const tube = mode === "tube" && line;
  const bg = tube ? lineColour(line, theme) : "transparent";
  const fg = tube ? lineText(line, theme) : "var(--muted)";
  return (
    <span
      className={`mono inline-flex items-center gap-1 rounded-md ${big ? "px-2.5 py-1 text-base" : "px-1.5 py-0.5 text-[11px]"} font-semibold leading-none`}
      style={{ background: bg, color: fg, border: tube ? "none" : "1px solid var(--line)" }}
      title={tube ? `${lineName(line)} line` : mode}
    >
      {tube ? lineName(line) : mode === "walking" ? "walk" : mode}
      <span className="opacity-80">{mins}</span>
    </span>
  );
}

/**
 * The minutes TfL's `duration` holds beyond the legs: interchange walks and platform
 * waits. Drawn as one neutral dashed chip after the legs so the row sums to the total;
 * the tooltip names the change station(s). A single leg still waits for its first train.
 */
function ChangeChip({ j, big }: { j: JourneyResponse; big: boolean }) {
  const wait = changeWait(j);
  if (!wait || !j.legs.length) return null;
  const at = changeStations(j);
  const title = at.length ? `change at ${at.join(", ")}: interchange and platform wait` : "platform wait";
  return (
    <span
      className={`mono inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--muted)]/70 text-[var(--muted)] ${big ? "px-2.5 py-1 text-base" : "px-1.5 py-0.5 text-[11px]"} font-semibold leading-none`}
      title={title}
    >
      {at.length ? "change + wait" : "wait"}
      <span className="opacity-80">{wait}</span>
    </span>
  );
}

/**
 * Share and close, grouped top-right of the card (and of the phone sheet's header):
 * the `actions` slot the client fills. Share reads "link copied" after the clipboard fallback.
 */
export function ResultActions({ onShare, shared, onClose, big = false }: { onShare: () => void; shared: boolean; onClose: () => void; big?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button onClick={onShare} className={`rounded-full bg-[var(--good)] font-semibold text-[var(--on-good)] ${big ? "px-5 py-2 text-base" : "px-3 py-1 text-xs"}`}>
        {shared ? "link copied" : "share"}
      </button>
      <button
        onClick={onClose}
        aria-label="Back to the map"
        className={`grid place-items-center rounded-full border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] ${big ? "h-9 w-9 text-lg" : "h-7 w-7 text-sm"}`}
      >
        ×
      </button>
    </div>
  );
}

/**
 * The committed answer: one card per person with TfL's verified legs (line colour
 * chips with minutes), the total, and a flag when TfL reports a disruption on a leg.
 * Rendered over the map once a pick is committed; the routes draw on the map itself.
 * `layout="sheet"` is the same rows, shortlist slot and venues inside the phone's bottom
 * sheet (app/meet/sheet.tsx): a one-line header the peek state shows on its own, a body
 * that scrolls inside the sheet, no card chrome.
 */
export function MeetResult({
  pick,
  origins,
  journeys,
  actions,
  shortlist,
  dimmedLines,
  localisedLines,
  verdicts,
  venues,
  big = false,
  theme = "dark",
  layout = "card",
}: {
  pick: string;
  origins: Origin[];
  journeys: Record<string, Journey>;
  /** Share and close (`ResultActions`), top-right of the header. */
  actions?: ReactNode;
  /** The phone sheet puts the shortlist between the rows and the venues; the desktop card leaves it as its own panel above. */
  shortlist?: ReactNode;
  /** Suspended lines (live or simulated): a leg on one is flagged even when TfL's plan predates it. */
  dimmedLines?: Set<string>;
  /** Lines whose part closure is localised (lib/closures.ts): TfL's disruption flag on their legs is line-wide noise. */
  localisedLines?: Set<string>;
  /** Per origin id: a row whose TfL time disagrees with the estimate is flagged and says so. */
  verdicts?: Record<string, Verdict>;
  /** Places near the pick (lib/use-venues.ts), listed under the rows; null hides the section. Never feeds back into the pick. */
  venues?: { state: VenuesState; kind: string | null; cuisine: string | null } | null;
  big?: boolean;
  /** Leg chips take the theme's line palette (lib/stations.ts `lineColour`). */
  theme?: Theme;
  /** `card`: the floating panel over the map. `sheet`: flat, inside the phone's bottom sheet. */
  layout?: "card" | "sheet";
}) {
  const s = STATION_BY_ID[pick];
  if (!s) return null;
  const landed = origins.map((o) => journeys[o.id]).filter(isLanded);
  // The headline once every journey is in: how far apart the slowest and fastest are, not the slowest alone.
  const allLanded = origins.length > 0 && landed.length === origins.length;
  const apart = allLanded ? spread(landed.map((j) => j.duration)) : null;
  // TfL pins a line's disruption on every leg of it; once the closure is localised, a leg TfL planned elsewhere on that line is fine.
  const hit = (l: { line: string | null; disrupted: boolean }) => (l.disrupted && !(l.line && localisedLines?.has(l.line))) || (!!l.line && !!dimmedLines?.has(l.line));
  const anyDisrupted = landed.some((j) => j.legs.some(hit));
  const anyOver = origins.some((o) => verdicts?.[o.id]?.over);
  const uneven = apart !== null && fairnessLabel(apart) === "Uneven";
  const tone = uneven ? "text-[var(--warn)]" : "text-[var(--good)]";
  const status = anyOver ? "TfL disagrees · re-picking" : anyDisrupted ? "disruption on a leg" : landed.length ? "times by TfL journey planner" : "";
  const sheet = layout === "sheet";
  const rows = (
    <ul className={`flex flex-col ${sheet ? "" : "overflow-y-auto"} ${big ? "gap-2" : "gap-1.5"}`}>
      {origins.map((o, i) => {
        const j = journeys[o.id];
        const name = shortName(o.label ?? STATION_BY_ID[o.id]?.name ?? o.id);
        const v = verdicts?.[o.id];
        const warn = isLanded(j) && (j.legs.some(hit) || v?.over);
        return (
          <li key={o.id} className="flex items-center gap-2">
            <span className={`mono shrink-0 font-bold text-[var(--accent-2)] ${big ? "w-6" : "w-4 text-xs"}`}>{i + 1}</span>
            <span className={`shrink-0 truncate ${big ? "w-28" : "w-24"}`} title={STATION_BY_ID[o.id]?.name}>
              {name}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {j === undefined && <span className="text-[var(--muted)]">planning…</span>}
              {j && "error" in j && <span className="text-[var(--hot)]">TfL: {j.error}</span>}
              {isLanded(j) && j.legs.length === 0 && <span className="text-[var(--muted)]">already there</span>}
              {isLanded(j) && j.legs.map((l, k) => <LegChip key={k} line={l.line} mode={l.mode} mins={l.mins} big={big} theme={theme} />)}
              {isLanded(j) && <ChangeChip j={j} big={big} />}
              {v?.over && (
                <span className={`mono font-semibold text-[var(--warn)] ${big ? "text-base" : "text-[11px]"}`}>
                  TfL says {v.tfl} min, not {v.graph}
                </span>
              )}
            </span>
            {isLanded(j) && (
              <span className={`mono shrink-0 ${warn ? "font-semibold text-[var(--warn)]" : "text-[var(--text)]"}`}>
                {j.duration} min{warn ? " ⚠" : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
  if (sheet) {
    // The peek line: everyone's minutes in order (an ellipsis for a journey still planning) and the spread once all are in.
    const each = origins.map((o) => {
      const j = journeys[o.id];
      return isLanded(j) ? String(j.duration) : "…";
    });
    const line = !origins.length
      ? "add who's coming for times"
      : origins.length === 1
        ? allLanded
          ? `${landed[0].duration} min door to door`
          : "TfL journey planner…"
        : `${each.join(" / ")} min${apart !== null ? ` · ${apart} min apart` : ""}`;
    return (
      <section className="flex min-h-0 flex-1 flex-col text-sm" aria-label={`Meet at ${s.name}`}>
        <header data-sheet-head className="flex items-center gap-3 px-4 pb-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold tracking-tight">
              Meet at <span className="text-[var(--good)]">{s.name}</span>
            </div>
            <div className={`mono truncate text-xs font-semibold ${apart === null && !allLanded ? "text-[var(--muted)]" : tone}`}>{line}</div>
          </div>
          {actions}
        </header>
        <div data-sheet-scroll className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4" style={{ overscrollBehavior: "contain" }}>
          {rows}
          {shortlist}
          {venues && <Venues state={venues.state} pick={pick} kind={venues.kind} cuisine={venues.cuisine} flat />}
          {status && <p className="mono text-xs text-[var(--muted)]">{status}</p>}
        </div>
      </section>
    );
  }
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={SPRING}
      className={`pointer-events-auto flex max-h-[60%] flex-col overflow-hidden rounded-2xl border border-[var(--good)]/50 bg-[var(--panel)]/95 shadow-2xl backdrop-blur ${big ? "text-lg" : "text-sm"}`}
      aria-label={`Meet at ${s.name}`}
    >
      <header className={`flex items-start gap-3 ${big ? "px-5 pt-4 pb-2" : "px-4 pt-3 pb-2"}`}>
        <div className="min-w-0 flex-1">
          <div className={`font-semibold tracking-tight ${big ? "text-2xl" : "text-base"}`}>
            Meet at <span className="text-[var(--good)]">{s.name}</span>
          </div>
          <div className={`truncate text-[var(--muted)] ${big ? "text-base" : "text-xs"}`}>{s.hook}</div>
          <div className={`mono mt-1 font-semibold ${big ? "text-base" : "text-xs"} ${tone}`}>
            {apart === null
              ? origins.length
                ? "TfL journey planner…"
                : "add who's coming for times"
              : origins.length === 1
                ? `${landed[0].duration} min door to door`
                : `${fairnessLabel(apart)} · ${apart} min apart`}
          </div>
        </div>
        {actions}
      </header>
      <div className={`flex flex-col ${big ? "px-5 pb-4" : "px-4 pb-3"}`}>
        {rows}
        {shortlist}
        {venues && <Venues state={venues.state} pick={pick} kind={venues.kind} cuisine={venues.cuisine} big={big} />}
        {status && <p className={`mono text-[var(--muted)] ${big ? "pt-3 text-base" : "pt-2 text-xs"}`}>{status}</p>}
      </div>
    </motion.section>
  );
}
