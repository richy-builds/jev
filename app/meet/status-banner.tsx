"use client";

import { useState } from "react";
import { lineColour, lineName, lineText, type Theme } from "@/lib/stations";
import type { Impact } from "@/lib/use-status";

/** One impact as a phrase: "Northern suspended (what if)", "District closed Earl's Court → Richmond", "Central slowed". */
function describe(i: Impact): string {
  if (i.removed) return `${lineName(i.line)} suspended${i.simulated ? " (what if)" : ""}`;
  if (i.closed) return `${lineName(i.line)} closed ${i.closed}`;
  return `${lineName(i.line)} slowed`;
}

/** The line's name on its own colour, so a folded list scans like the map. */
function LineTag({ line, big, theme }: { line: string; big: boolean; theme: Theme }) {
  return (
    <span
      className={`rounded ${big ? "px-1.5 py-0.5 text-sm" : "px-1 py-px text-[10px]"} font-semibold`}
      style={{ background: lineColour(line, theme), color: lineText(line, theme) }}
    >
      {lineName(line)}
    </span>
  );
}

/**
 * Line status scoped to the routes on the map. With a pick or a live top, only the
 * lines someone would ride matter: the pill says so ("No disruptions on your routes",
 * or the ones that are), and everything else folds behind "N closures elsewhere".
 * A simulated suspension (`?disrupt=`) always shows, since it was asked for. Without
 * origins there are no routes, and the pill lists every disruption as before.
 */
export function StatusBanner({ impacts, routeLines, pillCls, big, theme = "dark" }: { impacts: Impact[]; routeLines: Set<string> | null; pillCls: string; big: boolean; theme?: Theme }) {
  const [open, setOpen] = useState(false);
  if (!impacts.length) return null;

  if (!routeLines) {
    return (
      <span className={`${pillCls} bg-[var(--panel)]/80 text-[var(--muted)]`}>
        {[
          ...impacts.filter((i) => i.removed).map(describe),
          ...impacts.filter((i) => !i.removed && i.closed).map(describe),
          ...(impacts.some((i) => !i.removed && !i.closed) ? [`slowed: ${impacts.filter((i) => !i.removed && !i.closed).map((i) => lineName(i.line)).join(", ")}`] : []),
        ].join(" · ")}
      </span>
    );
  }

  const shown = impacts.filter((i) => routeLines.has(i.line) || i.simulated);
  const elsewhere = impacts.filter((i) => !shown.includes(i));
  const noun = elsewhere.every((i) => i.removed || i.closed) ? "closure" : "disruption";
  return (
    <>
      {shown.length ? (
        <span className={`${pillCls} bg-[var(--warn)]/15 font-semibold text-[var(--warn)]`}>{shown.map(describe).join(" · ")}</span>
      ) : (
        <span className={`${pillCls} bg-[var(--good)]/15 text-[var(--good)]`}>No disruptions on your routes</span>
      )}
      {elsewhere.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`${pillCls} pointer-events-auto bg-[var(--panel)]/80 text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--text)]`}
        >
          {elsewhere.length} {noun}
          {elsewhere.length === 1 ? "" : "s"} elsewhere
        </button>
      )}
      {open &&
        elsewhere.map((i) => (
          <span key={i.line} className={`${pillCls} inline-flex items-center gap-1.5 bg-[var(--panel)]/80 text-[var(--muted)]`}>
            <LineTag line={i.line} big={big} theme={theme} />
            {i.removed ? `suspended${i.simulated ? " (what if)" : ""}` : i.closed ? `closed ${i.closed}` : "slowed"}
          </span>
        ))}
    </>
  );
}
