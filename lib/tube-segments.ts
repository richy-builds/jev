import { GRAPH, STATION_BY_ID, type Station } from "@/lib/stations";

/** Lines sharing a segment are drawn side by side, this many user units apart. */
export const PARALLEL_GAP = 2.4;

export type Segment = { key: string; line: string; x1: number; y1: number; x2: number; y2: number };

/** One straight segment per (edge, line), offset perpendicular when several lines share the pair. Pure, so the OG image can draw the same map. */
export function buildSegments(): Segment[] {
  const groups = new Map<string, { a: Station; b: Station; lines: string[] }>();
  for (const e of GRAPH.edges) {
    if (e.line === "walk") continue;
    const g = groups.get(`${e.a}|${e.b}`) ?? { a: STATION_BY_ID[e.a], b: STATION_BY_ID[e.b], lines: [] };
    g.lines.push(e.line);
    groups.set(`${e.a}|${e.b}`, g);
  }
  const out: Segment[] = [];
  for (const [key, g] of groups) {
    g.lines.sort();
    const dx = g.b.x - g.a.x;
    const dy = g.b.y - g.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    g.lines.forEach((line, i) => {
      const off = (i - (g.lines.length - 1) / 2) * PARALLEL_GAP;
      out.push({ key: `${key}|${line}`, line, x1: g.a.x + nx * off, y1: g.a.y + ny * off, x2: g.b.x + nx * off, y2: g.b.y + ny * off });
    });
  }
  return out;
}

export const SEGMENTS = buildSegments();

/** One SVG path per line, for renderers that want few elements (the OG image). */
export function pathsByLine(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of SEGMENTS) out[s.line] = `${out[s.line] ?? ""}M${s.x1.toFixed(1)} ${s.y1.toFixed(1)}L${s.x2.toFixed(1)} ${s.y2.toFixed(1)}`;
  return out;
}
