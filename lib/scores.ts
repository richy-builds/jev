import raw from "@/data/movie-scores.json";

/**
 * Offline scores from scripts/score-movies.mjs (composite scoring pattern). Each
 * film was scored once, so the page can re-sort the wall on any mix of these
 * dimensions with zero API calls. Values are expected scores in [0, 1].
 */
export const DIMS = ["scary", "funny", "tearjerker", "slow", "family"] as const;
export type Dim = (typeof DIMS)[number];
export type Weights = Record<Dim, number>;

const data = raw as {
  dimensions: Record<Dim, { label: string; levels: string[] }>;
  scores: Record<string, Record<string, number>>;
};

export const DIM_LABELS: Record<Dim, string> = Object.fromEntries(DIMS.map((d) => [d, data.dimensions[d].label])) as Record<Dim, string>;

export const ZERO_WEIGHTS: Weights = { scary: 0, funny: 0, tearjerker: 0, slow: 0, family: 0 };

export function scoreOf(id: string, dim: Dim): number {
  return data.scores[id]?.[dim] ?? 0.5;
}

/** Weighted sum of the film's scores; weights run −1..+1 so a slider can also push a quality away. */
export function composite(id: string, w: Weights): number {
  let c = 0;
  for (const d of DIMS) if (w[d] !== 0) c += w[d] * scoreOf(id, d);
  return c;
}

export const weightsActive = (w: Weights) => DIMS.some((d) => w[d] !== 0);
