"use client";

import { useEffect, useState } from "react";
import { venuesKey, type Venue, type VenueSource, type VenuesResponse } from "@/lib/venues";

/** What the description asked for, as the finder read it (above threshold) plus the resolved "near" station and the text itself. */
export type VenueIntent = { kind: string | null; cuisine: string | null; near: string | null; q: string };

export type VenuesState = {
  status: "loading" | "done";
  venues: Venue[];
  source: VenueSource;
  note: string | null;
  bestMatch: string | null;
};

const LOADING: VenuesState = { status: "loading", venues: [], source: "none", note: null, bestMatch: null };

/**
 * Venues for the committed pick: one POST to /api/meet/venues per pick and intent,
 * re-fetched when the intent changes (kind, cuisine, anchor), aborted when the pick
 * changes. The answer is keyed by pick and intent, so a response for an earlier pick can
 * never show on a later card: until the current key has landed the state is `loading`.
 * Null while nothing is committed. Never touches the station ranking.
 */
export function useVenues(pick: string | null, intent: VenueIntent): VenuesState | null {
  const key = pick ? venuesKey(pick, intent.kind, intent.cuisine, intent.near, intent.q) : null;
  const [landed, setLanded] = useState<{ key: string; state: VenuesState } | null>(null);

  useEffect(() => {
    if (!key || !pick) return;
    const ctrl = new AbortController();
    (async () => {
      let state: VenuesState;
      try {
        const res = await fetch("/api/meet/venues", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ station: pick, kind: intent.kind ?? undefined, cuisine: intent.cuisine ?? undefined, near: intent.near ?? undefined, q: intent.q }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as VenuesResponse;
        state = { status: "done", venues: data.venues, source: data.source, note: data.note ?? null, bestMatch: data.bestMatch };
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        state = { ...LOADING, status: "done" };
      }
      if (!ctrl.signal.aborted) setLanded({ key, state });
    })();
    return () => ctrl.abort();
    // The intent's fields are all in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return null;
  return landed?.key === key ? landed.state : LOADING;
}
