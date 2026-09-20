import { NextResponse } from "next/server";
import { runLive, type LiveEvent } from "@/lib/live";

export const runtime = "nodejs";

/**
 * The Bluesky firehose judged live against `criterion`, as server-sent events. One
 * Jetstream connection per open response; closing the response (a new criterion, a
 * reload) closes it. Unsafe posts arrive as `hidden` with no text.
 */
export async function GET(req: Request) {
  const criterion = (new URL(req.url).searchParams.get("criterion") ?? "").trim().slice(0, 300);
  if (!criterion) return NextResponse.json({ error: "criterion is required" }, { status: 400 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: LiveEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        for await (const e of runLive(criterion, req.signal)) {
          send(e);
          if (closed) break;
        }
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[live]", err);
          send({ t: "error", message: err instanceof Error ? err.message : "Upstream error" });
        }
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
}
