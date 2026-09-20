import { choice, noul, type JsonValue } from "@typesafe-ai/sdk";
import { CHUNKS, MOVIES, type Mode, type Movie } from "@/lib/movies";

/**
 * Extra catalogue fields Jev sees per film in the per-keystroke call, on top of
 * id/title/year/hook. Measured with ["director", "genre"] (Wikidata): +7k tokens,
 * +15% latency, no probe gain on a catalogue of famous films, and the genre words
 * made set mode far too liberal ("a comedy" lit 78 films instead of 33). So none.
 * `summary`, `director` and `cast` are sent only in the small second-pass request
 * over a handful of films (see lib/inspect.ts).
 */
export const STATE_FIELDS: readonly ("director" | "genre" | "cast")[] = [];

/**
 * Brief item 7, measured and rejected: sending only the first `;`-clause of each
 * hook (16 → 10.5 words) saves 2.6k tokens and ~65 ms p50 (463 → 399 ms), but the
 * clause after the semicolon holds the scenes, quotes and actor names. On the probe
 * the preset floor broke (Up 99% → 89%), "fava beans and a nice chianti" fell from
 * 98% to nothing mode, and the other quote probes lost 14–16 points
 * (scripts/probe-results/step3-halfhooks.json). Full hooks stay.
 */
export const HALF_HOOKS = false;

const hookOf = (m: Movie) => (HALF_HOOKS ? m.hook.split(";")[0].trim() : m.hook);

function slim(m: Movie): JsonValue {
  const out: Record<string, JsonValue> = { id: m.id, title: m.title, year: m.year, hook: hookOf(m) };
  for (const f of STATE_FIELDS) {
    const v = m[f];
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    // Arrays are joined: "action, neo-noir" costs fewer tokens than a JSON array and reads the same.
    out[f] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

/**
 * State sent with every request. The catalogue is the same each time; only
 * `description` changes. A Choice takes at most 255 options, so the catalogue is
 * split into `movies_a`, `movies_b`, … of equal size and each chunk gets its own
 * Choice; a small "which list holds it" Choice gives the weights code merges with.
 */
export function findState(description: string, previous: Previous | null = null, earlier: string[] = []) {
  const state: Record<string, JsonValue> = { description };
  if (previous) {
    // A follow-up ("no, the sequel") is read against the answer it refers to. The id stays
    // server-side; the model gets what a person would say about the film.
    state.previous_answer = { title: previous.title, year: previous.year, ...(previous.director ? { director: previous.director } : {}) };
    if (earlier.length) state.earlier_turns = earlier.slice(-3);
  }
  CHUNKS.forEach((chunk, i) => (state[chunkKey(i)] = chunk.map(slim)));
  return state;
}

/** The answer a follow-up refers to. */
export type Previous = { id: string; title: string; year: number; director?: string };

/** How the previous answer is named inside question text: inline, never as a state path (see fitQuestions). */
export const prevText = (p: Previous) => `"${p.title}" (${p.year}${p.director ? `, ${p.director}` : ""})`;

export const chunkKey = (i: number) => `movies_${String.fromCharCode(97 + i)}`;

/** Thresholds chosen on the tuning two-thirds of scripts/probe.mjs; see docs/robustness-report.md. */
export const THRESHOLDS = {
  /** Below this merged `exists` the wall stays flat even when the router says "specific". */
  exists: 0.15,
  /** A film is "in the set" when its fit Noul is at least this. */
  fit: 0.7,
  /** The exclusion Choice must put at least this much on one film before code zeroes it. */
  exclude: 0.5,
} as const;

const WHICH_GUIDANCE =
  "The description is typed live and may be partial, vague, misremembered, or a half-finished sentence. Match on plot, characters, scenes, imagery, actors, era, tone, or a quoted line. Pick the single best fit; spread probability across films when several fit equally.";

/**
 * Every question that only needs the description and the catalogue goes in one
 * call (speculative fan-out). Code reads `router` and consumes the matching answers:
 * finder mode uses the merged `which`, set mode asks for the per-film fits in a
 * second request, nothing mode keeps the wall flat. `exclude` is speculative: it is
 * read every call and only matters when the description rules a film out.
 */
export function buildFindQuestions(previous: Previous | null = null) {
  const q: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
  const pt = previous ? prevText(previous) : null;
  // With a previous answer, relative references ("the sequel", "same director but older",
  // "the other Tom Hanks one") resolve against that film. The title is inline in the
  // question text: with 250+ films in state Jev resolves a state path unreliably.
  const relative = pt
    ? ` 'the sequel', 'the one before it', 'the other one', 'same director but older', 'the other <actor> one' are relative to ${pt}: resolve them against that film's series, director, cast and year.${
        previous?.director ? ` 'Same director' means another film directed by ${previous.director}, not a film from the same year.` : ""
      } If the description rejects ${pt}, do not pick it.`
    : "";
  CHUNKS.forEach((chunk, i) => {
    const key = chunkKey(i);
    // Options are the movie ids with no description: the catalogue in state already
    // carries each film's meaning, as the line-by-line search cookbook does with line ids.
    const options = Object.fromEntries(chunk.map((m) => [m.id, null])) as Record<string, null>;
    q[`which_${i}`] = choice(
      {
        question: pt
          ? `Which film in \`${key}\` is the person describing in \`description\`? Their last answer was ${pt}; the description may be a correction relative to it.`
          : `Which film in \`${key}\` is the person describing in \`description\`?`,
        guidance: WHICH_GUIDANCE + relative,
      },
      options,
    );
    q[`exclude_${i}`] = choice(
      {
        question: `Which film in \`${key}\` does \`description\` explicitly rule out?`,
        guidance:
          "Only a film the description names or clearly points at and then rejects with words like 'not', 'isn't', 'other than', 'but not', 'except'. If the description contains no such rejection, answer none.",
      },
      { none: "The description does not rule out any film in this list", ...options },
    );
  });
  const lists = CHUNKS.map((_, i) => `\`${chunkKey(i)}\``);
  q.exists = noul(`Does \`description\` recognisably describe at least one film in ${lists.join(" or ")}?`, {
    true: pt
      ? `The description clearly points to a specific film, or a small set of films, in the catalogue, or is a refinement of ${pt} ('the sequel', 'the other one', 'same director') that names one`
      : "The description clearly points to a specific film, or a small set of films, in the catalogue",
    false: "The description is too short to mean anything yet, is not about a film, or describes a film that is not in the catalogue",
  });
  if (CHUNKS.length > 1) {
    // Relative, not absolute: a per-chunk "matches anything" Noul gave ~0.3 to the
    // chunk that did not hold the film, which leaked a quarter of the probability
    // mass. A Choice over the lists sums to 1 and is exactly the merge weight.
    q.chunk = choice(
      {
        question: "Which list holds the film that `description` is describing?",
        guidance: "If several films fit, pick the list holding the best fit. If nothing in any list fits, answer neither.",
      },
      {
        ...Object.fromEntries(CHUNKS.map((_, i) => [chunkKey(i), null])),
        neither: "No film in any list fits the description",
      },
    );
  }
  q.router = choice(
    {
      question: "What kind of search is `description`?",
      guidance: "Judge the description as typed, not any particular film.",
    },
    {
      specific: {
        what: "The person is trying to find one particular film they have in mind",
        signals: [
          "a plot detail, scene, character, quoted line, actor, or title fragment that only one or two films share",
          "'the one where…'",
          ...(pt ? [`a relative reference to ${pt}: 'the sequel', 'the other one', 'same director', 'no, the…'`] : []),
        ],
      },
      set: {
        what: "The person is asking for any films of a kind: a genre, mood, style, studio, director, era, or audience",
        signals: ["'a comedy'", "'scary movies'", "'the funny one'", "'something with…' when many films qualify", "'films by…'"],
      },
      nothing: {
        what: "The description is too short to mean anything yet, is gibberish, or is not about films at all",
        signals: ["a single common word", "random letters", "a question about something other than films"],
      },
    },
  );
  if (previous && pt) {
    // Read every call with a previous answer; code zeroes that film when it fires.
    q.rejects_previous = noul(`Does \`description\` reject or move away from the previous answer ${pt}?`, {
      true: "It refers back to the previous answer and asks for a different film: 'no', 'not that one', 'the other one', 'the sequel', 'the first one', 'same director but…'",
      false: "It confirms the previous answer, adds detail about the same film, or is a fresh description or genre request that does not refer back to it ('a comedy', 'something scary')",
    });
  }
  return q;
}

export const findQuestions = buildFindQuestions();

/** The question set for a request: cached when there is no previous answer, built per request otherwise (cheap). */
export const questionsFor = (previous: Previous | null) => (previous ? buildFindQuestions(previous) : findQuestions);

type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type NoulAnswer = { noul: number };

export interface Merged {
  probabilities: Record<string, number>;
  top: string;
  confidence: number;
  exists: number;
  excluded: string | null;
  excludedP: number;
  /** P(the description moves away from the previous answer); null without one. */
  rejectsPrevious: number | null;
}

/**
 * Merge the per-chunk answers. Each film's probability is its chunk-relative
 * probability times the chunk's weight from the "which list" Choice, then
 * renormalised, so a chunk that holds nothing relevant cannot crown a film just
 * because its Choice sums to 1. The excluded film is zeroed before renormalising.
 */
export function mergeAnswers(answers: Record<string, unknown>, previous: Previous | null = null): Merged {
  const raw: Record<string, number> = {};
  const exists = (answers.exists as NoulAnswer).noul;
  const chunkP = (answers.chunk as ChoiceAnswer | undefined)?.probabilities;
  let confidence = 0;
  let excluded: string | null = null;
  let excludedP = 1;
  CHUNKS.forEach((chunk, i) => {
    const which = answers[`which_${i}`] as ChoiceAnswer;
    const exclude = answers[`exclude_${i}`] as ChoiceAnswer;
    const weight = chunkP ? chunkP[chunkKey(i)] ?? 0 : 1;
    for (const m of chunk) raw[m.id] = (which.probabilities[m.id] ?? 0) * weight;
    if (weight > 0 && which.confidence * weight > confidence) confidence = which.confidence * weight;
    const [id, p] = Object.entries(exclude.probabilities).reduce((a, b) => (b[1] > a[1] ? b : a));
    if (id !== "none" && p >= THRESHOLDS.exclude && (excluded === null || p > excludedP)) {
      excluded = id;
      excludedP = p;
    }
    if (excluded === null) excludedP = Math.min(excludedP, exclude.probabilities.none ?? 0);
  });
  // "No, not that one": the previous answer is ruled out the same way a named film is.
  const rejectsPrevious = previous ? ((answers.rejects_previous as NoulAnswer | undefined)?.noul ?? 0) : null;
  if (previous && rejectsPrevious !== null && rejectsPrevious >= THRESHOLDS.exclude) {
    raw[previous.id] = 0;
    if (excluded === null) {
      excluded = previous.id;
      excludedP = rejectsPrevious;
    }
  }
  if (excluded) raw[excluded] = 0;
  const sum = Object.values(raw).reduce((s, v) => s + v, 0) || 1;
  const probabilities: Record<string, number> = {};
  for (const m of MOVIES) probabilities[m.id] = raw[m.id] / sum;
  const top = MOVIES.reduce((a, b) => (probabilities[b.id] > probabilities[a.id] ? b : a)).id;
  return { probabilities, top, confidence, exists, excluded, excludedP, rejectsPrevious };
}

/**
 * One Noul per film for set mode. The title sits inside the question rather than a
 * `movies_a[i]` path: with 250+ films in state Jev resolves an index unreliably (the
 * jaggedness page's indirection failure) but answers a named film well. These
 * questions add ~330 ms to a call regardless of state size, so they live in their
 * own request that the page only sends when the router says "set".
 */
export function fitQuestions(movies: Movie[] = MOVIES) {
  return Object.fromEntries(
    movies.map((m) => [m.id, noul(`Does the film "${m.title}" (${m.year}) fit what \`description\` is asking for?`)]),
  ) as Record<string, ReturnType<typeof noul>>;
}

/** The router's answer, guarded by the existing exists floor so nonsense stays flat. */
export function decideMode(router: Record<string, number>, exists: number): Mode {
  const best = (Object.keys(router) as (keyof typeof router)[]).reduce((a, b) => (router[b] > router[a] ? b : a));
  if (best === "nothing") return "nothing";
  if (best === "set") return "set";
  return exists >= THRESHOLDS.exists ? "finder" : "nothing";
}
