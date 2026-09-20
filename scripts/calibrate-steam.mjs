// Picks the sweep's batch size from labelled data. Runs "the reviewer recommends this game"
// over every Steam review at each batch size through the real route (POST /api/sweep on the
// dev server), joins the probabilities to Steam's thumbs-up flag, and reports accuracy,
// AUC, Brier score, expected calibration error, and a 10-bucket reliability table.
// The throughput probe found batch size changes the answers (9% vs 18% matched for the same
// question at 250 vs 100), and this is the ground truth that settles which one to trust.
//
//   node scripts/calibrate-steam.mjs                        # inline shape → docs/sweep-calibration-inline.md
//   node scripts/calibrate-steam.mjs --shape=state          # the probe's state-path shape → docs/sweep-calibration-state.md
//   node scripts/calibrate-steam.mjs --batches=100@16,250@8 --runs=2
//
// `batch@inflight`: small batches want more requests in flight. Needs the dev server on
// port 3000 (BASE to override). Raw per-review probabilities go to
// scripts/probe-results/calibration-steam-<shape>-<batch>.json; docs/sweep-calibration.md
// is the hand-written summary of both shapes.

import { mkdir, writeFile } from "node:fs/promises";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const BASE = process.env.BASE ?? "http://localhost:3000";
// Each entry is `batch` or `batch@inflight`; small batches want more requests in flight.
const CONFIGS = String(args.batches ?? "10@64,25@48,50@24,100@16,125@16,250@8").split(",").map((c) => {
  const [batch, inflight] = c.split("@").map(Number);
  return { batch, inflight: inflight || undefined };
});
const SHAPE = args.shape ?? "inline";
const RUNS = Number(args.runs ?? 1);
const CRITERION = "the reviewer recommends this game";
const PRICE_PER_TOKEN = 0.042 / 1e6;
const RESULTS_DIR = "scripts/probe-results";

const { reviews, appid, game } = await (await fetch(`${BASE}/api/sweep`)).json();
const labels = reviews.map((r) => (r.voted_up ? 1 : 0));

async function sweep({ batch, inflight }) {
  const res = await fetch(`${BASE}/api/sweep`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ criterion: CRITERION, batch, inflight, shape: SHAPE }) });
  if (!res.ok) throw new Error(`POST /api/sweep ${res.status}`);
  const probs = new Array(reviews.length).fill(null);
  const lat = [];
  let done = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!line.startsWith("data: ")) continue;
      const e = JSON.parse(line.slice(6));
      if (e.t === "batch") {
        e.p.forEach((p, k) => (probs[e.from + k] = p));
        lat.push(e.ms);
      } else if (e.t === "done") done = e;
      else if (e.t === "error") throw new Error(e.message);
      else if (e.t === "failed") console.error(`  batch ${e.i} failed: ${e.message}`);
    }
  }
  return { probs, lat, done };
}

// ---------- metrics ----------

function auc(probs, labels) {
  // Rank-based AUC (Mann–Whitney), ties get half credit.
  const pairs = probs.map((p, i) => [p, labels[i]]).sort((a, b) => a[0] - b[0]);
  let rank = 1;
  let sumPos = 0;
  let pos = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avg = (rank + rank + (j - i) - 1) / 2;
    for (let k = i; k < j; k++) if (pairs[k][1]) (sumPos += avg), pos++;
    rank += j - i;
    i = j;
  }
  const neg = pairs.length - pos;
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Accuracy and decisiveness by position inside the batch: is the drop with batch size a position effect? */
function byPosition(probs, labels, batch) {
  const step = batch <= 25 ? 5 : batch <= 50 ? 10 : 25;
  const rows = [];
  for (let from = 0; from < batch; from += step) {
    let n = 0;
    let correct = 0;
    let sure = 0;
    for (let i = 0; i < probs.length; i++) {
      const pos = i % batch;
      if (pos < from || pos >= from + step || probs[i] == null) continue;
      n++;
      if ((probs[i] >= 0.5) === (labels[i] === 1)) correct++;
      sure += Math.abs(probs[i] - 0.5) * 2;
    }
    rows.push({ range: `${from + 1}–${Math.min(batch, from + step)}`, n, accuracy: n ? correct / n : null, decisiveness: n ? sure / n : null });
  }
  return rows;
}

function metrics(probs, labels) {
  const idx = probs.map((p, i) => (p == null ? -1 : i)).filter((i) => i >= 0);
  const n = idx.length;
  let correct = 0;
  let brier = 0;
  let matched = 0;
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, sumP: 0, sumY: 0 }));
  for (const i of idx) {
    const p = probs[i];
    const y = labels[i];
    if ((p >= 0.5) === (y === 1)) correct++;
    brier += (p - y) ** 2;
    if (p >= 0.5) matched++;
    const b = buckets[Math.min(9, Math.floor(p * 10))];
    b.n++;
    b.sumP += p;
    b.sumY += y;
  }
  const ece = buckets.reduce((s, b) => (b.n ? s + (b.n / n) * Math.abs(b.sumP / b.n - b.sumY / b.n) : s), 0);
  return {
    n,
    accuracy: correct / n,
    auc: auc(idx.map((i) => probs[i]), idx.map((i) => labels[i])),
    brier: brier / n,
    ece,
    matchRate: matched / n,
    buckets: buckets.map((b, k) => ({ range: `${(k / 10).toFixed(1)}–${((k + 1) / 10).toFixed(1)}`, n: b.n, predicted: b.n ? b.sumP / b.n : null, actual: b.n ? b.sumY / b.n : null })),
  };
}

const pct = (x, d = 1) => (x == null ? "—" : `${(100 * x).toFixed(d)}%`);
const pctile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

// ---------- main ----------

await mkdir(RESULTS_DIR, { recursive: true });
const rows = [];
for (const cfg of CONFIGS) {
  const { batch } = cfg;
  for (let run = 0; run < RUNS; run++) {
    process.stdout.write(`batch ${batch}${cfg.inflight ? `@${cfg.inflight}` : ""}${RUNS > 1 ? ` run ${run + 1}` : ""} … `);
    const { probs, lat, done } = await sweep(cfg);
    const m = metrics(probs, labels);
    m.positions = byPosition(probs, labels, batch);
    const row = { batch, inflight: cfg.inflight ?? 16, run, ...m, ms: done.ms, tokens: done.tokens, retries: done.retries, failed: done.failed, itemsPerS: m.n / (done.ms / 1000), p50: pctile(lat, 50), p95: pctile(lat, 95), costUsd: done.tokens * PRICE_PER_TOKEN };
    rows.push(row);
    console.log(`acc ${pct(m.accuracy)} · AUC ${m.auc.toFixed(3)} · ECE ${pct(m.ece)} · matched ${pct(m.matchRate)} · ${Math.round(row.itemsPerS)} items/s · ${(done.ms / 1000).toFixed(1)} s · ${done.retries} retries`);
    await writeFile(`${RESULTS_DIR}/calibration-steam-${SHAPE}-${batch}${RUNS > 1 ? `-${run + 1}` : ""}.json`, JSON.stringify({ criterion: CRITERION, shape: SHAPE, batch, inflight: row.inflight, run, metrics: m, done, probs }));
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// AUC decides; among configs within 0.005 of the best, throughput does. ECE alone would
// mislead here: a batch that answers ~0.6 for everything scores a fine ECE against a 65%
// base rate while telling the matrix nothing, so calibration is read as "does the
// probability track the label", which the reliability tables below show.
const topAuc = Math.max(...rows.map((r) => r.auc));
const best = rows.filter((r) => r.auc >= topAuc - 0.005).sort((a, b) => b.itemsPerS - a.itemsPerS)[0];
const up = labels.reduce((s, y) => s + y, 0);
const md = [];
md.push(`# Sweep batch-size calibration`);
md.push(``);
md.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/calibrate-steam.mjs\` against ${reviews.length.toLocaleString("en-US")} ${game} (Steam app ${appid}) reviews, ${up.toLocaleString("en-US")} of them (${pct(up / reviews.length)}) with Steam's thumbs-up. Criterion: "${CRITERION}". Label: \`voted_up\`.`);
md.push(``);
md.push(`The throughput probe (see \`scripts/throughput.mjs\`) found the same texts matched 9% at batch 250 and 18% at batch 100 for one question, so the batch size was chosen here against labelled data rather than guessed.`);
md.push(``);
md.push(`**Result: batch ${best.batch}, ${best.inflight} in flight** (AUC ${best.auc.toFixed(3)}${rows.length > 1 ? ` vs ${rows.filter((r) => r !== best).map((r) => `${r.auc.toFixed(3)} at ${r.batch}`).join(" / ")}` : ""}). Request shape: \`${SHAPE}\`. \`DEFAULT_BATCH\` and \`IN_FLIGHT\` in \`lib/sweep.ts\` follow this table.`);
md.push(``);
md.push(`| batch | in flight | accuracy @0.5 | AUC | Brier | ECE | matched | items/s | wall | p50 ms | p95 ms | tokens | cost | retries |`);
md.push(`|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
for (const r of rows) {
  md.push(`| ${r.batch}${RUNS > 1 ? ` (run ${r.run + 1})` : ""} | ${r.inflight} | ${pct(r.accuracy)} | ${r.auc.toFixed(3)} | ${r.brier.toFixed(3)} | ${pct(r.ece)} | ${pct(r.matchRate)} | ${Math.round(r.itemsPerS).toLocaleString("en-US")} | ${(r.ms / 1000).toFixed(1)} s | ${r.p50} | ${r.p95} | ${r.tokens.toLocaleString("en-US")} | $${r.costUsd.toFixed(4)} | ${r.retries} |`);
}
for (const r of rows) {
  md.push(``);
  md.push(`## Reliability, batch ${r.batch}${RUNS > 1 ? ` (run ${r.run + 1})` : ""}`);
  md.push(``);
  md.push(`| predicted bucket | n | mean predicted | actual thumbs-up |`);
  md.push(`|---|---:|---:|---:|`);
  for (const b of r.buckets) md.push(`| ${b.range} | ${b.n.toLocaleString("en-US")} | ${pct(b.predicted)} | ${pct(b.actual)} |`);
  md.push(``);
  md.push(`By position inside the batch (decisiveness = mean |p − 0.5| × 2):`);
  md.push(``);
  md.push(`| position | n | accuracy | decisiveness |`);
  md.push(`|---|---:|---:|---:|`);
  for (const b of r.positions) md.push(`| ${b.range} | ${b.n.toLocaleString("en-US")} | ${pct(b.accuracy)} | ${pct(b.decisiveness, 0)} |`);
}
md.push(``);
md.push(`Accuracy is at a 0.5 threshold. ECE is the n-weighted mean gap between predicted and actual over the ten buckets. "Matched" is the share of reviews at p ≥ 0.5; the base rate of thumbs-up is ${pct(up / reviews.length)}.`);
md.push(``);
await mkdir("docs", { recursive: true });
const docFile = `docs/sweep-calibration-${SHAPE}.md`;
await writeFile(docFile, md.join("\n"));
console.log(`\nbest: batch ${best.batch} @ ${best.inflight} · wrote ${docFile}`);
