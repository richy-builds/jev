// Probe set for /api/find. Runs every query against the dev server on port 3000 and
// records top match, probability, exists score, router answer, exclusion, tokens and
// latency, then prints a markdown table and writes scripts/probe-results/<label>.json.
//
//   node scripts/probe.mjs --label before            # run and save
//   node scripts/probe.mjs --label after --compare before   # run, save, print before/after
//   node scripts/probe.mjs --set held --label x      # only the held-out third (tune | held | all)
//   node scripts/probe.mjs --repeat 3                # median latency over N runs per query
//   node scripts/probe.mjs --group trivia,category    # only some groups
//   node scripts/probe.mjs --from step2 --compare before   # re-render a saved run, no API calls
//
// The held-out third (held: true) is never used to pick thresholds; it is only reported.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]] : [])).filter((x) => x.length),
);
const URL_ = args.url ?? "http://localhost:3000/api/find";
const FITS_URL = URL_.replace(/\/find$/, "/fits");
const LABEL = typeof args.label === "string" ? args.label : typeof args.from === "string" ? args.from : new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const SET = args.set ?? "all";
const REPEAT = Number(args.repeat ?? 1);
const OUT_DIR = path.resolve("scripts/probe-results");

// Expectations. `top` lists acceptable best matches; `notTop` films that must not win;
// `mode` is the router outcome we want (finder | set | nothing | any); `setIncludes`
// films that should pass the per-film Noul in set mode; `excluded` the film the
// exclusion question should name (or "none").
export const PROBES = [
  // Plot fragments: the eight page presets. Floor: >= 90%.
  { g: "preset", q: "the one where the guy can't remember anything and has tattoos", top: ["memento-2000"], mode: "finder", excluded: "none" },
  { g: "preset", q: "kids hide from a shark. no wait, dinosaurs", top: ["jurassic-park-1993"], mode: "finder", excluded: "none", excludedAlt: ["jaws-1975"] }, // "no wait" is a real rule-out
  { g: "preset", q: "sad little robot alone on earth stacking trash", top: ["wall-e-2008"], mode: "finder", excluded: "none" },
  { g: "preset", q: "poor family sneaks into rich family's house, secret basement", top: ["parasite-2019"], mode: "finder", excluded: "none" },
  { g: "preset", q: "two magicians who hate each other", top: ["the-prestige-2006"], mode: "finder", excluded: "none" },
  { g: "preset", q: "he talks to a volleyball", top: ["cast-away-2000"], mode: "finder", excluded: "none" },
  { g: "preset", q: "spinning top at the end", top: ["inception-2010"], mode: "finder", excluded: "none" },
  { g: "preset", q: "grumpy old man, balloons, talking dog", top: ["up-2009"], mode: "finder", excluded: "none" },
  // More plot fragments.
  { g: "plot", q: "clownfish dad crosses the ocean looking for his son", top: ["finding-nemo-2003"], mode: "finder", excluded: "none", held: true },
  { g: "plot", q: "guy stuck on mars growing potatoes", top: ["the-martian-2015"], mode: "finder", excluded: "none" },
  { g: "plot", q: "linguist talks to aliens who write in circles", top: ["arrival-2016"], mode: "finder", excluded: "none", held: true },
  // Quoted lines.
  { g: "quote", q: "you're gonna need a bigger boat", top: ["jaws-1975"], mode: "finder", excluded: "none" },
  { g: "quote", q: "I'll be back", top: ["the-terminator-1984"], mode: "finder", excluded: "none" },
  { g: "quote", q: "here's johnny", top: ["the-shining-1980"], mode: "finder", excluded: "none", held: true },
  { g: "quote", q: "fava beans and a nice chianti", top: ["the-silence-of-the-lambs-1991"], mode: "finder", excluded: "none" },
  // Actors.
  { g: "actor", q: "keanu reeves on a bus that can't slow down", top: ["speed-1994"], mode: "finder", excluded: "none" },
  { g: "actor", q: "tom hanks stranded on an island", top: ["cast-away-2000"], mode: "finder", excluded: "none", held: true },
  { g: "actor", q: "heath ledger as the joker", top: ["the-dark-knight-2008"], mode: "finder", excluded: "none" },
  { g: "actor", q: "the one with sandra bullock in space", top: ["gravity-2013"], mode: "finder", excluded: "none", held: true },
  // Category descriptions: several films fit, so set mode.
  { g: "category", q: "the funny one", mode: "set", notTop: ["goodfellas-1990"], setIncludes: ["anchorman-2004", "superbad-2007", "airplane-1980"], setExcludes: ["goodfellas-1990"], excluded: "none" },
  { g: "category", q: "a comedy", mode: "set", setIncludes: ["dumb-and-dumber-1994", "step-brothers-2008", "the-hangover-2009"], setExcludes: ["schindler-s-list-1993"], excluded: "none", held: true },
  { g: "category", q: "scary movie", mode: "set", setIncludes: ["the-exorcist-1973", "hereditary-2018", "halloween-1978"], setExcludes: ["paddington-2-2017"], excluded: "none" },
  { g: "category", q: "a pixar film", mode: "set", setIncludes: ["toy-story-1995", "up-2009", "coco-2017"], setExcludes: ["shrek-2001"], excluded: "none", held: true },
  { g: "category", q: "war movies", mode: "set", setIncludes: ["saving-private-ryan-1998", "apocalypse-now-1979"], setExcludes: ["mean-girls-2004"], excluded: "none", held: true },
  { g: "category", q: "animated movies about robots", mode: "set", setIncludes: ["wall-e-2008", "the-iron-giant-1999", "big-hero-6-2014"], setExcludes: ["the-terminator-1984"], excluded: "none" },
  { g: "category", q: "a musical", mode: "set", setIncludes: ["la-la-land-2016", "singin-in-the-rain-1952", "the-sound-of-music-1965"], setExcludes: ["se7en-1995"], excluded: "none" },
  { g: "category", q: "something with dinosaurs", mode: "any", top: ["jurassic-park-1993"], excluded: "none" },
  // Negation: the excluded film must not win.
  { g: "negation", q: "the nolan one that isn't inception", notTop: ["inception-2010"], excluded: "inception-2010", mode: "any" },
  { g: "negation", q: "the pixar one that's not about toys", notTop: ["toy-story-1995", "toy-story-3-2010"], excluded: "toy-story-1995", excludedAlt: ["toy-story-3-2010"], mode: "any", held: true },
  { g: "negation", q: "the tarantino film that isn't pulp fiction", notTop: ["pulp-fiction-1994"], excluded: "pulp-fiction-1994", mode: "any" },
  { g: "negation", q: "space horror but not alien", notTop: ["alien-1979"], excluded: "alien-1979", mode: "any", held: true },
  { g: "negation", q: "the dinosaur one, not the shark one", top: ["jurassic-park-1993"], notTop: ["jaws-1975"], excluded: "jaws-1975", mode: "any" },
  // Near-duplicate pairs: the vague query splits, the detailed one should resolve.
  { g: "neardup", q: "ripley and the xenomorph", top: ["alien-1979", "aliens-1986"], mode: "any", excluded: "none", pair: ["alien-1979", "aliens-1986"] },
  { g: "neardup", q: "ripley fights the alien queen in a power loader", top: ["aliens-1986"], mode: "finder", excluded: "none", pair: ["alien-1979", "aliens-1986"] },
  { g: "neardup", q: "woody and buzz", top: ["toy-story-1995", "toy-story-3-2010"], mode: "any", excluded: "none", pair: ["toy-story-1995", "toy-story-3-2010"], held: true },
  { g: "neardup", q: "the toys end up in a daycare", top: ["toy-story-3-2010"], mode: "finder", excluded: "none", pair: ["toy-story-1995", "toy-story-3-2010"] },
  { g: "neardup", q: "terminator with the liquid metal guy", top: ["terminator-2-judgment-day-1991"], mode: "finder", excluded: "none", pair: ["the-terminator-1984", "terminator-2-judgment-day-1991"], held: true },
  { g: "neardup", q: "the first terminator movie", top: ["the-terminator-1984"], mode: "finder", excluded: "none", pair: ["the-terminator-1984", "terminator-2-judgment-day-1991"] },
  // Trivia and facts outside the hook.
  { g: "trivia", q: "the one by the director of heat", top: ["heat-1995"], mode: "any", excluded: "none" },
  { g: "trivia", q: "directed by the guy who made pulp fiction", mode: "set", setIncludes: ["reservoir-dogs-1992", "kill-bill-volume-1-2003", "django-unchained-2012"], setExcludes: ["the-godfather-1972"], excluded: "none" },
  { g: "trivia", q: "won best picture in 1995", top: ["forrest-gump-1994", "braveheart-1995"], mode: "any", excluded: "none", held: true }, // ambiguous: 1995 ceremony or 1995 film
  { g: "trivia", q: "three hour movie about an oil man", top: ["there-will-be-blood-2007"], mode: "finder", excluded: "none" },
  { g: "trivia", q: "spielberg movie with aliens", mode: "set", setIncludes: ["e-t-the-extra-terrestrial-1982", "close-encounters-of-the-third-kind-1977"], setExcludes: ["independence-day-1996"], excluded: "none", held: true },
  // Nonsense: the wall must stay flat.
  { g: "nonsense", q: "asdfghjkl", mode: "nothing", excluded: "none" },
  { g: "nonsense", q: "the", mode: "nothing", excluded: "none" },
  { g: "nonsense", q: "how do I change my printer settings", mode: "nothing", excluded: "none", held: true },
  { g: "nonsense", q: "purple monkey dishwasher", mode: "nothing", excluded: "none" },
  { g: "nonsense", q: "hello", mode: "nothing", excluded: "none", held: true },
  // Half-typed prefixes of presets: recorded, judged leniently (finder or nothing, never set).
  { g: "prefix", q: "the one where the guy can", mode: "finder|nothing", excluded: "none" },
  { g: "prefix", q: "spinning t", mode: "finder|nothing", excluded: "none", held: true },
  { g: "prefix", q: "grumpy old man, ball", top: ["up-2009"], mode: "finder|nothing", excluded: "none" },
  { g: "prefix", q: "kids hide from a sha", mode: "finder|nothing", excluded: "none", held: true },
  // Follow-ups: `previous` is the answer the turn before settled on; the query refers to it.
  // The gate for recording grid-refine is >= 80% here with no regression elsewhere.
  { g: "refine", previous: "alien-1979", q: "no, the sequel", top: ["aliens-1986"], notTop: ["alien-1979"], excluded: "alien-1979", mode: "any" },
  { g: "refine", previous: "the-terminator-1984", q: "the sequel", top: ["terminator-2-judgment-day-1991"], notTop: ["the-terminator-1984"], excluded: "none", excludedAlt: ["the-terminator-1984"], mode: "any" },
  { g: "refine", previous: "toy-story-1995", q: "not that one, the daycare one", top: ["toy-story-3-2010"], notTop: ["toy-story-1995"], excluded: "toy-story-1995", mode: "any" },
  { g: "refine", previous: "inception-2010", q: "same director but older", top: ["memento-2000", "the-prestige-2006", "the-dark-knight-2008"], notTop: ["inception-2010"], excluded: "none", excludedAlt: ["inception-2010"], mode: "any" },
  { g: "refine", previous: "star-wars-a-new-hope-1977", q: "the next one", top: ["the-empire-strikes-back-1980"], notTop: ["star-wars-a-new-hope-1977"], excluded: "none", excludedAlt: ["star-wars-a-new-hope-1977"], mode: "any" },
  { g: "refine", previous: "the-godfather-1972", q: "part two", notTop: ["the-godfather-1972"], excluded: "none", excludedAlt: ["the-godfather-1972"], mode: "any" }, // Part II is not in the catalogue
  { g: "refine", previous: "jaws-1975", q: "not the shark, the dinosaurs", top: ["jurassic-park-1993"], notTop: ["jaws-1975"], excluded: "jaws-1975", mode: "any" },
  { g: "refine", previous: "up-2009", q: "no, the one with the fish", top: ["finding-nemo-2003"], notTop: ["up-2009"], excluded: "up-2009", mode: "any" },
  { g: "refine", previous: "pulp-fiction-1994", q: "his earlier heist one", top: ["reservoir-dogs-1992"], notTop: ["pulp-fiction-1994"], excluded: "none", excludedAlt: ["pulp-fiction-1994"], mode: "any" },
  { g: "refine", previous: "the-shining-1980", q: "same director, in space", top: ["2001-a-space-odyssey-1968"], notTop: ["the-shining-1980"], excluded: "none", excludedAlt: ["the-shining-1980"], mode: "any" },
  { g: "refine", previous: "aliens-1986", q: "no the first one", top: ["alien-1979"], notTop: ["aliens-1986"], excluded: "aliens-1986", mode: "any" },
  { g: "refine", previous: "cast-away-2000", q: "the other tom hanks one", notTop: ["cast-away-2000"], excluded: "none", excludedAlt: ["cast-away-2000"], mode: "any" },
  { g: "refine", previous: "toy-story-1995", q: "not pixar, the ogre", top: ["shrek-2001"], notTop: ["toy-story-1995"], excluded: "toy-story-1995", mode: "any" },
  // Controls: a confirmation and an unrelated request must not reject the previous answer.
  { g: "refine", previous: "jurassic-park-1993", q: "yes, the kitchen raptors scene", top: ["jurassic-park-1993"], excluded: "none", mode: "any" },
  { g: "refine", previous: "inception-2010", q: "a comedy", mode: "set", setIncludes: ["anchorman-2004", "superbad-2007"], setExcludes: ["inception-2010"], excluded: "none" },
];

/** Rows are matched across runs by query, plus the previous answer for follow-ups. */
const key = (r) => (r.previous ? `${r.previous} | ${r.q}` : r.q);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const pct = (p) => (p == null || Number.isNaN(p) ? "—" : `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%`);
const short = (id) => (id ? id.replace(/-\d{4}$/, "") : "—");

async function call(query, previous = null) {
  const body = previous ? { query, previous: { id: previous } } : { query };
  const t0 = performance.now();
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const wall = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = { ...(await res.json()), wallMs: wall };
  // Set mode: the page sends a second request for the per-film Nouls. Record its cost too.
  if (data.mode === "set") {
    const t1 = performance.now();
    const fr = await fetch(FITS_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (fr.ok) {
      const f = await fr.json();
      data.fits = f.fits;
      data.setThreshold = f.threshold;
      data.fitsLatencyMs = f.latencyMs;
      data.fitsTokens = f.tokens;
      data.fitsWallMs = Math.round(performance.now() - t1);
    }
  }
  return data;
}

function judge(p, r) {
  // In set mode the page shows the best *fit*, not the Choice winner, so judge that.
  const fitsRanked = r.fits ? Object.entries(r.fits).sort((a, b) => b[1] - a[1]) : null;
  const ranked = r.mode === "set" && fitsRanked ? fitsRanked : Object.entries(r.probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked[0][0];
  const second = ranked[1]?.[0];
  const gap = ranked[0][1] - (ranked[1]?.[1] ?? 0);
  // Old route had no router: derive the mode the page used to derive from `exists`.
  const mode = r.mode ?? (r.exists >= 0.15 ? "finder" : "nothing");
  const excluded = r.excluded ?? null;
  const fits = r.fits ?? null;
  const passing = fits ? Object.entries(fits).filter(([, v]) => v >= (r.setThreshold ?? 0.5)).map(([k]) => k) : [];

  const checks = [];
  if (p.top) checks.push(["top", p.top.includes(top)]);
  if (p.notTop) checks.push(["notTop", !p.notTop.includes(top)]);
  if (p.mode && p.mode !== "any") checks.push(["mode", p.mode.split("|").includes(mode)]);
  if (p.setIncludes && mode === "set") checks.push(["setIncl", p.setIncludes.every((id) => passing.includes(id))]);
  if (p.setExcludes && mode === "set") checks.push(["setExcl", p.setExcludes.every((id) => !passing.includes(id))]);
  if (p.excluded !== undefined && r.excluded !== undefined) {
    const ok = p.excluded === "none" ? excluded == null || (p.excludedAlt ?? []).includes(excluded) : excluded === p.excluded || (p.excludedAlt ?? []).includes(excluded);
    checks.push(["excl", ok]);
  }
  const pass = checks.every(([, ok]) => ok);
  return {
    q: p.q,
    previous: p.previous ?? null,
    g: p.g,
    held: !!p.held,
    top,
    pTop: ranked[0][1],
    second,
    gap,
    exists: r.exists,
    mode,
    router: r.router ?? null,
    excluded,
    excludedP: r.excludedP ?? null,
    setCount: fits ? passing.length : null,
    expectedRank: p.top ? Math.min(...p.top.map((id) => ranked.findIndex(([k]) => k === id) + 1)) : null,
    tokens: r.tokens,
    latencyMs: r.latencyMs,
    wallMs: r.wallMs,
    fitsLatencyMs: r.fitsLatencyMs ?? null,
    fitsTokens: r.fitsTokens ?? null,
    checks: Object.fromEntries(checks),
    pass,
  };
}

async function run() {
  const groups = typeof args.group === "string" ? args.group.split(",") : null;
  const probes = PROBES.filter((p) => (SET === "all" || (SET === "held") === !!p.held) && (!groups || groups.includes(p.g)));
  await call("warm up call"); // first call after a dev-server rebuild is cold
  const rows = [];
  for (const p of probes) {
    const rs = [];
    for (let i = 0; i < REPEAT; i++) rs.push(await call(p.q, p.previous ?? null));
    const r = { ...rs[0], latencyMs: median(rs.map((x) => x.latencyMs)), wallMs: median(rs.map((x) => x.wallMs)) };
    const row = judge(p, r);
    rows.push(row);
    process.stderr.write(`${row.pass ? "ok " : "FAIL"} ${row.mode.padEnd(7)} ${pct(row.pTop).padStart(5)} ${short(row.top).padEnd(28)} ${String(row.latencyMs).padStart(4)}ms  ${p.previous ? `[after ${short(p.previous)}] ` : ""}${p.q}\n`);
  }
  return rows;
}

function summarize(rows) {
  const by = (pred) => rows.filter(pred);
  const presets = by((r) => r.g === "preset");
  const nonsense = by((r) => r.g === "nonsense");
  const negation = by((r) => r.g === "negation");
  const refine = by((r) => r.g === "refine");
  const base = by((r) => r.g !== "refine");
  const held = by((r) => r.held);
  const tune = by((r) => !r.held);
  const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : NaN);
  return {
    n: rows.length,
    passAll: rate(rows, (r) => r.pass),
    passBase: rate(base, (r) => r.pass),
    passRefine: rate(refine, (r) => r.pass),
    passTune: rate(tune, (r) => r.pass),
    passHeld: rate(held, (r) => r.pass),
    presetMinP: Math.min(...presets.map((r) => r.pTop)),
    presetAllTop: presets.every((r) => r.checks.top),
    nonsenseFlat: rate(nonsense, (r) => r.mode === "nothing"),
    negationOk: rate(negation, (r) => r.checks.notTop !== false),
    exclusionFalsePositives: rows.filter((r) => r.excluded && r.checks.excl === false && r.g !== "negation").length,
    latencyP50: median(rows.map((r) => r.latencyMs)),
    latencyP95: [...rows.map((r) => r.latencyMs)].sort((a, b) => a - b)[Math.floor(rows.length * 0.95)],
    tokensMean: Math.round(rows.reduce((s, r) => s + (r.tokens ?? 0), 0) / rows.length),
  };
}

function table(rows, before) {
  const bmap = new Map((before ?? []).map((r) => [key(r), r]));
  const cols = before
    ? ["group", "query", "before → after (top, p)", "mode", "excl", "set#", "tokens", "ms", "ok"]
    : ["group", "query", "top", "p", "exists", "mode", "excl", "set#", "tokens", "ms", "ok"];
  const lines = [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`];
  for (const r of rows) {
    const held = r.held ? " †" : "";
    const q = r.previous ? `${r.q} ⟵ ${short(r.previous)}` : r.q;
    if (before) {
      const b = bmap.get(key(r));
      lines.push(
        `| ${r.g} | ${q}${held} | ${b ? `${short(b.top)} ${pct(b.pTop)}` : "—"} → **${short(r.top)} ${pct(r.pTop)}** | ${b ? b.mode : "—"} → ${r.mode} | ${b ? short(b.excluded) : "—"} → ${short(r.excluded)} | ${r.setCount ?? "—"} | ${b?.tokens ?? "—"} → ${r.tokens}${r.fitsTokens ? `+${r.fitsTokens}` : ""} | ${b?.latencyMs ?? "—"} → ${r.latencyMs}${r.fitsLatencyMs ? `+${r.fitsLatencyMs}` : ""} | ${b ? (b.pass ? "✓" : "✗") : "—"} → ${r.pass ? "✓" : "✗"} |`,
      );
    } else {
      lines.push(`| ${r.g} | ${q}${held} | ${short(r.top)} | ${pct(r.pTop)} | ${pct(r.exists)} | ${r.mode} | ${short(r.excluded)} | ${r.setCount ?? "—"} | ${r.tokens}${r.fitsTokens ? `+${r.fitsTokens}` : ""} | ${r.latencyMs}${r.fitsLatencyMs ? `+${r.fitsLatencyMs}` : ""} | ${r.pass ? "✓" : "✗"} |`);
    }
  }
  return lines.join("\n");
}

const saved = typeof args.from === "string" ? JSON.parse(await readFile(path.join(OUT_DIR, `${args.from}.json`), "utf8")) : null;
const rows = saved ? saved.rows : await run();
const summary = summarize(rows);
if (!saved) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `${LABEL}.json`), JSON.stringify({ label: LABEL, url: URL_, at: new Date().toISOString(), summary, rows }, null, 1));
}

let before = null;
if (typeof args.compare === "string") {
  const b = JSON.parse(await readFile(path.join(OUT_DIR, `${args.compare}.json`), "utf8"));
  before = b.rows;
  console.log(`\n### Summary: ${args.compare} → ${LABEL}\n`);
  console.log("| metric | before | after |\n| --- | --- | --- |");
  for (const k of Object.keys(summary)) {
    const f = (v) => (v === undefined ? "—" : typeof v === "number" && v <= 1 && !Number.isInteger(v) ? pct(v) : String(v));
    console.log(`| ${k} | ${f(b.summary[k])} | ${f(summary[k])} |`);
  }
} else {
  console.log(`\n### Summary: ${LABEL}\n`);
  console.log("```json\n" + JSON.stringify(summary, null, 1) + "\n```");
}
console.log(`\n### Probe table: ${LABEL}${before ? ` (vs ${args.compare})` : ""}  († = held-out)\n`);
console.log(table(rows, before));
