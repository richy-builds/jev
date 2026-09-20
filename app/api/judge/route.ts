import { NextResponse } from "next/server";
import { APIUserAbortError, TypeSafeClient } from "@typesafe-ai/sdk";
import { INTENT_OPTIONS, JUDGMENT_COUNT, TONE_LEVELS, questions, type JudgeResponse } from "@/lib/questions";

export const runtime = "nodejs";

// Reads TYPESAFE_API_KEY from the server environment. Never shipped to the client.
const client = new TypeSafeClient();

export async function POST(req: Request) {
  let text: unknown;
  try {
    ({ text } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const started = performance.now();
  try {
    const res = await client.systemOne(
      { state: { message: text.slice(0, 4000) }, questions },
      // Forward client disconnects so a superseded keystroke cancels the upstream call too.
      { signal: req.signal, timeout: 15_000, retry: { maxRetries: 0 } },
    );
    const latencyMs = Math.round(performance.now() - started);
    const { intent, tone, needsHuman, sarcasm, churnRisk } = res.answers;

    const body: JudgeResponse = {
      judgment: {
        intent: {
          choice: intent.choice,
          confidence: intent.confidence,
          probabilities: Object.fromEntries(
            (Object.keys(INTENT_OPTIONS) as (keyof typeof INTENT_OPTIONS)[]).map((k) => [k, intent.probabilities[k] ?? 0]),
          ) as Record<keyof typeof INTENT_OPTIONS, number>,
        },
        tone: {
          score: tone.score,
          confidence: tone.confidence,
          probabilities: TONE_LEVELS.map((_, i) => (tone.probabilities as Record<string, number>)[String(i)] ?? 0),
        },
        needsHuman: needsHuman.noul,
        sarcasm: sarcasm.noul,
        churnRisk: churnRisk.noul,
      },
      latencyMs,
      model: res.model,
      judgments: JUDGMENT_COUNT,
    };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof APIUserAbortError || (err as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("[judge]", err);
    const message = err instanceof Error ? err.message : "Upstream error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
