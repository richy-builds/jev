"use client";

import { STATION_BY_ID } from "@/lib/stations";
import type { VenuesState } from "@/lib/use-venues";
import { CUISINE_LABEL, KIND_LABEL, KIND_PLURAL, hoursToday, type Venue } from "@/lib/venues";
import { shortName } from "@/lib/use-tube-graph";

/** Rows on the card (the mockup shows three); the API returns up to 40, the card is not the place for them. Two in the recording layout, where the card sits over a 4:5 map. */
const SHOWN = 4;
const SHOWN_BIG = 2;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cuisineLabel = (c: string) => CUISINE_LABEL[c] ?? cap(c.replace(/_/g, " "));

function VenueRow({ v, pick, best, big }: { v: Venue; pick: string; best: boolean; big: boolean }) {
  const today = hoursToday(v.hours);
  const meta = [v.cuisine.length ? v.cuisine.slice(0, 2).map(cuisineLabel).join(" · ") : KIND_LABEL[v.kind] ?? v.kind, today ?? (v.hours ? "hours vary" : null)].filter(Boolean).join(" · ");
  return (
    <li
      className={`grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl border ${big ? "px-3.5 py-2" : "px-2.5 py-1.5"} ${best ? "border-[var(--good)]/60 bg-[var(--good)]/10" : "border-[var(--line)]"}`}
      title={v.hours ?? undefined}
    >
      <div className="min-w-0">
        <div className={`flex flex-wrap items-center gap-1.5 font-semibold leading-tight ${big ? "text-lg" : "text-sm"}`}>
          <span className="truncate">{v.name}</span>
          {best && <span className={`rounded border border-[var(--good)] px-1 font-bold uppercase tracking-wider text-[var(--good)] ${big ? "text-xs" : "text-[9px]"}`}>best match</span>}
        </div>
        <div className={`truncate text-[var(--muted)] ${big ? "text-sm" : "text-[11px]"}`}>{meta}</div>
      </div>
      <div className={`mono shrink-0 text-right leading-tight ${big ? "text-base" : "text-xs"}`}>
        {v.walkMin} min
        <span className={`block font-sans text-[var(--muted)] ${big ? "text-xs" : "text-[9px]"}`}>walk from {shortName(STATION_BY_ID[pick]?.name ?? "")}</span>
      </div>
    </li>
  );
}

/**
 * Places within a short walk of the committed station, under the per-person rows:
 * name · walk · cuisine · today's hours, the row that satisfies the description's
 * cuisine and "near" first and tagged. Reads the state from lib/use-venues.ts only;
 * nothing here feeds back into the station ranking. `flat` (the phone sheet) drops the
 * list's own scroll: the sheet scrolls as a whole.
 */
export function Venues({ state, pick, kind, cuisine, big = false, flat = false }: { state: VenuesState; pick: string; kind: string | null; cuisine: string | null; big?: boolean; flat?: boolean }) {
  const station = shortName(STATION_BY_ID[pick]?.name ?? "");
  const what = cuisine ? cuisineLabel(cuisine) : kind ? KIND_PLURAL[kind] ?? cap(kind) : "Places";
  const shown = state.venues.slice(0, big ? SHOWN_BIG : SHOWN);
  const more = state.venues.length - shown.length;
  const empty = state.status === "done" && !state.venues.length;
  return (
    <section className={`flex flex-col ${big ? "gap-2 pt-3" : "gap-1.5 pt-2"}`} aria-label={`${what} near ${station}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className={`font-semibold uppercase tracking-wider text-[var(--muted)] ${big ? "text-sm" : "text-[10px]"}`}>
          {what} near {station}
        </h3>
        {state.note && <span className={`text-[var(--warn)] ${big ? "text-sm" : "text-[10px]"}`}>{state.note}</span>}
      </header>
      {state.status === "loading" && <p className={`text-[var(--muted)] ${big ? "text-base" : "text-xs"}`}>finding places…</p>}
      {empty && <p className={`text-[var(--muted)] ${big ? "text-base" : "text-xs"}`}>{state.source === "none" ? "no venue data" : "nothing within a short walk"}</p>}
      {shown.length > 0 && (
        // Bounded: the card grows by at most this much over the rows; the rest scrolls.
        <ul className={`flex flex-col ${flat ? "" : "overflow-y-auto"} ${big ? "max-h-64 gap-1.5" : flat ? "gap-1" : "max-h-36 gap-1"}`}>
          {shown.map((v) => (
            <VenueRow key={v.id} v={v} pick={pick} best={v.id === state.bestMatch} big={big} />
          ))}
        </ul>
      )}
      {(more > 0 || state.source === "distance") && shown.length > 0 && (
        <p className={`text-[var(--muted)] ${big ? "text-sm" : "text-[10px]"}`}>
          {more > 0 ? `${more} more nearby` : ""}
          {more > 0 && state.source === "distance" ? " · " : ""}
          {state.source === "distance" ? "nearest first" : ""}
        </p>
      )}
    </section>
  );
}
