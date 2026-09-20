import { NextResponse } from "next/server";
import { APIUserAbortError, choice } from "@typesafe-ai/sdk";
import { client } from "@/lib/typesafe";
import { STATION_BY_ID, type Station } from "@/lib/stations";
import {
  ANCHOR_M,
  CUISINE_LABEL,
  KIND_LABEL,
  RADIUS_M,
  isVenueAmenity,
  pickBestMatch,
  poisFromOverpass,
  venuesKey,
  venuesNear,
  type OverpassElement,
  type Poi,
  type Venue,
  type VenueAmenity,
  type VenuesResponse,
} from "@/lib/venues";

export const runtime = "nodejs";

const OVERPASS = "https://overpass-api.de/api/interpreter";
// overpass-api.de answers 406 to requests with no User-Agent (scripts/build-stations.mjs).
const UA = "jev-meet/1.0 (github.com/richyjudge; contact via repo)";
const OVERPASS_TIMEOUT_MS = 10_000;
const JEV_TIMEOUT_MS = 8_000;

/** Raw places per station: Overpass is slow and rate-limited, the places barely change. */
const POI_TTL_MS = 6 * 60 * 60 * 1000;
const POI_CAP = 200;
const pois = new Map<string, { at: number; list: Poi[] }>();
/** One Overpass call per station at a time: concurrent requests for the same station share it. */
const inflight = new Map<string, Promise<Poi[]>>();
/** Ranked results per station and intent. */
const RANKED_TTL_MS = 10 * 60 * 1000;
const RANKED_CAP = 500;
const ranked = new Map<string, { at: number; res: Omit<VenuesResponse, "latencyMs" | "cached"> }>();

function remember<V>(map: Map<string, { at: number } & V>, key: string, value: V, cap: number) {
  map.delete(key);
  map.set(key, { at: Date.now(), ...value });
  // Insertion order is age: drop the oldest past the cap.
  while (map.size > cap) map.delete(map.keys().next().value as string);
}

async function fetchPois(s: Station): Promise<Poi[]> {
  const hit = pois.get(s.id);
  if (hit && Date.now() - hit.at < POI_TTL_MS) return hit.list;
  const running = inflight.get(s.id);
  if (running) return running;
  const q = `[out:json][timeout:${OVERPASS_TIMEOUT_MS / 1000}];nwr(around:${RADIUS_M},${s.lat},${s.lon})[amenity~"^(pub|bar|restaurant|cafe)$"][name];out center tags;`;
  const attempt = async () => {
    const res = await fetch(OVERPASS, {
      method: "POST",
      body: `data=${encodeURIComponent(q)}`,
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    return (await res.json()) as { elements?: OverpassElement[] };
  };
  const p = (async () => {
    let data: { elements?: OverpassElement[] };
    try {
      data = await attempt();
    } catch (err) {
      // The public instance sheds load with 504s and 429s at busy times (about half of cold
      // fetches in one measured session); one more try, on its own 10 s clock, before "no venue data".
      console.warn("[meet/venues] overpass retry:", err instanceof Error ? err.message : err);
      data = await attempt();
    }
    const list = poisFromOverpass(data.elements ?? []);
    remember(pois, s.id, { list }, POI_CAP);
    return list;
  })();
  inflight.set(s.id, p);
  try {
    return await p;
  } finally {
    inflight.delete(s.id);
  }
}

/**
 * Jev ranks the candidate venues against the description (the pattern of
 * app/api/meet/find/route.ts: a Choice over ids with null descriptions, the catalogue in
 * state carries the meaning). Returns the venues in rank order, or null when the call
 * fails or times out so the caller can fall back to distance.
 */
async function rankVenues(venues: Venue[], q: string, near: Station | null, signal: AbortSignal): Promise<Venue[] | null> {
  const state = {
    description: q,
    ...(near ? { near: near.name } : {}),
    venues: venues.map((v) => ({ id: v.id, name: v.name, kind: KIND_LABEL[v.kind] ?? v.kind, cuisine: v.cuisine.map((c) => CUISINE_LABEL[c] ?? c).join(", ") || null, walk: `${v.walkMin} min`, hours: v.hours })),
  };
  const options = Object.fromEntries(venues.map((v) => [v.id, null])) as Record<string, null>;
  const questions = {
    which: choice(
      {
        question: "Which place in `venues` best fits what `description` asks for?",
        guidance:
          "Match the kind of place, the cuisine, the atmosphere (quiet, lively, fancy, cheap, cosy), the occasion and the time of day the description asks for against each venue's name, kind, cuisine and hours; what you know of a named venue counts. When `near` names a place, prefer venues that sound like they are there. Among places that fit equally, prefer the shorter walk. Spread probability across venues that fit equally well.",
      },
      options,
    ),
  };
  try {
    const res = await client.systemOne({ state, questions }, { signal, timeout: JEV_TIMEOUT_MS, retry: { maxRetries: 0 } });
    const p = res.answers.which.probabilities;
    return [...venues].sort((a, b) => (p[b.id] ?? 0) - (p[a.id] ?? 0) || a.distM - b.distM);
  } catch (err) {
    if (err instanceof APIUserAbortError || (err as Error)?.name === "AbortError") throw err;
    console.error("[meet/venues] rank failed, sorting by distance:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * POST { station: naptan, kind?: pub|bar|restaurant|cafe, cuisine?: string, near?: naptan, q?: string }
 * Places within a short walk of the committed station, filtered by what the description
 * asked for and ranked by Jev against it. Never affects the station ranking. Overpass
 * failing is a 200 with `source: "none"`; Jev failing sorts by distance and says so.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const station = typeof body.station === "string" ? STATION_BY_ID[body.station] : undefined;
  if (!station) return NextResponse.json({ error: "station must be a known naptan id" }, { status: 400 });
  const kind: VenueAmenity | null = isVenueAmenity(body.kind) ? body.kind : null;
  const cuisine = typeof body.cuisine === "string" && /^[a-z_]{1,32}$/.test(body.cuisine) ? body.cuisine : null;
  const near = typeof body.near === "string" ? (STATION_BY_ID[body.near] ?? null) : null;
  const q = typeof body.q === "string" ? body.q.trim().slice(0, 300) : "";
  const key = venuesKey(station.id, kind, cuisine, near?.id ?? null, q);
  const started = performance.now();
  const reply = (res: Omit<VenuesResponse, "latencyMs" | "cached">, cached: boolean) =>
    NextResponse.json({ ...res, latencyMs: Math.round(performance.now() - started), cached } satisfies VenuesResponse, { headers: { "cache-control": "no-store" } });

  const hit = ranked.get(key);
  if (hit && Date.now() - hit.at < RANKED_TTL_MS) return reply(hit.res, true);

  let list: Poi[];
  try {
    list = await fetchPois(station);
  } catch (err) {
    console.error("[meet/venues] overpass:", err instanceof Error ? err.message : err);
    return reply({ venues: [], source: "none", bestMatch: null }, false);
  }
  const { venues, note } = venuesNear(list, station, { kind, cuisine });
  let order = venues;
  let source: VenuesResponse["source"] = "distance";
  if (venues.length > 1 && q) {
    try {
      const byJev = await rankVenues(venues, q, near, req.signal);
      if (byJev) {
        order = byJev;
        source = "jev";
      }
    } catch {
      return new Response(null, { status: 499 });
    }
  }
  // The best match heads the list so the first row is the one to tag. On the kind-only fallback nothing matches the cuisine, so no row is tagged.
  const bestMatch = pickBestMatch(order, { cuisine, station, near });
  if (bestMatch) order = [order.find((v) => v.id === bestMatch)!, ...order.filter((v) => v.id !== bestMatch)];
  // No tag because of the anchor alone (the cuisine matched): say so, or the missing tag reads as a bug.
  const why = note ?? (!bestMatch && near && order.length ? `none within ${ANCHOR_M} m of ${near.name}` : null);
  const res: Omit<VenuesResponse, "latencyMs" | "cached"> = { venues: order, source, bestMatch, ...(why ? { note: why } : {}) };
  remember(ranked, key, { res }, RANKED_CAP);
  return reply(res, false);
}
