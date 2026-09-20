// Throughput probe: how many short texts can Jev judge per second from this key?
//
//   node --env-file=.env.local scripts/throughput.mjs [--items=10000] [--batch=250] [--levels=1,4,8,16,32]
//
// Shape under test is the "sweep": one request holds `batch` comments in state and
// one Noul per comment ("does this comment match the criterion?"). Each concurrency
// level fires the same batches through a worker pool with retries off, so a 429 or
// 529 shows up as an error, never as hidden latency. Prints a table per level and
// writes the raw per-request timings to scripts/probe-results/throughput-<ts>.json.
//
// Data: recent Hacker News comments from the keyless Algolia API, cached at
// scripts/probe-results/hn-comments.json after the first run.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const ITEMS = Number(args.items ?? 10_000);
const BATCH = Number(args.batch ?? 250);
const LEVELS = String(args.levels ?? "1,4,8,16,32").split(",").map(Number);
const PRICE_PER_TOKEN = 0.042 / 1e6;
const RESULTS_DIR = "scripts/probe-results";
const CACHE = `${RESULTS_DIR}/hn-comments.json`;

const CRITERION =
  "The commenter describes something that happened to them personally (their own job, project, purchase, or experience), rather than stating an opinion, explaining a fact, or asking a question.";

const client = new TypeSafeClient();

// ---------- data ----------

function clean(html) {
  return html
    .replace(/<p>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadComments(n) {
  await mkdir(RESULTS_DIR, { recursive: true });
  let cached = [];
  try {
    cached = JSON.parse(await readFile(CACHE, "utf8"));
  } catch {}
  if (cached.length >= n) return cached.slice(0, n);

  const out = [];
  const seen = new Set();
  // Algolia caps any one query at 1,000 hits, so walk backwards in time instead of paging.
  let before = Math.floor(Date.now() / 1000);
  for (let page = 0; out.length < n && page < 60; page++) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=comment&hitsPerPage=1000&numericFilters=created_at_i<${before}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Algolia ${res.status} on page ${page}`);
    const { hits } = await res.json();
    if (!hits?.length) break;
    for (const h of hits) {
      before = Math.min(before, h.created_at_i);
      const text = clean(h.comment_text ?? "");
      if (text.length < 40 || seen.has(h.objectID)) continue;
      seen.add(h.objectID);
      out.push({ id: h.objectID, text: text.slice(0, 280) });
    }
    process.stderr.write(`fetched ${out.length} comments\r`);
  }
  process.stderr.write("\n");
  await writeFile(CACHE, JSON.stringify(out));
  return out.slice(0, n);
}

// ---------- request shape ----------

function buildBatch(comments) {
  const state = { criterion: CRITERION, comments: comments.map((c) => ({ text: c.text })) };
  const questions = {};
  comments.forEach((c, i) => {
    questions[c.id] = noul(`Does the comment in \`comments[${i}].text\` match \`criterion\`?`, {
      true: "The comment is mainly a first-hand account of the commenter's own experience",
      false: "The comment is mainly an opinion, an explanation, a question, or is about someone else",
    });
  });
  return { state, questions };
}

async function fire(batch, timeoutMs = 30_000) {
  const t0 = performance.now();
  try {
    const res = await client.systemOne(batch, { timeout: timeoutMs, retry: { maxRetries: 0 } });
    return {
      ok: true,
      ms: performance.now() - t0,
      tokens: res.usage.input_tokens,
      out: res.usage.output_tokens,
      matches: Object.values(res.answers).filter((a) => a.noul >= 0.5).length,
    };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, status: e?.status ?? e?.name ?? "error", message: String(e?.message ?? e).slice(0, 120) };
  }
}

async function pool(batches, concurrency) {
  const results = new Array(batches.length);
  let next = 0;
  const t0 = performance.now();
  const timeline = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < batches.length) {
        const i = next++;
        const started = performance.now() - t0;
        const r = await fire(batches[i]);
        results[i] = r;
        timeline.push({ i, started: Math.round(started), ended: Math.round(performance.now() - t0), ok: r.ok, ms: Math.round(r.ms), status: r.status });
      }
    }),
  );
  return { results, wallMs: performance.now() - t0, timeline };
}

// ---------- reporting ----------

const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—");

function summarise(level, batches, { results, wallMs }) {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const items = ok.length * BATCH;
  const tokens = ok.reduce((s, r) => s + r.tokens, 0);
  const lat = ok.map((r) => r.ms);
  const errors = {};
  for (const r of bad) errors[r.status] = (errors[r.status] ?? 0) + 1;
  return {
    level,
    requests: batches.length,
    ok: ok.length,
    errors,
    wallS: wallMs / 1000,
    itemsPerS: items / (wallMs / 1000),
    reqPerS: ok.length / (wallMs / 1000),
    tokensPerS: tokens / (wallMs / 1000),
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    max: Math.max(...lat),
    tokensPerReq: tokens / Math.max(1, ok.length),
    costUsd: tokens * PRICE_PER_TOKEN,
    matchRate: ok.reduce((s, r) => s + r.matches, 0) / Math.max(1, items),
    sampleError: bad[0]?.message,
  };
}

function printTable(rows) {
  const cols = [
    ["in flight", (r) => r.level],
    ["req ok", (r) => `${r.ok}/${r.requests}`],
    ["errors", (r) => (Object.keys(r.errors).length ? Object.entries(r.errors).map(([k, v]) => `${k}×${v}`).join(" ") : "none")],
    ["wall s", (r) => fmt(r.wallS, 1)],
    ["items/s", (r) => fmt(r.itemsPerS)],
    ["req/s", (r) => fmt(r.reqPerS, 1)],
    ["tok/s", (r) => fmt(r.tokensPerS)],
    ["p50 ms", (r) => fmt(r.p50)],
    ["p95 ms", (r) => fmt(r.p95)],
    ["max ms", (r) => fmt(r.max)],
    ["tok/req", (r) => fmt(r.tokensPerReq)],
    ["cost", (r) => `$${r.costUsd.toFixed(4)}`],
  ];
  const cells = rows.map((r) => cols.map(([, f]) => String(f(r))));
  const widths = cols.map(([h], i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => c.map((v, i) => v.padStart(widths[i])).join("  ");
  console.log(line(cols.map(([h]) => h)));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const c of cells) console.log(line(c));
}

// ---------- main ----------

const comments = await loadComments(ITEMS);
const batches = [];
for (let i = 0; i + BATCH <= comments.length; i += BATCH) batches.push(buildBatch(comments.slice(i, i + BATCH)));
console.log(`${comments.length} comments · ${batches.length} batches of ${BATCH} · one Noul per comment · retries off\n`);

const warm = await fire(batches[0]);
if (!warm.ok) {
  console.error(`warm-up request failed: ${warm.status} ${warm.message}`);
  process.exit(1);
}
console.log(`warm-up: ${fmt(warm.ms)} ms · ${fmt(warm.tokens)} input tokens · ${warm.matches}/${BATCH} matched\n`);

const rows = [];
const raw = [];
for (const level of LEVELS) {
  process.stdout.write(`in flight ${level} … `);
  const run = await pool(batches, level);
  const row = summarise(level, batches, run);
  rows.push(row);
  raw.push({ level, timeline: run.timeline });
  console.log(`${fmt(row.itemsPerS)} items/s, ${row.ok}/${row.requests} ok, wall ${fmt(row.wallS, 1)} s${row.sampleError ? ` · first error: ${row.sampleError}` : ""}`);
  // Let any rate-limit window clear before the next level so levels are independent.
  await new Promise((r) => setTimeout(r, 3000));
}

console.log();
printTable(rows);
console.log(`\nmatch rate ${fmt(rows[0].matchRate * 100, 1)}% of comments read as first-hand accounts · price $0.042 per M tokens`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = `${RESULTS_DIR}/throughput-${stamp}.json`;
await writeFile(file, JSON.stringify({ items: comments.length, batch: BATCH, criterion: CRITERION, rows, raw }, null, 1));
console.log(`raw timings → ${file}`);
