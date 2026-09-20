import { choice, noul, type JsonValue } from "@typesafe-ai/sdk";
import { MOVIE_BY_ID, type Movie } from "@/lib/movies";

/**
 * Second pass over a handful of films (the skill-suggestion cookbook's shape): the
 * per-keystroke call ranked 258 films on their hooks; this one re-reads the top few
 * with their Wikipedia intro, director and cast, which are too long to send 258 times.
 * It answers two things code could not get from the first pass: which of two
 * near-duplicates the description really means, and *why* the best match matched.
 */
export const INSPECT_TOP = 5;
export const TAG_TOP = 3;

/** Evidence tags rendered under the best match. Each is one literal Noul; no text is generated. */
export const TAGS = {
  plot: { label: "plot", ask: "the film's overall story or premise" },
  scene: { label: "a scene", ask: "one particular scene, image, or moment in the film" },
  line: { label: "a line", ask: "a line of dialogue quoted or paraphrased from the film" },
  actor: { label: "a name", ask: "an actor, character name, or the director" },
  era: { label: "the era", ask: "the film's decade, period setting, or release year" },
} as const;
export type Tag = keyof typeof TAGS;

export const INSPECT_THRESHOLDS = {
  /** A tag is shown when its Noul is at least this. */
  tag: 0.6,
  /** Two films are still "too close" when their re-ranked probabilities differ by less than this. */
  close: 0.3,
} as const;

function full(m: Movie): JsonValue {
  return {
    id: m.id,
    title: m.title,
    year: m.year,
    hook: m.hook,
    summary: m.summary,
    director: m.director ?? "",
    cast: m.cast.join(", "),
  };
}

export function inspectState(description: string, ids: string[]) {
  return { description, movies: ids.map((id) => full(MOVIE_BY_ID[id])) };
}

export function inspectQuestions(ids: string[]) {
  const q: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
    which: choice(
      {
        question: "Which film in `movies` is the person describing in `description`?",
        guidance:
          "These films were shortlisted from a larger catalogue and may be sequels or near-duplicates of each other. Use the summary, director and cast to separate them. Spread probability when the description genuinely fits several.",
      },
      Object.fromEntries(ids.map((id) => [id, null])) as Record<string, null>,
    ),
  };
  for (const id of ids.slice(0, TAG_TOP)) {
    const m = MOVIE_BY_ID[id];
    const t = `"${m.title}" (${m.year})`;
    for (const [tag, { ask }] of Object.entries(TAGS)) {
      q[`${tag}|${id}`] = noul(`Does \`description\` match ${t} on ${ask}?`, {
        true: `The description mentions or clearly alludes to ${ask}, and that matches ${t}`,
        false: `The description says nothing about ${ask}, or what it says does not match ${t}`,
      });
    }
  }
  return q;
}

/** Wire shape returned by /api/inspect. */
export interface InspectResponse {
  ids: string[];
  /** Re-ranked probabilities over `ids`, from the fuller descriptions. */
  probabilities: Record<string, number>;
  top: string;
  /** True when the top two stay within INSPECT_THRESHOLDS.close of each other. */
  close: boolean;
  /** Per film (top three): tag → probability the description matched on that evidence. */
  evidence: Record<string, Record<Tag, number>>;
  latencyMs: number;
  tokens: number | null;
}
