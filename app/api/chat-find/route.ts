import OpenAI from "openai";
import { NextResponse } from "next/server";
import { chatMessages, chatModelId, type ChatTurn } from "@/lib/chat-find";
import { CHAT_MODEL, type ChatEvent } from "@/lib/chat-model";

export const runtime = "nodejs";

// Reads OPENAI_API_KEY from the server environment. Never shipped to the client. Built on
// first use: the constructor throws without a key, and a missing key should be a readable
// message on the page, not a broken route module.
// No retries: the SDK would otherwise honour a 429's retry-after in silence, and a rate
// limit would show on the page as a 30-second "first token" instead of what it is.
let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI({ maxRetries: 0 }));

/**
 * The chat model's side of the race, streamed as server-sent events so the page can
 * show tokens arriving. A superseded keystroke aborts the request; the upstream stream
 * is cancelled with it, but the provider still bills the prompt.
 */
export async function POST(req: Request) {
  let query: unknown;
  let turnsIn: unknown;
  try {
    ({ query, turns: turnsIn } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }

  const description = query.slice(0, 500);
  const turns: ChatTurn[] = Array.isArray(turnsIn)
    ? turnsIn
        .filter((t): t is ChatTurn => !!t && typeof t === "object" && typeof (t as ChatTurn).query === "string" && typeof (t as ChatTurn).answer === "string")
        .slice(-3)
        .map((t) => ({ query: t.query.slice(0, 500), answer: t.answer.slice(0, 200) }))
    : [];
  const started = performance.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        const upstream = await openai().chat.completions.create(
          {
            model: chatModelId,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: 60,
            ...(CHAT_MODEL.temperature !== undefined ? { temperature: CHAT_MODEL.temperature } : {}),
            ...(CHAT_MODEL.reasoningEffort !== undefined ? { reasoning_effort: CHAT_MODEL.reasoningEffort } : {}),
            messages: chatMessages(description, turns),
          },
          { signal: req.signal },
        );
        for await (const chunk of upstream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) send({ t: "delta", text: delta });
          if (chunk.usage) {
            send({
              t: "usage",
              prompt: chunk.usage.prompt_tokens,
              cached: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
              completion: chunk.usage.completion_tokens,
            });
          }
        }
        send({ t: "done", ms: Math.round(performance.now() - started) });
      } catch (err) {
        const name = (err as Error)?.name;
        if (!req.signal.aborted && name !== "AbortError" && name !== "APIUserAbortError") {
          console.error("[chat-find]", err);
          const status = (err as { status?: number })?.status;
          const message =
            status === 429
              ? `rate limited by OpenAI (${chatModelId}: ${err instanceof Error ? (err.message.match(/Limit \d+/)?.[0]?.toLowerCase() ?? "tokens per minute") : "tokens per minute"})`
              : err instanceof Error
                ? err.message
                : "Upstream error";
          send({ t: "error", message });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
