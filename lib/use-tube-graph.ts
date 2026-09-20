"use client";

import { useCallback, useMemo } from "react";
import { CANDIDATES, GRAPH, type LineStatus } from "@/lib/stations";
import { applyStatus, pathTo, reach, type Leg, type Reach } from "@/lib/tube-graph";

/**
 * Dijkstra from every origin, memoised per origin set and status. ~270 stations, so a
 * full recompute is a millisecond or two; there is no need to cache across renders
 * beyond useMemo. Everything here is code, not Jev: travel time never enters state.
 */
export function useTubeGraph(origins: string[], status: LineStatus | null = null) {
  const originsKey = origins.join(",");
  const edges = useMemo(() => applyStatus(GRAPH, status), [status]);
  const reaches = useMemo(() => {
    const out: Record<string, Reach> = {};
    for (const o of originsKey.split(",").filter(Boolean)) out[o] = reach(o, edges);
    return out;
  }, [originsKey, edges]);

  /** Minutes from each origin (in order) to a station; Infinity when unreachable. */
  const minsTo = useCallback(
    (id: string): number[] => originsKey.split(",").filter(Boolean).map((o) => reaches[o]?.mins[id] ?? Infinity),
    [originsKey, reaches],
  );

  /** Candidate ids everyone can reach within `budget` minutes. Every candidate when there are no origins. */
  const feasible = useCallback(
    (budget: number): string[] => {
      const os = originsKey.split(",").filter(Boolean);
      if (!os.length) return CANDIDATES.map((s) => s.id);
      return CANDIDATES.filter((s) => os.every((o) => (reaches[o]?.mins[s.id] ?? Infinity) <= budget)).map((s) => s.id);
    },
    [originsKey, reaches],
  );

  const pathBetween = useCallback((origin: string, target: string): Leg[] => (reaches[origin] ? pathTo(reaches[origin], target) : []), [reaches]);

  return { reaches, minsTo, feasible, pathBetween, edges };
}

/** Soft fairness: a station near everyone's limit is down-weighted, the nearest-for-all is left alone. */
export function fairnessWeight(maxMins: number, budget: number): number {
  if (!Number.isFinite(maxMins)) return 0;
  return Math.exp(-((maxMins / budget) ** 2) * 0.7);
}

/**
 * How firmly "fastest total" is meant. The fairness weight above is soft (0.7) because it
 * is always on and must not out-vote Jev; this one only applies as far as the dial is
 * turned, and at 0.7 it spanned 0.69–0.80 across the shortlist while Jev's probabilities
 * differed 2×, so the far end of the dial reordered nothing. At 6 a total of 76 min weighs
 * 0.15 against 0.05 for 99 min: the far end reads as "by total" among the places that
 * fit the description, and the middle still lets the description out-vote a few minutes.
 */
const TOTAL_SHARPNESS = 6;

/** Soft total: everyone's minutes summed, against everyone spending the whole budget. */
export function totalWeight(sumMins: number, n: number, budget: number): number {
  if (!Number.isFinite(sumMins) || n <= 0) return 0;
  return Math.exp(-((sumMins / (n * budget)) ** 2) * TOTAL_SHARPNESS);
}

/**
 * The fairness dial. λ = 0 is today's ranking (Jev's probability shaped by the slowest
 * person's time); λ = 1 shapes it by the total instead, so a station that is quick for
 * two and far for one can climb. `x ** 1 === x` and `x ** 0 === 1`, so at λ = 0 the
 * weights are bit-identical to `p * fairnessWeight(...)`.
 */
export function blend(p: number, maxMins: number, sumMins: number, n: number, budget: number, lambda: number): number {
  return p * fairnessWeight(maxMins, budget) ** (1 - lambda) * totalWeight(sumMins, n, budget) ** lambda;
}

export { shortName } from "@/lib/stations";
