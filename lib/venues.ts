import type { Station } from "@/lib/stations";

/**
 * Venues for the committed station (feature C): OpenStreetMap places within a short
 * walk, filtered by the kind and cuisine the description named, ranked by Jev against
 * the description text. Everything here is pure and SDK-free so the route, the client
 * hook and a node check can all import it; the Overpass call and the ranking live in
 * app/api/meet/venues/route.ts. Nothing here touches the station ranking.
 */

/** The OSM amenities fetched: the four kinds a "meet at" outing is usually for. Other kinds (park, culture, market) get no kind filter. */
export const VENUE_AMENITIES = ["pub", "bar", "restaurant", "cafe"] as const;
export type VenueAmenity = (typeof VENUE_AMENITIES)[number];
export const isVenueAmenity = (k: unknown): k is VenueAmenity => typeof k === "string" && (VENUE_AMENITIES as readonly string[]).includes(k);

/** Search radius round the station, and the walk speed the minutes are quoted at. */
export const RADIUS_M = 600;
export const WALK_M_PER_MIN = 80;
/** A venue this close to the "near <place>" station counts as being there. */
export const ANCHOR_M = 500;
/** At most this many venues go to Jev and back to the client. */
export const VENUE_CAP = 40;

export const KIND_LABEL: Record<string, string> = { pub: "pub", bar: "bar", restaurant: "restaurant", cafe: "café", park: "park", culture: "culture", market: "market" };
export const KIND_PLURAL: Record<string, string> = { pub: "Pubs", bar: "Bars", restaurant: "Restaurants", cafe: "Cafés" };
export const CUISINE_LABEL: Record<string, string> = {
  italian: "Italian",
  indian: "Indian",
  japanese: "Japanese",
  chinese: "Chinese",
  thai: "Thai",
  vietnamese: "Vietnamese",
  korean: "Korean",
  mexican: "Mexican",
  turkish: "Turkish",
  middle_eastern: "Middle Eastern",
  british: "British",
  french: "French",
  spanish: "Spanish",
  pizza: "pizza",
  burger: "burgers",
  vegan: "vegan",
};

/** OSM `cuisine` values that count as each of the finder's cuisines (lib/meet-find.ts CUISINES). */
const CUISINE_TAGS: Record<string, string[]> = {
  italian: ["italian", "pizza", "pasta"],
  indian: ["indian", "curry", "south_indian", "north_indian", "bangladeshi", "pakistani", "nepalese"],
  japanese: ["japanese", "sushi", "ramen", "izakaya"],
  chinese: ["chinese", "cantonese", "sichuan", "dim_sum", "hong_kong", "taiwanese"],
  thai: ["thai"],
  vietnamese: ["vietnamese", "pho"],
  korean: ["korean"],
  mexican: ["mexican", "tacos", "tex-mex"],
  turkish: ["turkish", "kebab", "ocakbasi"],
  middle_eastern: ["middle_eastern", "lebanese", "persian", "iranian", "syrian", "arab", "israeli", "falafel", "mezze", "levantine"],
  british: ["british", "english", "fish_and_chips", "pie", "gastropub"],
  french: ["french", "bistro", "brasserie"],
  spanish: ["spanish", "tapas", "basque"],
  pizza: ["pizza"],
  burger: ["burger", "burgers"],
  vegan: ["vegan", "vegetarian"],
};

/** Haversine distance in km (copied from scripts/build-stations.mjs). */
export const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
export const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => km(a, b) * 1000;

/** One Overpass element as `out center tags;` returns it. */
export type OverpassElement = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** A raw place round a station, as cached per station on the server. */
export type Poi = {
  /** Overpass type letter plus id (`n362501621`): a valid Choice option key. */
  id: string;
  name: string;
  kind: VenueAmenity;
  /** OSM `cuisine`, split on `;`, lower-cased. */
  cuisine: string[];
  hours: string | null;
  lat: number;
  lon: number;
};

/** What the client gets per venue. */
export type Venue = Poi & { distM: number; walkMin: number };

export type VenueSource = "jev" | "distance" | "none";

/** Wire shape returned by /api/meet/venues. `venues` is in rank order with `bestMatch` (an id) first when there is one. */
export interface VenuesResponse {
  venues: Venue[];
  source: VenueSource;
  /** Explains a fallback the client should show: the cuisine had nothing in range. */
  note?: string;
  bestMatch: string | null;
  latencyMs: number;
  cached: boolean;
}

export function poisFromOverpass(elements: OverpassElement[]): Poi[] {
  const out: Poi[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const t = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const kind = t.amenity;
    if (lat == null || lon == null || !t.name || !isVenueAmenity(kind)) continue;
    const id = `${el.type[0]}${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: t.name.slice(0, 80),
      kind,
      cuisine: (t.cuisine ?? "")
        .toLowerCase()
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean),
      hours: t.opening_hours?.slice(0, 200) ?? null,
      lat,
      lon,
    });
  }
  return out;
}

export function matchesCuisine(poi: Pick<Poi, "cuisine">, cuisine: string): boolean {
  const tags = CUISINE_TAGS[cuisine] ?? [cuisine];
  return poi.cuisine.some((c) => tags.includes(c));
}

/**
 * The station's places filtered by kind, then by cuisine; when the cuisine leaves
 * nothing the kind-only list comes back with a note saying so. Nearest first, capped.
 */
export function venuesNear(pois: Poi[], station: Pick<Station, "lat" | "lon">, opts: { kind: VenueAmenity | null; cuisine: string | null }): { venues: Venue[]; note: string | null } {
  const inRange = pois.map((p) => ({ ...p, distM: Math.round(metres(station, p)) })).filter((p) => p.distM <= RADIUS_M);
  const byKind = opts.kind ? inRange.filter((p) => p.kind === opts.kind) : inRange;
  let list = byKind;
  let note: string | null = null;
  if (opts.cuisine) {
    const byCuisine = byKind.filter((p) => matchesCuisine(p, opts.cuisine!));
    if (byCuisine.length) list = byCuisine;
    else note = `no ${CUISINE_LABEL[opts.cuisine] ?? opts.cuisine} within ${RADIUS_M} m`;
  }
  const venues = list
    .sort((a, b) => a.distM - b.distM)
    .slice(0, VENUE_CAP)
    .map((p) => ({ ...p, walkMin: Math.max(1, Math.ceil(p.distM / WALK_M_PER_MIN)) }));
  return { venues, note };
}

/**
 * The row to tag "best match": the first in rank order that matches the cuisine (when
 * one was asked for) and honours a "near <place>" anchor: no anchor, the anchor station
 * is the pick or within ANCHOR_M of it, or the venue itself is within ANCHOR_M of the
 * anchor station. Null when nothing qualifies, so the tag never lies.
 */
export function pickBestMatch(ranked: Venue[], opts: { cuisine: string | null; station: Pick<Station, "id" | "lat" | "lon">; near: Pick<Station, "id" | "lat" | "lon"> | null }): string | null {
  const { cuisine, station, near } = opts;
  const areaNear = !near || near.id === station.id || metres(near, station) <= ANCHOR_M;
  for (const v of ranked) {
    if (cuisine && !matchesCuisine(v, cuisine)) continue;
    if (!areaNear && near && metres(near, v) > ANCHOR_M) continue;
    return v.id;
  }
  return null;
}

/** The ranked-result cache key on the server and the fetch key on the client: one entry per intent per station. */
export const venuesKey = (station: string, kind: string | null, cuisine: string | null, near: string | null, q: string) => `${station}|${kind ?? ""}|${cuisine ?? ""}|${near ?? ""}|${q}`;

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Today's closing time out of an OSM `opening_hours` string, for the card: "till 23:00",
 * "open 24 h", "closed today", or null when the rule cannot be read (the raw string
 * then goes in the tooltip). Handles the common shapes only: `Mo-Fr 12:00-23:00; Sa
 * 12:00-00:00`, `Mo,We 10:00-18:00`, a rule with no days, `24/7`, `off`.
 */
export function hoursToday(hours: string | null, now: Date = new Date()): string | null {
  if (!hours) return null;
  if (/^\s*24\s*\/\s*7\s*$/.test(hours)) return "open 24 h";
  const today = DAYS[now.getDay()];
  const dayIndex = (d: string) => DAYS.indexOf(d[0].toUpperCase() + d.slice(1, 2).toLowerCase());
  let match: string | null = null;
  for (const rule of hours.split(";")) {
    const r = rule.trim();
    if (!r) continue;
    const m = r.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/i);
    if (!m) continue;
    const [, days, rest] = m;
    let applies = !days;
    if (days) {
      for (const part of days.split(",")) {
        const [from, to] = part.trim().split("-");
        const a = dayIndex(from);
        const b = to ? dayIndex(to) : a;
        if (a < 0 || b < 0) continue;
        const t = DAYS.indexOf(today);
        if (a <= b ? t >= a && t <= b : t >= a || t <= b) applies = true;
      }
    }
    if (!applies) continue;
    // A later rule for the same day overrides an earlier one, as in the spec.
    if (/^(off|closed)\b/i.test(rest)) match = "closed today";
    else {
      const times = [...rest.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
      if (!times.length) continue;
      const last = times[times.length - 1];
      match = `till ${last[3].padStart(2, "0")}:${last[4]}`;
    }
  }
  return match;
}
