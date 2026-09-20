// Screenshots /grid (and /race, /sweep) against the dev server on port 3000 and
// reports console errors. Uses playwright-core plus the Chromium already cached in
// ~/Library/Caches/ms-playwright (no browser extension, no download).
//
//   node scripts/screenshot.mjs                 # all shots → screenshots/
//   node scripts/screenshot.mjs finder set      # a subset
//
// playwright-core is resolved from this project first, then from a sibling project
// (set PLAYWRIGHT_CORE to a node_modules/playwright-core path to override).

import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const candidates = [process.env.PLAYWRIGHT_CORE, "playwright-core", path.resolve("../animation/node_modules/playwright-core")].filter(Boolean);
let chromium;
for (const c of candidates) {
  try {
    ({ chromium } = require(c));
    break;
  } catch {}
}
if (!chromium) throw new Error(`playwright-core not found; tried ${candidates.join(", ")}`);

const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const rev = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
const executablePath = path.join(cache, rev, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
if (!existsSync(executablePath)) throw new Error(`Chromium not found at ${executablePath}`);

const BASE = process.env.BASE ?? "http://localhost:3000";

// Each shot: query, the text that means every request for it has landed, optional page setup.
const SHOTS = {
  finder: { q: "spinning top at the end", settled: /found it/ },
  set: { q: "a comedy", settled: /\d+ films fit/ },
  nothing: { q: "qwzx plmk", settled: /doesn't point at a film/ },
  negation: { q: "the nolan one that isn't inception", settled: /ruled out: Inception/ },
  neardup: { q: "ripley and the xenomorph", settled: /Too close to call|found it/ },
  // The race against a chat model (needs OPENAI_API_KEY). `race-end` runs the script and stops on the closing card.
  race: { path: "/race", q: "spinning top at the end", settled: /attempt|writing|first token/i, extra: 4000 },
  // The recording layout at rest, to check the wall mounts before any script runs.
  "demo-idle": { path: "/grid?demo=1", q: "", settled: /ROUND TRIP/, extra: 1500 },
  // Scripted speech on the recording layout: the badge shows while words land.
  listening: { path: "/grid?demo=1&script=grid-voice&delay=1500", q: "", settled: /listening/, extra: 1200 },
  "race-end": { path: "/race?demo=1&script=race&delay=300", q: "", settled: /first answer after/i },
  // Typed out through a preset chip so the confidence sparkline fills in keystroke by keystroke.
  trace: {
    q: "",
    settled: /Start typing/,
    async after(page) {
      await page.getByRole("button", { name: "he talks to a volleyball" }).click();
      await page.waitForFunction(() => /found it/.test(document.body.innerText) && !/typing…/.test(document.body.innerText), null, { timeout: 30_000 });
      await page.waitForTimeout(900);
    },
  },
  // Follow-up: lock on Alien, press Enter to keep it as context, then correct it.
  refine: {
    q: "alien on the spaceship, chestburster",
    settled: /found it/,
    async after(page) {
      const input = page.getByPlaceholder("the one where…");
      await input.press("Enter");
      await page.waitForFunction(() => /after: Alien \(1979\)/.test(document.body.innerText), null, { timeout: 10_000 });
      await input.pressSequentially("no, the sequel", { delay: 60 });
      await page.waitForFunction(() => /ruled out: Alien/.test(document.body.innerText) && /found it/.test(document.body.innerText), null, { timeout: 30_000 });
      await page.waitForTimeout(900);
    },
  },
  // The sweep: 10,000 Steam reviews judged against one criterion. `run=1` starts it on load; settled when every review is judged.
  sweep: { path: "/sweep?run=1", q: "the reviewer recommends this game", settled: /10,000 \/ 10,000/, extra: 1200 },
  "sweep-demo": { path: "/sweep?demo=1&run=1", q: "complains about performance but still loves it", settled: /10,000 \/ 10,000/, extra: 1200, viewport: { width: 1920, height: 1080 } },
  "sweep-portrait": { path: "/sweep?demo=1&layout=portrait&run=1", q: "is joking or being sarcastic", settled: /80 of 80 requests/, extra: 1200, viewport: { width: 1080, height: 1350 } },
  // The firehose: judged posts land at network pace, so the shot waits ~12 s for the matrix to fill in.
  "sweep-live": { path: "/sweep?live=1&run=1", q: "is about sport", settled: /connected to Jetstream|\d+\/s now/, extra: 12000 },
  "sweep-live-demo": { path: "/sweep?live=1&demo=1&run=1", q: "is complaining about something", settled: /connected to Jetstream/, extra: 12000, viewport: { width: 1920, height: 1080 } },
  // The meetup planner: three origins on the schematic map (desktop and phone).
  meet: { path: "/meet?o=BXN,WWL,EBY", q: "pub with a garden, not a chain, everyone under 35 min", settled: /a place|nothing yet/, extra: 1200 },
  // Enter commits the pick: routes draw along the graph, TfL verifies each person's journey, the card lists the legs.
  "meet-result": {
    path: "/meet?o=BXN,WWL,EBY",
    q: "pub with a garden, not a chain",
    settled: /a place|nothing yet/,
    extra: 800,
    async after(page) {
      await page.getByPlaceholder(/pub with a garden/).press("Enter");
      await page.waitForFunction(() => /Meet at/.test(document.body.innerText) && !/planning…|finding places…/.test(document.body.innerText), null, { timeout: 30_000 });
      await page.waitForTimeout(1800); // the dash reveal
    },
  },
  // A simulated Northern line suspension: the line dims, the status pill says so, the pick avoids it.
  "meet-disrupt": { path: "/meet?o=BXN,WWL,EBY&disrupt=northern", q: "pub with a garden, not a chain", settled: /northern suspended \(simulated\)/i, extra: 1500 },
  // A live weekend closure (District west of Earl's Court, Piccadilly Hyde Park Corner–Acton Town on 19–20 Sep 2026): the closed
  // stretches dash, the pill names them, the pick avoids them, and the routes are TfL's own legs. Needs a closure to be live.
  "meet-closure": {
    path: "/meet?o=BXN,FBY,ACT&b=45",
    q: "pub, with a garden, lively",
    settled: /a place|nothing yet/,
    extra: 800,
    async after(page) {
      await page.getByPlaceholder(/pub with a garden/).press("Enter");
      await page.waitForFunction(() => /Meet at/.test(document.body.innerText) && !/planning…/.test(document.body.innerText), null, { timeout: 30_000 });
      await page.waitForTimeout(1800);
      if (!/closed/.test(await page.evaluate(() => document.body.innerText))) console.log("  note: no localised closure is live right now; the shot shows plain service");
    },
  },
  "meet-phone": { path: "/meet?o=BXN,WWL,EBY", q: "pub with a garden, not a chain", settled: /a place|nothing yet/, extra: 1200, viewport: { width: 390, height: 844 }, touch: true },
  // The phone's bottom sheet at its half state: a tap on a lit station previews it, a second tap commits (the map has no hover on touch).
  "meet-phone-sheet": {
    path: "/meet?o=BXN,WWL,EBY",
    q: "pub with a garden, not a chain",
    settled: /a place|nothing yet/,
    extra: 800,
    viewport: { width: 390, height: 844 },
    touch: true,
    async after(page) {
      const lit = await page.evaluate(() => {
        let best = null;
        for (const c of document.querySelectorAll("svg[role=img] circle")) {
          if (!c.querySelector("title")) continue;
          const b = c.getBoundingClientRect();
          if (b.top > 80 && b.bottom < 480 && (!best || b.width > best.w)) best = { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
        }
        return best;
      });
      await page.touchscreen.tap(lit.x, lit.y);
      await page.waitForTimeout(500);
      await page.touchscreen.tap(lit.x, lit.y);
      await page.waitForFunction(() => document.querySelector("[data-sheet-state]") && /Meet at/.test(document.body.innerText) && !/planning…|finding places…/.test(document.body.innerText), null, { timeout: 30_000 });
      await page.waitForTimeout(1800);
    },
  },
  sliders: {
    q: "a comedy",
    settled: /\d+ films fit/,
    async after(page) {
      // Drag two sliders; the wall re-sorts inside the set with no request.
      await page.getByLabel("Family-friendly weight").fill("1");
      await page.getByLabel("Scary weight").fill("-1");
      await page.waitForTimeout(900);
    },
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
await mkdir("screenshots", { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const problems = [];
const pages = new Map();
/** One page per viewport (the recording layouts are shot at their video sizes; everything else at 1440×1000); `touch` makes it a phone (touch events, mobile viewport). */
async function pageFor(viewport = { width: 1440, height: 1000 }, touch = false) {
  const key = `${viewport.width}x${viewport.height}${touch ? "-touch" : ""}`;
  if (pages.has(key)) return pages.get(key);
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(`[console.${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`[pageerror] ${err.message}`));
  page.on("requestfailed", (req) => {
  // A fetch the page aborted on purpose (a superseded keystroke, a replaced firehose criterion) is not a failure.
  if (req.failure()?.errorText === "net::ERR_ABORTED") return;
  problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ""}`);
});
  pages.set(key, page);
  return page;
}

for (const name of wanted) {
  const shot = SHOTS[name];
  if (!shot) throw new Error(`unknown shot ${name}`);
  const page = await pageFor(shot.viewport, shot.touch);
  const before = problems.length;
  const started = performance.now();
  const base = shot.path ?? "/grid";
  const sep = base.includes("?") ? "&" : "?";
  await page.goto(`${BASE}${base}${shot.q ? `${sep}q=${encodeURIComponent(shot.q)}` : ""}`, { waitUntil: "load" });
  await page.waitForFunction(([re, flags]) => new RegExp(re, flags).test(document.body.innerText), [shot.settled.source, shot.settled.flags], { timeout: 90_000 });
  await page.waitForTimeout(700 + (shot.extra ?? 0)); // let the spring layout finish
  if (shot.after) await shot.after(page);
  const file = path.join("screenshots", `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const chip = await page.locator("main .mono").first().innerText().catch(() => "");
  console.log(`${name.padEnd(9)} ${file}  ${Math.round(performance.now() - started)} ms  |  ${chip.replace(/\s+/g, " ").trim()}`);
  for (const p of problems.slice(before)) console.log(`   ${p}`);
}

await browser.close();
console.log(problems.length ? `\n${problems.length} console problem(s)` : "\nno console errors");
process.exit(problems.length ? 1 : 0);
