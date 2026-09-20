// Which edges a TfL closure text cuts from the tube graph (lib/closures.ts), per line.
//
//   node scripts/closures.mjs                       # today's live status, plus the fixed cases
//   node scripts/closures.mjs --line=district --text="no service between Earls Court and Ealing Broadway / Richmond"
//
// Prints each line's parsed pairs and the cut edges, then the Acton Town → High Street
// Kensington estimate before and after, the case that motivated this: the whole-line
// ×1.3 said 22 min while TfL said 93.

import { readFileSync } from "node:fs";
import { cutEdges, linePath, matchStation, parseClosures } from "../lib/closures.ts";

const stations = JSON.parse(readFileSync(new URL("../data/stations.json", import.meta.url), "utf8"));
const graph = JSON.parse(readFileSync(new URL("../data/tube-graph.json", import.meta.url), "utf8"));
const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
const name = (id) => byId[id]?.name ?? id;

const args = process.argv.slice(2);
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;

/** Reasons to parse: the live feed, or one from the command line. */
async function reasons() {
  const text = arg("text");
  if (text) return [{ id: arg("line") ?? "district", severity: 5, reasons: [text] }];
  const res = await fetch("https://api.tfl.gov.uk/Line/Mode/tube/Status", { headers: { "user-agent": "jev-meet/0.1" } });
  const lines = await res.json();
  return lines.map((l) => ({
    id: l.id,
    severity: Math.min(...l.lineStatuses.map((s) => s.statusSeverity)),
    reasons: l.lineStatuses.map((s) => s.reason ?? "").filter(Boolean),
  }));
}

/** Dijkstra-free sanity check: minutes along the graph, ignoring interchanges, via BFS over minutes (Dijkstra with a sorted array). */
function minutes(edges, from, to, interchange = graph.interchangeMins) {
  const adj = {};
  for (const e of edges) {
    (adj[e.a] ??= []).push({ to: e.b, line: e.line, mins: e.mins });
    (adj[e.b] ??= []).push({ to: e.a, line: e.line, mins: e.mins });
  }
  const dist = new Map([[`${from}|start`, 0]]);
  const open = [{ key: `${from}|start`, d: 0 }];
  const done = new Set();
  while (open.length) {
    open.sort((p, q) => q.d - p.d);
    const { key, d } = open.pop();
    if (done.has(key)) continue;
    done.add(key);
    const [station, line] = key.split("|");
    for (const e of adj[station] ?? []) {
      const change = line !== "start" && line !== "walk" && e.line !== "walk" && e.line !== line ? interchange : 0;
      const nd = d + e.mins + change;
      const nk = `${e.to}|${e.line}`;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        open.push({ key: nk, d: nd });
      }
    }
  }
  let best = Infinity;
  for (const [k, d] of dist) if (k.startsWith(`${to}|`) && d < best) best = d;
  return best;
}

const FIXED = [
  ["district", "DISTRICT LINE: Saturday 19 and Sunday 20 September, no service between Earls Court and Ealing Broadway / Richmond. Use MILDMAY LINE services where available between Gunnersbury, Kew Gardens and Richmond. Replacement buses operate."],
  ["piccadilly", "PICCADILLY LINE: Saturday 19 September, from 0130 and all day Sunday 20 September, including Night Tube, no service between Hyde Park Corner and Acton Town. Replacement buses operate."],
  ["waterloo-city", "Waterloo & City line: service operates 06:00 until 00:30, Monday to Friday only. There is no service on Saturdays, Sundays and on bank/public holidays."],
  ["northern", "Northern line: no service between Kennington and Morden and between Camden Town and Edgware due to planned engineering work."],
  ["hammersmith-city", "Hammersmith & City line: no service between Hammersmith and Edgware Road while we carry out work."],
  ["central", "Central line: minor delays between Leytonstone and Epping due to a signal failure at Loughton."],
  ["metropolitan", "Metropolitan line: the line is closed between Kings Cross St Pancras and Aldgate. Use the Circle line instead."],
];

function report(id, severity, texts) {
  const pairs = texts.flatMap((t) => parseClosures(t, stations, id));
  const cut = cutEdges(graph.edges, id, pairs);
  const stretch = pairs.map(([a, b]) => `${name(a)} → ${name(b)} (${Math.max(0, linePath(graph.edges, id, a, b).length - 1)} hops)`).join(", ");
  console.log(`${id.padEnd(17)} sev ${String(severity).padStart(2)}  ${pairs.length ? `closed ${stretch}` : texts.length ? "no closed stretch parsed → whole-line weight" : "good service"}`);
  for (const e of graph.edges) if (cut.has(`${e.line}|${[e.a, e.b].sort().join("|")}`)) console.log(`   ✂ ${name(e.a)} — ${name(e.b)} (${e.mins} min)`);
  return { pairs, cut };
}

console.log("— fixed cases —");
for (const [id, text] of FIXED) report(id, 5, [text]);
for (const t of ["Earls Court", "Hammersmith", "Kings Cross", "Ealing Broadway", "nowhere at all"]) {
  console.log(`   match "${t}" (district) → ${matchStation(t, stations, "district")?.name ?? "null"}   (any line) → ${matchStation(t, stations)?.name ?? "null"}`);
}

console.log("\n— live status —");
const live = await reasons();
const allCut = new Set();
for (const l of live) {
  if (!l.reasons.length && !arg("text")) continue;
  const { cut } = report(l.id, l.severity, l.reasons);
  for (const k of cut) allCut.add(k);
}
const after = graph.edges.filter((e) => !allCut.has(`${e.line}|${[e.a, e.b].sort().join("|")}`));
const ACT = "940GZZLUACT";
const HSK = "940GZZLUHSK";
console.log(`\nActon Town → High Street Kensington: static ${minutes(graph.edges, ACT, HSK)} min, with today's cuts ${minutes(after, ACT, HSK)} min (${allCut.size} edges cut)`);
