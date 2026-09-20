// Builds the Steam review set for /sweep: ~10,000 short English reviews of one game with
// Steam's own thumbs-up flag kept as ground truth for the calibration panel.
//
//   node scripts/build-steam.mjs                       # Elden Ring → data/steam-1245620.json
//   node scripts/build-steam.mjs --appid=1245620 --count=10000 --negative=0.35
//
// store.steampowered.com/appreviews/<appid>?json=1 is keyless and pages by cursor, 100 a
// page. A big game's reviews run ~90% positive, which would leave the calibration table
// with almost nothing in its low buckets and light 9 dots in 10 for "recommends", so
// positive and negative reviews are pulled as two streams and mixed (default 35% negative),
// then shuffled with a fixed seed so the matrix isn't a block of green over a block of red.
// Only reviews that already fit in 280 characters are kept; nothing is truncated.

import { mkdir, writeFile } from "node:fs/promises";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const APPID = String(args.appid ?? "1245620");
const COUNT = Number(args.count ?? 10_000);
const NEGATIVE_SHARE = Number(args.negative ?? 0.35);
const MAX_CHARS = 280;
const MIN_CHARS = 12;
const OUT = `data/steam-${APPID}.json`;

function clean(text) {
  return text
    .replace(/\[\/?(b|i|u|h[1-3]|list|\*|url[^\]]*|spoiler|strike|quote[^\]]*|code|table|tr|th|td|noparse)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mostly-ASCII letters, so ASCII art, emoji walls, and mislabelled non-English reviews are dropped. */
function looksEnglish(text) {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return letters >= text.length * 0.55;
}

async function pull(reviewType, want) {
  const out = [];
  const seen = new Set();
  let cursor = "*";
  for (let page = 0; out.length < want && page < 400; page++) {
    const url =
      `https://store.steampowered.com/appreviews/${APPID}?json=1&language=english&filter=recent&purchase_type=all` +
      `&review_type=${reviewType}&num_per_page=100&cursor=${encodeURIComponent(cursor)}`;
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, { headers: { "user-agent": "jev-sweep-demo/1.0" } });
      if (res.ok) break;
      if (attempt >= 4) throw new Error(`Steam ${res.status} on ${reviewType} page ${page}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    const body = await res.json();
    if (body.success !== 1 || !body.reviews?.length || body.cursor === cursor) break;
    cursor = body.cursor;
    for (const r of body.reviews) {
      const text = clean(r.review ?? "");
      if (text.length < MIN_CHARS || text.length > MAX_CHARS || !looksEnglish(text) || seen.has(r.recommendationid)) continue;
      seen.add(r.recommendationid);
      out.push({
        id: r.recommendationid,
        text,
        voted_up: !!r.voted_up,
        hours: Math.round(((r.author?.playtime_forever ?? 0) / 60) * 10) / 10,
      });
    }
    process.stderr.write(`${reviewType}: ${out.length}/${want} kept from ${(page + 1) * 100} reviews\r`);
    await new Promise((r) => setTimeout(r, 120));
  }
  process.stderr.write("\n");
  return out.slice(0, want);
}

/** Deterministic shuffle (mulberry32) so a rebuild gives the same matrix. */
function shuffle(xs, seed = 1245620) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

const negWant = Math.round(COUNT * NEGATIVE_SHARE);
const negative = await pull("negative", negWant);
// If negatives ran short, positives fill the gap so the file still holds COUNT reviews.
const positive = await pull("positive", COUNT - negative.length);
const reviews = shuffle([...positive, ...negative]);

await mkdir("data", { recursive: true });
await writeFile(OUT, JSON.stringify({ appid: APPID, built: new Date().toISOString(), reviews }));
const up = reviews.filter((r) => r.voted_up).length;
const chars = reviews.reduce((s, r) => s + r.text.length, 0);
console.log(`wrote ${OUT}: ${reviews.length} reviews · ${up} thumbs up (${((100 * up) / reviews.length).toFixed(1)}%) · avg ${Math.round(chars / reviews.length)} chars`);
