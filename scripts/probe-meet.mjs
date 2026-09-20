// Probe set for /api/meet/find, after scripts/probe.mjs. Runs every query against the dev
// server on port 3000 with three fixed origins (Brixton, Walthamstow Central, Ealing
// Broadway), records top station, probability, exists, exclusion, budget, tokens and
// latency, prints a markdown table and writes scripts/probe-results/meet-<label>.json.
//
//   node scripts/probe-meet.mjs --label before
//   node scripts/probe-meet.mjs --label after --compare before
//   node scripts/probe-meet.mjs --group vibe,negation,nonsense     # the M2 gate: >= 80%
//   node scripts/probe-meet.mjs --set held                          # held-out third only
//   node scripts/probe-meet.mjs --from before                       # re-render, no calls
//
// Expectations name stations; ids are resolved from data/stations.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]] : [])).filter((x) => x.length),
);
const URL_ = args.url ?? "http://localhost:3000/api/meet/find";
const LABEL = `meet-${typeof args.label === "string" ? args.label : typeof args.from === "string" ? args.from : new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
const SET = args.set ?? "all";
const OUT_DIR = path.resolve("scripts/probe-results");
const EXISTS_FLOOR = 0.15;

const STATIONS = JSON.parse(await readFile("data/stations.json", "utf8"));
const byName = Object.fromEntries(STATIONS.map((s) => [s.name.toLowerCase(), s.id]));
const nameOf = Object.fromEntries(STATIONS.map((s) => [s.id, s.name]));
const id = (name) => {
  const v = byName[name.toLowerCase()];
  if (!v) throw new Error(`unknown station "${name}"`);
  return v;
};
const ORIGINS = ["Brixton", "Walthamstow Central", "Ealing Broadway"].map(id);

// `top`: acceptable winners; `notTop`: must not win; `mode`: finder | nothing | any (from
// exists); `excluded`: station the exclusion should name, "none", or alternatives in
// `excludedAlt`; `budget`: minutes the budget Choice should read, or null for none.
export const PROBES = [
  // Vibe: the kind of place, matched on hooks and what Jev knows of the area.
  { g: "vibe", q: "market food and a pint", top: ["London Bridge", "Borough"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "curry on brick lane", top: ["Aldgate East", "Liverpool Street", "Whitechapel"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "theatre then dinner", top: ["Leicester Square", "Covent Garden", "Piccadilly Circus", "Charing Cross"], mode: "finder", excluded: "none", held: true },
  { g: "vibe", q: "live music in camden", top: ["Camden Town"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "museums, something for the kids", top: ["South Kensington", "Bethnal Green", "Gloucester Road"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "posh cocktails in mayfair", top: ["Green Park", "Bond Street", "Hyde Park Corner"], mode: "finder", excluded: "none", held: true },
  { g: "vibe", q: "cheap eats in chinatown", top: ["Leicester Square", "Piccadilly Circus"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "trendy bars and street art", top: ["Old Street", "Bethnal Green", "Liverpool Street", "Aldgate East"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "a walk on the heath then a pub", top: ["Hampstead", "Belsize Park", "Kentish Town", "Highgate"], mode: "finder", excluded: "none", held: true },
  { g: "vibe", q: "big night out, clubs till late", top: ["Old Street", "Leicester Square", "Vauxhall", "Elephant & Castle", "Piccadilly Circus", "Tottenham Court Road"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "vintage shops on portobello road", top: ["Notting Hill Gate", "Ladbroke Grove", "Westbourne Park"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "a canal walk and a pub in little venice", top: ["Warwick Avenue", "Paddington", "Edgware Road", "Edgware Road (Bakerloo)"], mode: "finder", excluded: "none", held: true },
  { g: "vibe", q: "riverside pub in richmond", top: ["Richmond"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "somewhere in soho for drinks", top: ["Tottenham Court Road", "Leicester Square", "Piccadilly Circus", "Oxford Circus"], mode: "finder", excluded: "none" },
  { g: "vibe", q: "pub with a garden, not a chain", mode: "finder", notTop: ["Brixton", "Walthamstow Central", "Ealing Broadway"], excluded: "none", held: true },
  // Negation: the rejected station or area must not win and the exclusion should name it.
  { g: "negation", q: "cocktails but not shoreditch", notTop: ["Old Street"], excluded: "Old Street", excludedAlt: ["Liverpool Street", "Bethnal Green"], mode: "any" },
  { g: "negation", q: "live music, anywhere but camden", notTop: ["Camden Town"], excluded: "Camden Town", mode: "any" },
  { g: "negation", q: "a food market but not borough", notTop: ["London Bridge", "Borough"], excluded: "London Bridge", excludedAlt: ["Borough"], mode: "any", held: true },
  { g: "negation", q: "west end drinks that isn't leicester square", notTop: ["Leicester Square"], excluded: "Leicester Square", mode: "any" },
  { g: "negation", q: "not brixton, somewhere with a garden pub", notTop: ["Brixton"], excluded: "Brixton", mode: "any" },
  { g: "negation", q: "curry, but not brick lane", notTop: ["Aldgate East"], excluded: "Aldgate East", excludedAlt: ["Liverpool Street", "Whitechapel"], mode: "any", held: true },
  { g: "negation", q: "somewhere central, avoid oxford circus", notTop: ["Oxford Circus"], excluded: "Oxford Circus", mode: "any" },
  // Nonsense: the map must stay flat.
  { g: "nonsense", q: "asdfghjkl", mode: "nothing", excluded: "none" },
  { g: "nonsense", q: "the", mode: "nothing", excluded: "none" },
  { g: "nonsense", q: "hello", mode: "nothing", excluded: "none", held: true },
  { g: "nonsense", q: "how do I change my printer settings", mode: "nothing", excluded: "none" },
  { g: "nonsense", q: "purple monkey dishwasher", mode: "nothing", excluded: "none", held: true },
  { g: "nonsense", q: "qwzx plmk", mode: "nothing", excluded: "none" },
  // Budget: the travel limit read from the text (code applies it).
  { g: "budget", q: "pub, everyone under 35 min", budget: 30, excluded: "none" },
  { g: "budget", q: "dinner, max half an hour each", budget: 30, excluded: "none" },
  { g: "budget", q: "nobody travels more than an hour", budget: 60, excluded: "none", held: true },
  { g: "budget", q: "somewhere 20 mins tops", budget: 20, excluded: "none" },
  { g: "budget", q: "brunch", budget: null, excluded: "none" },
  { g: "budget", q: "a gallery, 45 minutes max for everyone", budget: 45, excluded: "none", held: true },
  { g: "budget", q: "cocktails at 8pm", budget: null, excluded: "none" },
  // Area: a named part of London.
  { g: "area", q: "somewhere in the city", top: ["Bank", "Liverpool Street", "Moorgate", "St. Paul's", "Monument", "Barbican"], mode: "finder", excluded: "none" },
  { g: "area", q: "east london", top: ["Bethnal Green", "Mile End", "Old Street", "Aldgate East", "Whitechapel", "Stratford", "Liverpool Street"], mode: "finder", excluded: "none", held: true },
  { g: "area", q: "kings cross area", top: ["King's Cross St. Pancras"], mode: "finder", excluded: "none" },
  // Locate: the origin picker's fallback for a fuzzy place.
  { g: "locate", kind: "locate", q: "near the emirates stadium", top: ["Arsenal", "Holloway Road", "Finsbury Park"] },
  { g: "locate", kind: "locate", q: "the barbican", top: ["Barbican", "Moorgate"] },
  { g: "locate", kind: "locate", q: "tate modern", top: ["Southwark", "St. Paul's", "Mansion House", "London Bridge"], held: true },
  { g: "locate", kind: "locate", q: "wembley", top: ["Wembley Park", "Wembley Central"] },
  { g: "locate", kind: "locate", q: "hyde park", top: ["Hyde Park Corner", "Marble Arch", "Lancaster Gate", "Knightsbridge"], held: true },
  { g: "locate", kind: "locate", q: "walthamstow", top: ["Walthamstow Central"] },
  // Refine: the previous pick is the reference; a move away must zero it.
  { g: "refine", previous: "Camden Town", q: "somewhere quieter", notTop: ["Camden Town"], excluded: "Camden Town", mode: "any" },
  { g: "refine", previous: "London Bridge", q: "no, further east", notTop: ["London Bridge"], excluded: "London Bridge", mode: "any" },
  { g: "refine", previous: "Leicester Square", q: "not there, too touristy", notTop: ["Leicester Square"], excluded: "Leicester Square", mode: "any", held: true },
  { g: "refine", previous: "Old Street", q: "yes, and a place that does food", top: ["Old Street"], excluded: "none", mode: "any" },
  { g: "refine", previous: "Angel", q: "a park for a picnic", notTop: ["Angel"], excluded: "none", excludedAlt: ["Angel"], mode: "any", held: true },
];

// Every named station must exist before any call is made.
for (const p of PROBES) for (const n of [...(p.top ?? []), ...(p.notTop ?? []), ...(p.excludedAlt ?? []), ...(p.excluded && p.excluded !== "none" ? [p.excluded] : []), ...(p.previous ? [p.previous] : [])]) id(n);

const key = (r) => (r.previous ? `${r.previous} | ${r.q}` : `${r.kind ?? "rank"}:${r.q}`);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const pct = (p) => (p == null || Number.isNaN(p) ? "—" : `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%`);
const short = (sid) => (sid ? nameOf[sid] ?? sid : "—");

async function call(p) {
  const body = p.kind === "locate" ? { query: p.q, kind: "locate" } : { query: p.q, origins: ORIGINS, ...(p.previous ? { previous: { id: id(p.previous) } } : {}) };
  const t0 = performance.now();
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const wall = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { ...(await res.json()), wallMs: wall };
}

function judge(p, r) {
  const ranked = Object.entries(r.probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked[0][0];
  const mode = r.exists >= EXISTS_FLOOR ? "finder" : "nothing";
  const excluded = r.excluded ?? null;
  const budget = r.budget ? r.budget.mins : undefined;
  const checks = [];
  if (p.top) checks.push(["top", p.top.map(id).includes(top)]);
  if (p.notTop) checks.push(["notTop", !p.notTop.map(id).includes(top)]);
  if (p.mode && p.mode !== "any") checks.push(["mode", p.mode.split("|").includes(mode)]);
  if (p.excluded !== undefined && r.excluded !== undefined) {
    const alt = (p.excludedAlt ?? []).map(id);
    const ok = p.excluded === "none" ? excluded == null || alt.includes(excluded) : excluded === id(p.excluded) || alt.includes(excluded);
    checks.push(["excl", ok]);
  }
  if (p.budget !== undefined && r.budget) checks.push(["budget", (p.budget ?? null) === (r.budget.p >= 0.5 ? r.budget.mins : null)]);
  const pass = checks.every(([, ok]) => ok);
  return {
    q: p.q,
    kind: p.kind ?? "rank",
    previous: p.previous ?? null,
    g: p.g,
    held: !!p.held,
    top,
    pTop: ranked[0][1],
    second: ranked[1]?.[0],
    gap: ranked[0][1] - (ranked[1]?.[1] ?? 0),
    exists: r.exists,
    mode,
    excluded,
    excludedP: r.excludedP ?? null,
    budget: budget ?? null,
    budgetP: r.budget?.p ?? null,
    expectedRank: p.top ? Math.min(...p.top.map((n) => ranked.findIndex(([k]) => k === id(n)) + 1).filter((i) => i > 0)) : null,
    tokens: r.tokens,
    latencyMs: r.latencyMs,
    wallMs: r.wallMs,
    checks: Object.fromEntries(checks),
    pass,
  };
}

async function run() {
  const groups = typeof args.group === "string" ? args.group.split(",") : null;
  const probes = PROBES.filter((p) => (SET === "all" || (SET === "held") === !!p.held) && (!groups || groups.includes(p.g)));
  await call({ q: "warm up call" });
  const rows = [];
  for (const p of probes) {
    const r = await call(p);
    const row = judge(p, r);
    rows.push(row);
    const fails = Object.entries(row.checks).filter(([, ok]) => !ok).map(([k]) => k).join(",");
    process.stderr.write(
      `${row.pass ? "ok  " : `FAIL`} ${row.g.padEnd(9)} ${pct(row.pTop).padStart(5)} ${short(row.top).padEnd(24)} ${row.excluded ? `−${short(row.excluded)} ` : ""}${row.budget ? `≤${row.budget} ` : ""}${String(row.latencyMs).padStart(4)}ms  ${p.previous ? `[after ${p.previous}] ` : ""}${p.q}${fails ? `  (${fails})` : ""}\n`,
    );
  }
  return rows;
}

function summarize(rows) {
  const by = (g) => rows.filter((r) => r.g === g);
  const rate = (xs, f = (r) => r.pass) => (xs.length ? xs.filter(f).length / xs.length : NaN);
  const gate = rows.filter((r) => ["vibe", "negation", "nonsense"].includes(r.g));
  return {
    n: rows.length,
    passAll: rate(rows),
    passGate: rate(gate),
    passTune: rate(rows.filter((r) => !r.held)),
    passHeld: rate(rows.filter((r) => r.held)),
    ...Object.fromEntries(["vibe", "negation", "nonsense", "budget", "area", "locate", "refine"].map((g) => [`pass_${g}`, rate(by(g))])),
    nonsenseFlat: rate(by("nonsense"), (r) => r.mode === "nothing"),
    exclusionFalsePositives: rows.filter((r) => r.excluded && r.checks.excl === false && !["negation", "refine"].includes(r.g)).length,
    latencyP50: median(rows.map((r) => r.latencyMs)),
    latencyP95: [...rows.map((r) => r.latencyMs)].sort((a, b) => a - b)[Math.floor(rows.length * 0.95)],
    tokensMean: Math.round(rows.reduce((s, r) => s + (r.tokens ?? 0), 0) / rows.length),
  };
}

function table(rows, before) {
  const bmap = new Map((before ?? []).map((r) => [key(r), r]));
  const cols = before ? ["group", "query", "before → after (top, p)", "excl", "budget", "tokens", "ms", "ok"] : ["group", "query", "top", "p", "exists", "excl", "budget", "tokens", "ms", "ok"];
  const lines = [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`];
  for (const r of rows) {
    const held = r.held ? " †" : "";
    const q = r.previous ? `${r.q} ⟵ ${r.previous}` : r.q;
    const bud = r.budget ? `${r.budget} (${pct(r.budgetP)})` : "—";
    if (before) {
      const b = bmap.get(key(r));
      lines.push(
        `| ${r.g} | ${q}${held} | ${b ? `${short(b.top)} ${pct(b.pTop)}` : "—"} → **${short(r.top)} ${pct(r.pTop)}** | ${b ? short(b.excluded) : "—"} → ${short(r.excluded)} | ${bud} | ${b?.tokens ?? "—"} → ${r.tokens} | ${b?.latencyMs ?? "—"} → ${r.latencyMs} | ${b ? (b.pass ? "✓" : "✗") : "—"} → ${r.pass ? "✓" : "✗"} |`,
      );
    } else {
      lines.push(`| ${r.g} | ${q}${held} | ${short(r.top)} | ${pct(r.pTop)} | ${pct(r.exists)} | ${short(r.excluded)} | ${bud} | ${r.tokens} | ${r.latencyMs} | ${r.pass ? "✓" : "✗"} |`);
    }
  }
  return lines.join("\n");
}

const saved = typeof args.from === "string" ? JSON.parse(await readFile(path.join(OUT_DIR, `meet-${args.from}.json`), "utf8")) : null;
const rows = saved ? saved.rows : await run();
const summary = summarize(rows);
if (!saved) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `${LABEL}.json`), JSON.stringify({ label: LABEL, url: URL_, at: new Date().toISOString(), summary, rows }, null, 1));
}
let before = null;
if (typeof args.compare === "string") {
  const b = JSON.parse(await readFile(path.join(OUT_DIR, `meet-${args.compare}.json`), "utf8"));
  before = b.rows;
  console.log(`\n### Summary: ${args.compare} → ${LABEL}\n\n| metric | before | after |\n| --- | --- | --- |`);
  const f = (v) => (v === undefined ? "—" : typeof v === "number" && v <= 1 && !Number.isInteger(v) ? pct(v) : String(v));
  for (const k of Object.keys(summary)) console.log(`| ${k} | ${f(b.summary[k])} | ${f(summary[k])} |`);
} else {
  console.log(`\n### Summary: ${LABEL}\n\n\`\`\`json\n${JSON.stringify(summary, null, 1)}\n\`\`\``);
}
console.log(`\n### Probe table: ${LABEL}${before ? ` (vs ${args.compare})` : ""}  († = held-out)\n`);
console.log(table(rows, before));
