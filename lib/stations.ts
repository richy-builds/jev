import raw from "@/data/stations.json";
import graphRaw from "@/data/tube-graph.json";

export interface Station {
  /** TfL naptan id, e.g. 940GZZLUOXC. */
  id: string;
  name: string;
  lines: string[];
  zone: number;
  lat: number;
  lon: number;
  /** Schematic map position in the 1000×800 viewBox (scripts/build-stations.mjs). */
  x: number;
  y: number;
  hub: string | null;
  /** In the ≤250-station Choice; outer ends are drawn but never ranked. */
  candidate: boolean;
  pois: Record<string, number> | null;
  /** What Jev reads per station: nearby places and the kind of area. */
  hook: string;
  draft: string;
}

export interface TubeGraph {
  lines: { id: string; name: string }[];
  nodes: string[];
  /** Undirected. `line` is a TfL line id or "walk" for an out-of-station interchange. */
  edges: { a: string; b: string; line: string; mins: number }[];
  interchangeMins: number;
}

export const STATIONS: Station[] = raw as Station[];
export const CANDIDATES: Station[] = STATIONS.filter((s) => s.candidate);
export const STATION_BY_ID: Record<string, Station> = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
export const GRAPH: TubeGraph = graphRaw as TubeGraph;

export const MAP_W = 1000;
export const MAP_H = 800;

/** TfL line colours, lifted where the official one vanishes on a dark background: Northern is white (its black), Jubilee a darker steel so the two never read as the same grey, Piccadilly brightened. */
export const LINE_COLOURS: Record<string, string> = {
  bakerloo: "#B36305",
  central: "#E32017",
  circle: "#FFD300",
  district: "#00A54F",
  "hammersmith-city": "#F3A9BB",
  jubilee: "#7D8796",
  metropolitan: "#9B0056",
  northern: "#FFFFFF",
  piccadilly: "#2E6FD8",
  victoria: "#0098D4",
  "waterloo-city": "#95CDBA",
  walk: "#4b5064",
};

/** Official TfL colours for the light schematic: Northern back to black, Jubilee its steel grey, Piccadilly its deep blue, a pale walk; the rest as above. `LINE_COLOURS` is untouched, so the dark theme, the OG image and the recording render as before. */
export const LINE_COLOURS_LIGHT: Record<string, string> = { ...LINE_COLOURS, northern: "#000000", jubilee: "#A0A5A9", piccadilly: "#003688", walk: "#9aa0b0" };

export type Theme = "dark" | "light";

/** A line's colour for the theme; an unknown line gets a neutral grey. */
export const lineColour = (id: string | null | undefined, theme: Theme = "dark"): string => (id && (theme === "light" ? LINE_COLOURS_LIGHT : LINE_COLOURS)[id]) || "#8b90a5";

/** Lines whose colour is pale enough that text on it must be dark (Circle, H&C, W&C, and the dark-lifted white Northern). */
export const DARK_ON = new Set(["circle", "hammersmith-city", "waterloo-city", "northern"]);
/** The same for the light palette: Northern is black again, Jubilee's grey is pale. */
export const DARK_ON_LIGHT = new Set(["circle", "hammersmith-city", "waterloo-city", "jubilee"]);

/** Text colour on a line-coloured chip or tag. */
export const lineText = (id: string, theme: Theme = "dark"): string => ((theme === "light" ? DARK_ON_LIGHT : DARK_ON).has(id) ? "#0f1118" : "#ffffff");

export const LINE_NAMES: Record<string, string> = Object.fromEntries(GRAPH.lines.map((l) => [l.id, l.name.replace(/ line$/i, "")]));

export const lineName = (id: string) => LINE_NAMES[id] ?? id;

export type Origin = { id: string; label?: string };

/** Wire shape returned by /api/meet/find. */
export interface MeetFindResponse {
  /** Per candidate station id; sums to ~1 over the stations sent, after exclusion. */
  probabilities: Record<string, number>;
  top: string;
  confidence: number;
  /** Probability the description asks for a recognisable kind of place at all. */
  exists: number;
  excluded: string | null;
  /** Every station zeroed by the exclusion (an area can span two stations) plus a rejected previous pick. */
  excludedIds: string[];
  excludedP: number;
  /** Travel budget the description states, if any. */
  budget: { mins: number | null; p: number };
  rejectsPrevious: number | null;
  /** The kind of place and cuisine the description names (null for none), with each winning option's probability. */
  venue: { kind: string | null; kindP: number; cuisine: string | null; cuisineP: number };
  latencyMs: number;
  model: string;
  candidates: number;
  tokens: number | null;
}

/** Wire shape of /api/meet/find in locate mode: which candidate station is nearest a named place. */
export interface MeetLocateResponse {
  probabilities: Record<string, number>;
  top: string;
  confidence: number;
  exists: number;
  latencyMs: number;
  model: string;
  candidates: number;
  tokens: number | null;
}

/** Wire shape returned by /api/meet/status. */
export type LineStatus = Record<
  string,
  {
    severity: number;
    description: string;
    reason: string;
    simulated?: boolean;
    /** Station pairs the reason text says have no service (lib/closures.ts); the graph cuts those edges instead of penalising the whole line. */
    closedBetween?: [string, string][];
  }
>;

/** "St. John's Wood" → "St. John's", "King's Cross St. Pancras" → "King's Cross", "Walthamstow Central" → "Walthamstow". Pure, so the OG image can use it. */
export function shortName(name: string): string {
  const n = name.replace(/\s*\(.*\)$/, "").replace(/ St\. Pancras$/, "").replace(/ (Central|Broadway|Common|Park|Town|Green|Road|Street|Square|Circus|Hill)$/, (m) => (name.split(" ").length > 2 ? "" : m));
  const words = n.split(" ");
  return words[0].length <= 3 && words.length > 1 ? `${words[0]} ${words[1]}` : words[0];
}
