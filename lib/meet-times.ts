import type { JourneyResponse } from "@/app/api/meet/journey/route";

/**
 * One time source for /meet. TfL's journey is the truth once it lands for the
 * committed pick; the graph's Dijkstra estimate stands in everywhere else (the hover
 * tooltip, the live top pick, a journey that failed). Pure, so the OG image and the
 * card can share it; the veto check in client.tsx keeps comparing TfL against the
 * estimate frozen at commit and does not go through here.
 */

/** One person's TfL journey: loading (undefined), landed, or failed. */
export type Journey = JourneyResponse | { error: string } | undefined;

export const isLanded = (j: Journey): j is JourneyResponse => !!j && !("error" in j);

export type PersonTime = { mins: number; source: "tfl" | "est" };

/** TfL's door-to-door minutes when `target` is the committed pick and the journey landed, else the graph estimate. */
export function personTime(target: string, pick: string | null, journey: Journey, estimate: number): PersonTime {
  if (pick === target && isLanded(journey)) return { mins: journey.duration, source: "tfl" };
  return { mins: estimate, source: "est" };
}

/** TfL folds interchange walks and platform waits into `duration`; this is the part no leg accounts for. */
export const changeWait = (j: JourneyResponse): number => Math.max(0, j.duration - j.legs.reduce((s, l) => s + l.mins, 0));

/** Station names where one tube leg hands over to the next (a walk between two tube legs is a change too). */
export function changeStations(j: JourneyResponse): string[] {
  const out: string[] = [];
  for (let i = 1; i < j.legs.length; i++) {
    const prev = j.legs[i - 1];
    const next = j.legs[i];
    if (prev.mode === "tube" && next.mode === "tube") out.push(prev.to);
  }
  return out;
}

/** `changeWait` shared across `n` change stations for the map's rings: whole minutes, the remainder on the first changes, so the rings sum to the card's chip. */
export function splitWait(wait: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(wait / n);
  const extra = wait - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Slowest minus fastest: the headline number. */
export const spread = (mins: number[]): number => (mins.length ? Math.max(...mins) - Math.min(...mins) : 0);

/** Up to this many minutes apart the meeting point is called fair. */
export const FAIR_SPREAD_MIN = 8;

export const fairnessLabel = (s: number): "Fair" | "Uneven" => (s <= FAIR_SPREAD_MIN ? "Fair" : "Uneven");
