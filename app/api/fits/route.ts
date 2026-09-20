import { NextResponse } from "next/server";
import { APIUserAbortError } from "@typesafe-ai/sdk";
import { fitQuestions, findState, THRESHOLDS } from "@/lib/find";
import { client } from "@/lib/typesafe";
import { MOVIES, type FitsResponse } from "@/lib/movies";

export const runtime = "nodejs";

// Built once: the questions never change, only `description` in state does.
const QUESTIONS = fitQuestions();

/** Set mode: one Noul per film, "does this film fit what the description asks for?". */
export async function POST(req: Request) {
  let query: unknown;
  try {
    ({ query } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const started = performance.now();
  try {
    const res = await client.systemOne(
      { state: findState(query.slice(0, 500)), questions: QUESTIONS },
      { signal: req.signal, timeout: 15_000, retry: { maxRetries: 0 } },
    );
    const fits: Record<string, number> = {};
    let count = 0;
    for (const m of MOVIES) {
      fits[m.id] = res.answers[m.id]?.noul ?? 0;
      if (fits[m.id] >= THRESHOLDS.fit) count++;
    }
    const body: FitsResponse = {
      fits,
      threshold: THRESHOLDS.fit,
      count,
      latencyMs: Math.round(performance.now() - started),
      tokens: res.usage?.input_tokens ?? null,
    };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof APIUserAbortError || (err as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("[fits]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upstream error" }, { status: 502 });
  }
}
