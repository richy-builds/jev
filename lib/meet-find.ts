import { choice, noul, type JsonValue } from "@typesafe-ai/sdk";
import { CANDIDATES, STATION_BY_ID, lineName, type Station } from "@/lib/stations";

/**
 * The question set for /api/meet/find, following lib/find.ts: a `which` Choice over
 * station ids with null descriptions (the station catalogue in state carries the
 * meaning), a speculative `exclude` Choice with `none`, an `exists` Noul that keeps the
 * map flat for nonsense, and a `budget` Choice that reads a travel limit out of the
 * description. One chunk only: the candidate list is ≤ 250 by construction
 * (scripts/build-stations.mjs), so there is no chunk merge.
 *
 * Travel time is never in state (find.ts's STATE_FIELDS lesson: +7k tokens and no gain,
 * and arithmetic over 237 rows is unreliable). Code filters the candidates by budget
 * before the call and weights the answer by fairness after it.
 */

/** What Jev reads per station: name, lines, zone and the hook. ≈ 35 tokens each. */
function slim(s: Station): JsonValue {
  return { id: s.id, name: s.name, lines: s.lines.map(lineName).join(", "), zone: s.zone, hook: s.hook };
}

/** The pick a follow-up refers to ("no, somewhere quieter"). */
export type Previous = { id: string; name: string };

/** How the previous pick is named inside question text: inline, never as a state path. */
export const prevText = (p: Previous) => `"${p.name}"`;

/** Thresholds chosen on the tuning two-thirds of scripts/probe-meet.mjs. */
export const THRESHOLDS = {
  /** Below this `exists` the map stays flat. */
  exists: 0.15,
  /** The exclusion Choice must put at least this much on one station before code zeroes it. */
  exclude: 0.5,
  /** Further stations are zeroed too when they carry at least this share of the exclusion and `none` is below 0.5. */
  excludeAlso: 0.2,
  /** The budget Choice must be this sure before the client adopts a stated limit. */
  budget: 0.5,
  /** The venue kind / cuisine Choices must be this sure before a chip shows (and, later, before venues filter on it). */
  venue: 0.5,
} as const;

export const BUDGET_OPTIONS = [20, 30, 45, 60] as const;

/** What the description asks for, read back as chips: the kind of place and the cuisine, each with `none`. */
export const VENUE_KINDS = {
  none: "The description does not name a kind of place, or names only an area or an activity",
  pub: "A pub, beer garden, boozer, tavern or drinks in a pub",
  bar: "A bar, cocktails, wine bar, nightlife or clubbing",
  restaurant: "A restaurant, dinner, lunch, eating out, a named cuisine or dish",
  cafe: "A café, coffee, brunch, breakfast, tea or cake",
  park: "A park, a walk, the heath, a common, outdoors, a picnic",
  culture: "A museum, gallery, theatre, cinema, a gig or live music, an exhibition",
  market: "A market, street food, food stalls, vintage or flea stalls",
} as const;

export const CUISINES = {
  none: "The description names no cuisine or national food",
  italian: "Italian, pasta",
  indian: "Indian, curry, a curry house",
  japanese: "Japanese, sushi, ramen",
  chinese: "Chinese, dim sum, Chinatown food",
  thai: "Thai",
  vietnamese: "Vietnamese, pho, banh mi",
  korean: "Korean, Korean barbecue",
  mexican: "Mexican, tacos",
  turkish: "Turkish, kebab, ocakbaşı",
  middle_eastern: "Middle Eastern, Lebanese, Persian, mezze, falafel",
  british: "British, a roast, gastropub food, fish and chips",
  french: "French, a bistro",
  spanish: "Spanish, tapas",
  pizza: "Pizza",
  burger: "Burgers",
  vegan: "Vegan or vegetarian food",
} as const;

export type VenueKind = Exclude<keyof typeof VENUE_KINDS, "none">;
export type Cuisine = Exclude<keyof typeof CUISINES, "none">;

/** Whether the origin names go into state. Toggle under measurement: see the note in `meetState`. */
export const ORIGINS_IN_STATE = false;

export function meetState(description: string, origins: string[], stations: Station[], previous: Previous | null = null, earlier: string[] = []) {
  const state: Record<string, JsonValue> = { description };
  if (ORIGINS_IN_STATE && origins.length) state.origins = origins;
  if (previous) {
    state.previous_pick = previous.name;
    if (earlier.length) state.earlier_turns = earlier.slice(-3);
  }
  state.stations = stations.map(slim);
  return state;
}

const WHICH_GUIDANCE =
  "The description is typed live and may be partial, vague, or a half-finished sentence. Match the kind of place (pub, restaurant, park, market, museum, gallery, live music, nightlife), the atmosphere (quiet, lively, fancy, cheap, cosy, family), a named area or neighbourhood, the time of day, and price against each station's hook and what you know of the area around it. 'Central', 'in the middle', 'halfway' prefer central Zone 1 stations. Pick the single best station; spread probability across stations when several fit equally well.";

export function buildMeetQuestions(stations: Station[], previous: Previous | null = null) {
  const q: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
  const pt = previous ? prevText(previous) : null;
  // Options are the station ids with no description: the catalogue in state already
  // carries each station's meaning (find.ts does the same with movie ids).
  const options = Object.fromEntries(stations.map((s) => [s.id, null])) as Record<string, null>;
  const who = ORIGINS_IN_STATE ? "the people in `origins`" : "a group of friends";
  const relative = pt
    ? ` The previous pick was ${pt}; 'somewhere quieter', 'further east', 'not there', 'same area but cheaper' are relative to it. If the description rejects ${pt}, do not pick it.`
    : "";
  q.which = choice(
    {
      question: pt
        ? `Which station in \`stations\` should ${who} meet at for what \`description\` asks for? Their last pick was ${pt}; the description may be a correction relative to it.`
        : `Which station in \`stations\` should ${who} meet at for what \`description\` asks for?`,
      guidance: WHICH_GUIDANCE + relative,
    },
    options,
  );
  q.exclude = choice(
    {
      question: `Which station in \`stations\` does \`description\` explicitly rule out?`,
      guidance:
        "Only a station, or the area it serves, that the description names and rejects with words like 'not', 'anywhere but', 'no', 'except', 'avoid'. 'Not Shoreditch' rules out the station whose hook is Shoreditch; when a rejected area or market is in more than one station's hook, spread the probability across all of them. If the description contains no such rejection, answer none.",
    },
    { none: "The description does not rule out any station or area", ...options },
  );
  q.exists = noul(`Does \`description\` ask for a recognisable kind of place, area or outing that a station in \`stations\` could be matched to?`, {
    true: pt
      ? `It names a kind of venue, an atmosphere, an activity, an area of London, or a refinement of ${pt} ('quieter', 'further east', 'not there')`
      : "It names a kind of venue (pub, dinner, park, market, gallery), an atmosphere (quiet, lively, fancy, cheap), an activity (walk, gig, brunch), or an area of London",
    false: "It is too short to mean anything yet, is random letters, or is not about where to go or meet",
  });
  q.budget = choice(
    {
      question: "How long does `description` say each person may travel, in minutes?",
      guidance:
        "Only a limit the description states: 'under 35 min', 'max half an hour', 'nobody travels more than 45 minutes', '20 mins tops'. Pick the option closest to the stated number. If the description states no travel limit, answer none.",
    },
    {
      none: "The description does not state how long anyone may travel",
      ...Object.fromEntries(BUDGET_OPTIONS.map((m) => [String(m), `About ${m} minutes each`])),
    },
  );
  // Read-back chips: the kind of place and the cuisine the text names. These read the description
  // only, never `stations`, so they do not compete with `which` for the station catalogue.
  q.venue_kind = choice(
    {
      question: "What kind of place does `description` ask for?",
      guidance:
        "Read the words of `description` only, not `stations`. Pick the kind of venue it names or clearly implies ('a pint' is pub, 'dinner' or a cuisine is restaurant, 'brunch' is cafe, 'a walk' is park, 'a gig' is culture, 'street food' is market). An area, a vibe or a travel limit alone is none. When it names two kinds, pick the one the outing is for.",
    },
    VENUE_KINDS,
  );
  q.cuisine = choice(
    {
      question: "Which cuisine, if any, does `description` name?",
      guidance: "Read the words of `description` only, not `stations`. Only a cuisine or national food the text names or a dish that belongs to one ('curry' is indian, 'sushi' is japanese, 'tapas' is spanish, 'mezze' is middle_eastern). A kind of venue with no cuisine ('pub', 'dinner', 'nice restaurant') is none.",
    },
    CUISINES,
  );
  if (previous && pt) {
    q.rejects_previous = noul(`Does \`description\` reject or move away from the previous pick ${pt}?`, {
      true: "It refers back to the previous pick and asks for somewhere else: 'no', 'not there', 'somewhere else', 'quieter than that', 'further out'",
      false: "It confirms the previous pick, adds detail about the same outing, or is a fresh description that does not refer back to it",
    });
  }
  return q;
}

/** Locate mode: the origin picker's fallback for a fuzzy place ("near the Emirates", "the Barbican"). Candidates only: all 272 would exceed the 255-option cap. */
export function buildLocateQuestions(stations: Station[] = CANDIDATES) {
  const options = Object.fromEntries(stations.map((s) => [s.id, null])) as Record<string, null>;
  return {
    where: choice(
      {
        question: "Which station in `stations` is nearest to the place named in `description`?",
        guidance: "The description names a place, landmark, venue, street or neighbourhood in London. Pick the station a Londoner would use to get there; spread probability when two are equally close.",
      },
      options,
    ),
    exists: noul("Does `description` name a place in London that a station could be nearest to?", {
      true: "A landmark, venue, street, neighbourhood or station name, possibly misspelt or partial",
      false: "Too short to tell, random letters, or not a place",
    }),
  };
}

type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
type NoulAnswer = { noul: number };

export interface Merged {
  probabilities: Record<string, number>;
  top: string;
  confidence: number;
  exists: number;
  excluded: string | null;
  excludedIds: string[];
  excludedP: number;
  budget: { mins: number | null; p: number };
  rejectsPrevious: number | null;
  /** The kind of place and cuisine the description names (null for `none`), with the winning option's probability. */
  venue: { kind: VenueKind | null; kindP: number; cuisine: Cuisine | null; cuisineP: number };
}

/**
 * Reads the answers for the stations that were sent. Excluded stations are zeroed
 * before renormalising. "Not Soho" can split the exclusion between two stations that
 * both serve Soho, so a second tier below the top exclusion is zeroed as well as long
 * as `none` is not the majority.
 */
export function mergeMeetAnswers(answers: Record<string, unknown>, stations: Station[], previous: Previous | null = null): Merged {
  const which = answers.which as ChoiceAnswer;
  const exclude = answers.exclude as ChoiceAnswer;
  const exists = (answers.exists as NoulAnswer).noul;
  const budgetA = answers.budget as ChoiceAnswer;
  const raw: Record<string, number> = {};
  for (const s of stations) raw[s.id] = which.probabilities[s.id] ?? 0;

  const noneP = exclude.probabilities.none ?? 0;
  const ranked = Object.entries(exclude.probabilities)
    .filter(([id]) => id !== "none")
    .sort((a, b) => b[1] - a[1]);
  let excluded: string | null = null;
  let excludedP = noneP;
  const excludedIds: string[] = [];
  if (ranked.length && noneP < 0.5) {
    const [id, p] = ranked[0];
    if (p >= THRESHOLDS.exclude || p >= THRESHOLDS.excludeAlso) {
      excluded = id;
      excludedP = p;
      for (const [rid, rp] of ranked) if (rp >= THRESHOLDS.excludeAlso) excludedIds.push(rid);
    }
  }
  const rejectsPrevious = previous ? ((answers.rejects_previous as NoulAnswer | undefined)?.noul ?? 0) : null;
  if (previous && rejectsPrevious !== null && rejectsPrevious >= THRESHOLDS.exclude) {
    excludedIds.push(previous.id);
    if (excluded === null) {
      excluded = previous.id;
      excludedP = rejectsPrevious;
    }
  }
  for (const id of excludedIds) raw[id] = 0;
  const sum = Object.values(raw).reduce((s, v) => s + v, 0) || 1;
  const probabilities: Record<string, number> = {};
  for (const s of stations) probabilities[s.id] = raw[s.id] / sum;
  const top = stations.reduce((a, b) => (probabilities[b.id] > probabilities[a.id] ? b : a), stations[0]).id;

  const [bOpt, bP] = Object.entries(budgetA.probabilities).reduce((a, b) => (b[1] > a[1] ? b : a));
  const budget = bOpt === "none" ? { mins: null, p: bP } : { mins: Number(bOpt), p: bP };

  const argmax = (a: ChoiceAnswer | undefined): [string, number] => (a ? Object.entries(a.probabilities).reduce((x, y) => (y[1] > x[1] ? y : x), ["none", 0]) : ["none", 0]);
  const [kOpt, kP] = argmax(answers.venue_kind as ChoiceAnswer | undefined);
  const [cOpt, cP] = argmax(answers.cuisine as ChoiceAnswer | undefined);
  const venue = {
    kind: kOpt !== "none" && kOpt in VENUE_KINDS ? (kOpt as VenueKind) : null,
    kindP: kP,
    cuisine: cOpt !== "none" && cOpt in CUISINES ? (cOpt as Cuisine) : null,
    cuisineP: cP,
  };

  return { probabilities, top, confidence: which.confidence, exists, excluded, excludedIds, excludedP, budget, rejectsPrevious, venue };
}

/** Resolves a list of ids to candidate stations, dropping unknown or non-candidate ids. */
export function candidateStations(ids: unknown): Station[] {
  if (!Array.isArray(ids)) return CANDIDATES;
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id)) continue;
    const s = STATION_BY_ID[id];
    if (s?.candidate) {
      seen.add(id);
      out.push(s);
    }
  }
  return out;
}
