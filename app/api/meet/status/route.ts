import { NextResponse } from "next/server";
import { parseClosures } from "@/lib/closures";
import { GRAPH, STATIONS, type LineStatus } from "@/lib/stations";

export const runtime = "nodejs";

const TTL_MS = 30_000;
let cache: { at: number; body: LineStatus } | null = null;

type TflStatus = { statusSeverity: number; statusSeverityDescription: string; reason?: string };
type TflLine = { id: string; lineStatuses?: TflStatus[] };

/**
 * GET /api/meet/status?disrupt=<line>: TfL's live tube status as a map of line id →
 * {severity, description, reason, closedBetween}, cached 30 s. `closedBetween` is the
 * station pairs the reason texts say have no service, so the graph can cut just that
 * stretch (lib/closures.ts). `?disrupt=` overrides one line to
 * severity 2 (suspended) with `simulated: true`, for recordings and for testing the
 * re-pick without waiting for a real closure. A TfL failure serves the last good
 * status, or an empty map, never an error: the map must not go dark because TfL did.
 */
export async function GET(req: Request) {
  const disrupt = new URL(req.url).searchParams.get("disrupt");
  let body = cache && Date.now() - cache.at < TTL_MS ? cache.body : null;
  if (!body) {
    try {
      const url = new URL("https://api.tfl.gov.uk/Line/Mode/tube/Status");
      if (process.env.TFL_APP_KEY) url.searchParams.set("app_key", process.env.TFL_APP_KEY);
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { "user-agent": "jev-meet/0.1" } });
      if (!res.ok) throw new Error(`TfL ${res.status}`);
      const lines = (await res.json()) as TflLine[];
      body = {};
      for (const l of lines) {
        // The worst status wins when TfL lists several (a part closure and minor delays).
        let worst: TflStatus | null = null;
        for (const s of l.lineStatuses ?? []) if (!worst || s.statusSeverity < worst.statusSeverity) worst = s;
        if (!worst) continue;
        const closedBetween = (l.lineStatuses ?? []).flatMap((s) => parseClosures(s.reason ?? "", STATIONS, l.id));
        body[l.id] = { severity: worst.statusSeverity, description: worst.statusSeverityDescription, reason: worst.reason ?? "", ...(closedBetween.length ? { closedBetween } : {}) };
      }
      cache = { at: Date.now(), body };
    } catch {
      body = cache?.body ?? {};
    }
  }
  const out: LineStatus = { ...body };
  if (disrupt && GRAPH.lines.some((l) => l.id === disrupt)) {
    out[disrupt] = { severity: 2, description: "Suspended", reason: `${disrupt} line: simulated suspension for the demo`, simulated: true };
  }
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
