import { NextResponse } from "next/server";
import { STATION_BY_ID } from "@/lib/stations";

export const runtime = "nodejs";

export type JourneyLeg = { line: string | null; mode: string; from: string; to: string; mins: number; disrupted: boolean };
export type JourneyResponse = { from: string; to: string; duration: number; legs: JourneyLeg[]; fetchedAt: number };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: JourneyResponse }>();

const stripName = (n: string) => n.replace(/ Underground Station$/i, "").replace(/ Station$/i, "");

type TflLeg = {
  duration: number;
  mode: { id: string };
  departurePoint: { commonName: string };
  arrivalPoint: { commonName: string };
  routeOptions?: { lineIdentifier?: { id: string } }[];
  disruptions?: { category?: string; description?: string }[];
};

/** A leg is disrupted when TfL attaches a service disruption to it; step-free and lift notices are information, not delay. */
const isServiceDisruption = (d: { category?: string; description?: string }) => d.category !== "Information" && !/step[- ]free|lift|escalator/i.test(d.description ?? "");

/**
 * GET /api/meet/journey?from=<naptan>&to=<naptan>: TfL's journey planner, tube and
 * walking, for verifying a pick with real timings. The fastest journey is returned as
 * legs; the geographic path is not (routes are drawn along our own graph). Cached 60 s
 * per pair; `TFL_APP_KEY` is appended server-side when set (anonymous works for dev).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!STATION_BY_ID[from] || !STATION_BY_ID[to]) return NextResponse.json({ error: "from and to must be station ids" }, { status: 400 });
  if (from === to) {
    const body: JourneyResponse = { from, to, duration: 0, legs: [], fetchedAt: Date.now() };
    return NextResponse.json(body);
  }
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body, { headers: { "x-cache": "hit" } });

  const url = new URL(`https://api.tfl.gov.uk/Journey/JourneyResults/${from}/to/${to}`);
  url.searchParams.set("mode", "tube,walking");
  if (process.env.TFL_APP_KEY) url.searchParams.set("app_key", process.env.TFL_APP_KEY);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "user-agent": "jev-meet/0.1" } });
    if (!res.ok) return NextResponse.json({ error: `TfL ${res.status}` }, { status: 502 });
    const data = (await res.json()) as { journeys?: { duration: number; legs: TflLeg[] }[] };
    const best = (data.journeys ?? []).reduce<{ duration: number; legs: TflLeg[] } | null>((a, j) => (!a || j.duration < a.duration ? j : a), null);
    if (!best) return NextResponse.json({ error: "no journey" }, { status: 502 });
    const body: JourneyResponse = {
      from,
      to,
      duration: best.duration,
      legs: best.legs.map((l) => ({
        line: l.routeOptions?.[0]?.lineIdentifier?.id ?? null,
        mode: l.mode.id,
        from: stripName(l.departurePoint.commonName),
        to: stripName(l.arrivalPoint.commonName),
        mins: l.duration,
        disrupted: (l.disruptions ?? []).some(isServiceDisruption),
      })),
      fetchedAt: Date.now(),
    };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "TfL error" }, { status: 502 });
  }
}
