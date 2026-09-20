import { NextResponse } from "next/server";
import { APIUserAbortError } from "@typesafe-ai/sdk";
import { INSPECT_THRESHOLDS, INSPECT_TOP, TAG_TOP, TAGS, inspectQuestions, inspectState, type InspectResponse, type Tag } from "@/lib/inspect";
import { client } from "@/lib/typesafe";
import { MOVIE_BY_ID } from "@/lib/movies";

export const runtime = "nodejs";

/** Second pass over the top few films: near-duplicate re-rank plus evidence tags. */
export async function POST(req: Request) {
  let query: unknown;
  let ids: unknown;
  try {
    ({ query, ids } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && MOVIE_BY_ID[id])) {
    return NextResponse.json({ error: "ids must be known movie ids" }, { status: 400 });
  }
  const top = (ids as string[]).slice(0, INSPECT_TOP);
  if (top.length < 2) return NextResponse.json({ error: "need at least two ids" }, { status: 400 });

  const started = performance.now();
  try {
    const res = await client.systemOne(
      { state: inspectState(query.slice(0, 500), top), questions: inspectQuestions(top) },
      { signal: req.signal, timeout: 15_000, retry: { maxRetries: 0 } },
    );
    const which = res.answers.which as { choice: string; probabilities: Record<string, number> };
    const ranked = top.map((id) => which.probabilities[id] ?? 0).sort((a, b) => b - a);
    const evidence: InspectResponse["evidence"] = {};
    for (const id of top.slice(0, TAG_TOP)) {
      evidence[id] = {} as Record<Tag, number>;
      for (const tag of Object.keys(TAGS) as Tag[]) {
        evidence[id][tag] = (res.answers[`${tag}|${id}`] as { noul: number })?.noul ?? 0;
      }
    }
    const body: InspectResponse = {
      ids: top,
      probabilities: Object.fromEntries(top.map((id) => [id, which.probabilities[id] ?? 0])),
      top: which.choice,
      close: ranked[0] - ranked[1] < INSPECT_THRESHOLDS.close,
      evidence,
      latencyMs: Math.round(performance.now() - started),
      tokens: res.usage?.input_tokens ?? null,
    };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof APIUserAbortError || (err as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("[inspect]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upstream error" }, { status: 502 });
  }
}
