/**
 * Localising TfL closures. The status feed's `affectedStops` is empty, but the `reason`
 * text says where: "no service between Earls Court and Ealing Broadway / Richmond".
 * This module turns that text into station pairs and those pairs into the edges to cut,
 * so a weekend closure at one end of a line no longer penalises the whole line.
 *
 * Pure and import-free (stations and edges are passed in) so scripts/closures.mjs can
 * run it under Node's type stripping without the `@/` alias.
 */

export type StationLike = { id: string; name: string; lines: string[] };
export type EdgeLike = { a: string; b: string; line: string; mins: number };
export type Pair = [string, string];

/** "Earl's Court" → "earls court", "Hammersmith (H&C)" → "hammersmith", "St. John's Wood" → "st johns wood". */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The station a piece of reason text names, preferring stations on `line` ("Hammersmith"
 * is two stations; the District's is the one the District closure means). Exact match
 * first, then a prefix either way ("Kings Cross" for "King's Cross St. Pancras",
 * "Hammersmith (H&C)" for "Hammersmith"). Null when nothing fits.
 */
export function matchStation(text: string, stations: StationLike[], line?: string): StationLike | null {
  const t = normaliseName(text);
  if (t.length < 3) return null;
  const pools = line ? [stations.filter((s) => s.lines.includes(line)), stations] : [stations];
  for (const pool of pools) {
    const exact = pool.find((s) => normaliseName(s.name) === t);
    if (exact) return exact;
    const prefix = pool.filter((s) => {
      const n = normaliseName(s.name);
      return n.startsWith(`${t} `) || t.startsWith(`${n} `);
    });
    if (prefix.length === 1) return prefix[0];
  }
  return null;
}

/** Words that make a "between X and Y" clause a closure rather than a delay or an alternative route. */
const CLOSED = /\b(no (?:train )?service|no trains|closed|suspended|not (?:running|stopping|calling))\b/i;
/** Where a "between" clause ends: sentence end, or the next advice. */
const CLAUSE_END = /[.;:]|\b(?:use|replacement|due to|until|while|because|including|between)\b/i;

/**
 * Station pairs a reason text says are closed on `line`. Each "between A and B" clause
 * preceded (in its sentence) by closure language yields A × B, where B may list
 * alternatives ("Ealing Broadway / Richmond"). Names that do not resolve are dropped,
 * so a partly understood clause still cuts what it can.
 */
export function parseClosures(reason: string, stations: StationLike[], line?: string): Pair[] {
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  const text = reason.replace(/\s+/g, " ");
  const re = /\bbetween\s+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index);
    const sentence = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf(";")) + 1);
    if (!CLOSED.test(sentence)) continue;
    const rest = text.slice(m.index + m[0].length);
    const endAt = rest.search(CLAUSE_END);
    const clause = (endAt >= 0 ? rest.slice(0, endAt) : rest).trim();
    const at = clause.search(/\s+and\s+/i);
    if (at < 0) continue;
    const left = clause.slice(0, at);
    const right = clause.slice(at).replace(/^\s+and\s+/i, "");
    const names = (side: string) => side.split(/\s*(?:\/|,|\bor\b|\band\b)\s*/i).filter(Boolean);
    const as = names(left).map((n) => matchStation(n, stations, line)).filter((s): s is StationLike => !!s);
    const bs = names(right).map((n) => matchStation(n, stations, line)).filter((s): s is StationLike => !!s);
    for (const a of as)
      for (const b of bs) {
        if (a.id === b.id) continue;
        const key = [a.id, b.id].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([a.id, b.id]);
      }
  }
  return pairs;
}

/** Fewest-hops path from `a` to `b` riding only `line`, as station ids; empty when there is none. */
export function linePath(edges: EdgeLike[], line: string, a: string, b: string): string[] {
  if (a === b) return [a];
  const adj: Record<string, string[]> = {};
  for (const e of edges) {
    if (e.line !== line) continue;
    (adj[e.a] ??= []).push(e.b);
    (adj[e.b] ??= []).push(e.a);
  }
  const prev = new Map<string, string | null>([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const s = queue.shift()!;
    if (s === b) break;
    for (const t of adj[s] ?? []) {
      if (prev.has(t)) continue;
      prev.set(t, s);
      queue.push(t);
    }
  }
  if (!prev.has(b)) return [];
  const path: string[] = [];
  for (let s: string | null = b; s; s = prev.get(s) ?? null) path.push(s);
  return path.reverse();
}

export const edgeKey = (line: string, a: string, b: string) => `${line}|${[a, b].sort().join("|")}`;

/** The edge keys (see `edgeKey`) on `line` between each closed pair. */
export function cutEdges(edges: EdgeLike[], line: string, pairs: Pair[]): Set<string> {
  const cut = new Set<string>();
  for (const [a, b] of pairs) {
    const path = linePath(edges, line, a, b);
    for (let i = 1; i < path.length; i++) cut.add(edgeKey(line, path[i - 1], path[i]));
  }
  return cut;
}
