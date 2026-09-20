import { personTime, spread, type Journey } from "@/lib/meet-times";

/**
 * The shortlist under the fairness dial: the top three of the blended ranking, each with
 * everyone's minutes (through `personTime`, the one time source), the spread, the total,
 * and the axis it wins. Pure, so the memo in client.tsx is a one-liner and the rules are
 * testable by eye.
 */

export type Why = "best match" | "fairest" | "fastest total" | "closest" | "best overall" | "runner-up";

export type ShortlistRow = {
  id: string;
  /** Per origin, in order. */
  mins: number[];
  /** True while anyone's minutes are the graph estimate rather than TfL's. */
  est: boolean;
  spread: number;
  total: number;
  /** Jev's raw probability, before the fairness reweight. */
  p: number;
  why: Why[];
};

export const SHORTLIST_SIZE = 3;

/**
 * Which axis each row wins, relative to the others: `best match` is the highest raw
 * probability, `fairest` the smallest spread, `fastest total` the smallest sum (one
 * origin: `closest`, since the spread is always 0). A tie on an axis goes to the row
 * with the higher probability. A row that wins nothing is a `runner-up`, unless it heads
 * the ranking, where the blend of match and time is the reason: `best overall`.
 */
function whyAxes(rows: Omit<ShortlistRow, "why">[], n: number): Why[][] {
  const out: Why[][] = rows.map(() => []);
  if (!rows.length) return out;
  // Rows arrive in ranking order; `reduce` keeps the first (highest-p) of equal values, so ties go to the better match.
  const winner = (key: (r: Omit<ShortlistRow, "why">) => number, best: (a: number, b: number) => boolean) =>
    rows.reduce((w, r, i) => (best(key(r), key(rows[w])) ? i : w), 0);
  const byP = rows.reduce((w, r, i) => (r.p > rows[w].p ? i : w), 0);
  out[byP].push("best match");
  const finite = rows.some((r) => Number.isFinite(r.total));
  if (finite) {
    if (n > 1) {
      out[winner((r) => r.spread, (a, b) => a < b)].push("fairest");
      out[winner((r) => r.total, (a, b) => a < b)].push("fastest total");
    } else {
      out[winner((r) => r.total, (a, b) => a < b)].push("closest");
    }
  }
  return out.map((w, i) => (w.length ? w : [i === 0 ? "best overall" : "runner-up"]));
}

export function buildShortlist({
  probabilities,
  raw,
  origins,
  pick,
  journeys,
  minsTo,
}: {
  /** The blended ranking (client.tsx `probabilities`). */
  probabilities: Record<string, number>;
  /** Jev's probabilities before the reweight. */
  raw: Record<string, number>;
  origins: string[];
  pick: string | null;
  journeys: Record<string, Journey>;
  minsTo: (id: string) => number[];
}): ShortlistRow[] {
  if (!origins.length) return [];
  const ids = Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SHORTLIST_SIZE)
    .map(([id]) => id);
  const rows = ids.map((id) => {
    const est = minsTo(id);
    const times = origins.map((o, i) => personTime(id, pick, journeys[o], est[i]));
    const mins = times.map((t) => t.mins);
    return { id, mins, est: times.some((t) => t.source === "est"), spread: spread(mins), total: mins.reduce((s, m) => s + m, 0), p: raw[id] ?? 0 };
  });
  const why = whyAxes(rows, origins.length);
  return rows.map((r, i) => ({ ...r, why: why[i] }));
}
