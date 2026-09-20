import raw from "@/data/movies.json";

export interface Movie {
  id: string;
  title: string;
  year: number;
  /** Hand-written plot-first memory hook; what Jev sees on every keystroke. */
  hook: string;
  /** Wikipedia intro (keyless). Only sent in the small second-pass request. */
  summary: string;
  /** From Wikidata (keyless). */
  director?: string;
  cast: string[];
  genre: string[];
  poster: string;
  w: number;
  h: number;
}

/** A Choice question accepts at most 255 options, so the catalogue is split into chunks no bigger than this. */
export const CHUNK_SIZE = 250;

export const MOVIES: Movie[] = raw as Movie[];

/** Equal-sized chunks, each small enough for one Choice question. */
export const CHUNKS: Movie[][] = (() => {
  const n = Math.ceil(MOVIES.length / CHUNK_SIZE);
  const size = Math.ceil(MOVIES.length / n);
  return Array.from({ length: n }, (_, i) => MOVIES.slice(i * size, (i + 1) * size));
})();

export const MOVIE_BY_ID: Record<string, Movie> = Object.fromEntries(MOVIES.map((m) => [m.id, m]));

export type Mode = "finder" | "set" | "nothing";

/** Wire shape returned by /api/find and consumed by the grid page. */
export interface FindResponse {
  /** Probability per movie id that it is the one being described. Sums to ~1, after exclusion. */
  probabilities: Record<string, number>;
  top: string;
  confidence: number;
  /** Probability that the description matches something in the catalogue at all. */
  exists: number;
  /** Router Choice: one specific film, a set sharing a quality, or nothing. */
  router: { specific: number; set: number; nothing: number };
  /** What code decided from `router` and `exists`. */
  mode: Mode;
  /** Film the description explicitly rules out, when the exclusion Choice is confident. */
  excluded: string | null;
  /** Probability on the excluded film, or on `none` when nothing was excluded. */
  excludedP: number;
  /** Probability the description rejects the previous turn's answer; null when there was no previous answer. */
  rejectsPrevious: number | null;
  latencyMs: number;
  model: string;
  candidates: number;
  /** Input tokens billed for this call, when the API reports usage. */
  tokens: number | null;
}

/** Wire shape returned by /api/fits: one Noul per film, for set mode. */
export interface FitsResponse {
  fits: Record<string, number>;
  threshold: number;
  /** Films at or above `threshold`. */
  count: number;
  latencyMs: number;
  tokens: number | null;
}
