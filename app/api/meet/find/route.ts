import { NextResponse } from "next/server";
import { APIUserAbortError } from "@typesafe-ai/sdk";
import { buildLocateQuestions, buildMeetQuestions, candidateStations, meetState, mergeMeetAnswers, type Previous } from "@/lib/meet-find";
import { client } from "@/lib/typesafe";
import { CANDIDATES, STATION_BY_ID, type MeetFindResponse } from "@/lib/stations";

export const runtime = "nodejs";

/**
 * POST { query, origins?: naptan[], candidates?: naptan[], previous?: {id}, earlier?: string[], kind?: "rank" | "locate" }
 * `candidates` is the set the client found feasible for everyone's budget; only those
 * ids go into the Choice. `origins` become station names in state. Locate mode ranks
 * every candidate station by nearness to a named place, for the origin picker.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = body.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  const kind = body.kind === "locate" ? "locate" : "rank";
  const stations = kind === "locate" ? CANDIDATES : candidateStations(body.candidates);
  if (stations.length === 0) return NextResponse.json({ error: "no candidate stations" }, { status: 400 });
  const origins = Array.isArray(body.origins)
    ? body.origins.filter((id): id is string => typeof id === "string").map((id) => STATION_BY_ID[id]?.name).filter((n): n is string => !!n).slice(0, 5)
    : [];
  const prevId = body.previous && typeof body.previous === "object" ? (body.previous as { id?: unknown }).id : undefined;
  const prevStation = typeof prevId === "string" ? STATION_BY_ID[prevId] : undefined;
  const previous: Previous | null = prevStation ? { id: prevStation.id, name: prevStation.name } : null;
  const earlier = Array.isArray(body.earlier) ? body.earlier.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 200)).slice(-3) : [];

  const started = performance.now();
  try {
    const description = query.slice(0, 500);
    if (kind === "locate") {
      const res = await client.systemOne(
        { state: meetState(description, [], stations), questions: buildLocateQuestions(stations) },
        { signal: req.signal, timeout: 15_000, retry: { maxRetries: 0 } },
      );
      const where = res.answers.where;
      return NextResponse.json(
        {
          probabilities: where.probabilities,
          top: where.choice,
          confidence: where.confidence,
          exists: res.answers.exists.noul,
          latencyMs: Math.round(performance.now() - started),
          model: res.model,
          candidates: stations.length,
          tokens: res.usage?.input_tokens ?? null,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const res = await client.systemOne(
      { state: meetState(description, origins, stations, previous, earlier), questions: buildMeetQuestions(stations, previous) },
      // Forward client disconnects so a superseded keystroke cancels the upstream call too.
      { signal: req.signal, timeout: 15_000, retry: { maxRetries: 0 } },
    );
    const merged = mergeMeetAnswers(res.answers, stations, previous);
    const out: MeetFindResponse = {
      ...merged,
      latencyMs: Math.round(performance.now() - started),
      model: res.model,
      candidates: stations.length,
      tokens: res.usage?.input_tokens ?? null,
    };
    return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof APIUserAbortError || (err as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("[meet/find]", err);
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
