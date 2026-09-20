import { cutEdges, edgeKey, linePath, matchStation } from "@/lib/closures";
import { GRAPH, STATIONS, type LineStatus, type TubeGraph } from "@/lib/stations";

export type Weighted = { a: string; b: string; line: string; mins: number }[];

/**
 * TfL status severity → edge weight. Suspended or closed lines drop out of the graph;
 * delays stretch the hop times. A part closure whose stretch could not be read from the
 * reason text (lib/closures.ts) penalises the whole line and the UI says so.
 */
export function severityWeight(severity: number): number | null {
  if ([1, 2, 16].includes(severity)) return null; // closed, suspended, not running
  if (severity === 20) return 1; // "service closed": overnight, every line; planning for later must still work
  // Whole-line penalties are kept soft: a weekend closure between two outer stations would
  // otherwise make everything from that line's other end look unreachable.
  if ([3, 4, 5, 11].includes(severity)) return 1.3; // part suspended, planned/part closure, part closed
  if (severity === 6) return 1.5; // severe delays
  if (severity === 9) return 1.2; // minor delays
  return 1;
}

/** Part-closure severities: localised when the reason text names the closed stretch, whole-line ×1.3 otherwise. */
const PART_CLOSED = new Set([3, 4, 5, 11]);

/**
 * Applies live status to the static graph. Walk links are never affected. A line whose
 * closure has been localised (`closedBetween`) loses exactly those edges and keeps the
 * rest at full speed; the whole-line weight is only for text that could not be parsed.
 */
export function applyStatus(graph: TubeGraph, status: LineStatus | null): Weighted {
  if (!status) return graph.edges;
  const cut = new Set<string>();
  for (const [line, s] of Object.entries(status)) if (s.closedBetween?.length) for (const k of cutEdges(graph.edges, line, s.closedBetween)) cut.add(k);
  const out: Weighted = [];
  for (const e of graph.edges) {
    if (e.line === "walk") {
      out.push(e);
      continue;
    }
    if (cut.has(edgeKey(e.line, e.a, e.b))) continue;
    const s = status[e.line];
    const w = s?.closedBetween?.length && PART_CLOSED.has(s.severity) ? 1 : severityWeight(s?.severity ?? 10);
    if (w === null) continue;
    out.push(w === 1 ? e : { ...e, mins: e.mins * w });
  }
  return out;
}

export type Reach = {
  /** Minutes from the origin to every reachable station (interchanges included). */
  mins: Record<string, number>;
  /** Best predecessor per (station|line) state, for path reconstruction. */
  prev: Map<string, { key: string; line: string }>;
  /** Best state key per station. */
  bestKey: Record<string, string>;
};

type Adj = Record<string, { to: string; line: string; mins: number }[]>;

function adjacency(edges: Weighted): Adj {
  const adj: Adj = {};
  for (const e of edges) {
    (adj[e.a] ??= []).push({ to: e.b, line: e.line, mins: e.mins });
    (adj[e.b] ??= []).push({ to: e.a, line: e.line, mins: e.mins });
  }
  return adj;
}

/**
 * Dijkstra over (station, line) states so a change of line costs `interchangeMins`.
 * Boarding from the origin, or after a walk link, costs nothing. A binary heap is
 * overkill at ~270 stations × ≤4 lines; a sorted array is fine.
 */
export function reach(origin: string, edges: Weighted = GRAPH.edges, interchangeMins = GRAPH.interchangeMins): Reach {
  const adj = adjacency(edges);
  const dist = new Map<string, number>();
  const prev = new Map<string, { key: string; line: string }>();
  const start = `${origin}|start`;
  dist.set(start, 0);
  const open: { key: string; d: number }[] = [{ key: start, d: 0 }];
  const done = new Set<string>();
  while (open.length) {
    open.sort((p, q) => q.d - p.d);
    const { key, d } = open.pop()!;
    if (done.has(key)) continue;
    done.add(key);
    const [station, line] = key.split("|");
    for (const e of adj[station] ?? []) {
      const change = line !== "start" && line !== "walk" && e.line !== "walk" && e.line !== line ? interchangeMins : 0;
      const nd = d + e.mins + change;
      const nk = `${e.to}|${e.line}`;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, { key, line: e.line });
        open.push({ key: nk, d: nd });
      }
    }
  }
  const mins: Record<string, number> = {};
  const bestKey: Record<string, string> = {};
  for (const [k, d] of dist) {
    const station = k.split("|")[0];
    if (d < (mins[station] ?? Infinity)) {
      mins[station] = d;
      bestKey[station] = k;
    }
  }
  return { mins, prev, bestKey };
}

export type Leg = { line: string; stations: string[] };

/** The route behind `reach(origin).mins[target]`, grouped into legs by line, for drawing. */
export function pathTo(r: Reach, target: string): Leg[] {
  let key = r.bestKey[target];
  if (!key) return [];
  const hops: { station: string; line: string }[] = [];
  while (key) {
    const [station] = key.split("|");
    const p = r.prev.get(key);
    hops.push({ station, line: p?.line ?? "start" });
    if (!p) break;
    key = p.key;
  }
  hops.reverse(); // origin first; hops[i].line is the line ridden INTO hops[i]
  const legs: Leg[] = [];
  for (let i = 1; i < hops.length; i++) {
    const last = legs.at(-1);
    if (last && last.line === hops[i].line) last.stations.push(hops[i].station);
    else legs.push({ line: hops[i].line, stations: [hops[i - 1].station, hops[i].station] });
  }
  return legs;
}

/**
 * TfL's journey legs as drawable legs along our graph: each tube leg's endpoints are
 * matched back to stations by name (preferring the leg's line, which settles the
 * Hammersmiths and Edgware Roads) and joined along that line; walking legs join their
 * two stations directly. Null when any name or line cannot be placed, so the caller
 * can fall back to the graph's own path. Legs on `flaggedLines` (a suspended line
 * TfL's plan still rides, live or simulated) are marked rather than rerouted.
 */
export function legsFromJourney(legs: { line: string | null; mode: string; from: string; to: string }[], flaggedLines?: Set<string>): (Leg & { flagged?: boolean })[] | null {
  const out: (Leg & { flagged?: boolean })[] = [];
  for (const l of legs) {
    const tube = l.mode === "tube";
    const line = tube ? l.line : "walk";
    if (!line || (tube && !GRAPH.lines.some((g) => g.id === line))) return null;
    const from = matchStation(l.from, STATIONS, tube ? line : undefined);
    const to = matchStation(l.to, STATIONS, tube ? line : undefined);
    if (!from || !to) return null;
    if (from.id === to.id) continue;
    const stations = tube ? linePath(GRAPH.edges, line, from.id, to.id) : [from.id, to.id];
    if (stations.length < 2) return null;
    out.push({ line, stations, ...(tube && flaggedLines?.has(line) ? { flagged: true } : {}) });
  }
  return out;
}
