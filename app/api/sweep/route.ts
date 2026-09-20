import { NextResponse } from "next/server";
import { REVIEWS, STEAM_APPID, STEAM_GAME } from "@/lib/steam";
import { clampBatch, clampInFlight, DEFAULT_BATCH, DEFAULT_SHAPE, runSweep, type Shape, type SweepEvent } from "@/lib/sweep";

export const runtime = "nodejs";

/** The review set for the matrix: text for hover, thumbs-up and hours for the calibration panel. */
export function GET() {
  return NextResponse.json({ appid: STEAM_APPID, game: STEAM_GAME, batch: DEFAULT_BATCH, reviews: REVIEWS }, { headers: { "cache-control": "no-store" } });
}

/**
 * Judges every review against `criterion`, streamed as server-sent events one batch at a
 * time so the matrix lights up as requests land. Closing the response (a new criterion,
 * a reload) aborts every upstream call. `batch`, `inflight` and `shape` are exposed for scripts/calibrate-steam.mjs.
 */
export async function POST(req: Request) {
  let criterion: unknown;
  let batchIn: unknown;
  let limitIn: unknown;
  let inflightIn: unknown;
  let shapeIn: unknown;
  try {
    ({ criterion, batch: batchIn, limit: limitIn, inflight: inflightIn, shape: shapeIn } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof criterion !== "string" || criterion.trim().length === 0) {
    return NextResponse.json({ error: "criterion is required" }, { status: 400 });
  }
  const batch = clampBatch(batchIn);
  const inflight = clampInFlight(inflightIn);
  const shape: Shape = shapeIn === "inline" || shapeIn === "state" ? shapeIn : DEFAULT_SHAPE;
  const limit = typeof limitIn === "number" && limitIn > 0 ? Math.min(REVIEWS.length, Math.floor(limitIn)) : REVIEWS.length;
  const texts = REVIEWS.slice(0, limit).map((r) => r.text);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: SweepEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        for await (const e of runSweep(criterion.trim().slice(0, 300), texts, { batch, inflight, shape, signal: req.signal })) {
          send(e);
          if (closed) break;
        }
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[sweep]", err);
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
