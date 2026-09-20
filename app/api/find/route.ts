import { NextResponse } from "next/server";
import { APIUserAbortError } from "@typesafe-ai/sdk";
import { decideMode, findState, mergeAnswers, questionsFor, type Previous } from "@/lib/find";
import { client } from "@/lib/typesafe";
import { MOVIE_BY_ID, MOVIES, type FindResponse } from "@/lib/movies";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let query: unknown;
  let previousIn: unknown;
  let earlierIn: unknown;
  try {
    ({ query, previous: previousIn, earlier: earlierIn } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  // A follow-up carries the id of the answer it refers to; the film's own fields come from the catalogue.
  const prevId = previousIn && typeof previousIn === "object" ? (previousIn as { id?: unknown }).id : undefined;
  const prevMovie = typeof prevId === "string" ? MOVIE_BY_ID[prevId] : undefined;
  const previous: Previous | null = prevMovie ? { id: prevMovie.id, title: prevMovie.title, year: prevMovie.year, director: prevMovie.director } : null;
  const earlier = Array.isArray(earlierIn) ? earlierIn.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 200)).slice(-3) : [];

  const started = performance.now();
  try {
    const res = await client.systemOne(
      { state: findState(query.slice(0, 500), previous, earlier), questions: questionsFor(previous) },
      // Forward client disconnects so a superseded keystroke cancels the upstream call too.
      { signal: req.signal, timeout: 15_000, retry: { maxRetries: 0 } },
    );
    const latencyMs = Math.round(performance.now() - started);
    const router = res.answers.router as { probabilities: Record<string, number> };
    const merged = mergeAnswers(res.answers, previous);

    const body: FindResponse = {
      ...merged,
      router: {
        specific: router.probabilities.specific,
        set: router.probabilities.set,
        nothing: router.probabilities.nothing,
      },
      mode: decideMode(router.probabilities, merged.exists),
      latencyMs,
      model: res.model,
      candidates: MOVIES.length,
      tokens: res.usage?.input_tokens ?? null,
    };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof APIUserAbortError || (err as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("[find]", err);
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
