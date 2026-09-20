/**
 * Convex hull for the "everyone within N min" region on the schematic: Andrew's
 * monotone chain over the feasible stations' map positions. Pure, no React, so a
 * node check can run it.
 */
export type Point = { x: number; y: number };

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The hull's vertices counter-clockwise (screen y down: clockwise on the page), starting at the leftmost-lowest point; fewer than three distinct points come back as they are. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Shoelace area of a polygon (absolute). */
export const polygonArea = (poly: Point[]): number => Math.abs(poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0)) / 2;

/** An SVG path for the polygon, closed. */
export const polygonPath = (poly: Point[]): string => (poly.length ? poly.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") + " Z" : "");
