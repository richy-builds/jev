// Records /grid, /race or /sweep in demo mode as an mp4 for X. Opens the scripted page in headless Chromium
// with Playwright's video capture, waits for the script to finish, then re-encodes with ffmpeg.
//
//   node scripts/record.mjs                   # script "main" → recordings/grid-<timestamp>.mp4
//   node scripts/record.mjs main --delay=1200 # a different script / lead-in before typing
//   node scripts/record.mjs race --page=race  # the split-screen race → recordings/race-<timestamp>.mp4
//   node scripts/record.mjs grid-voice --voice # a spoken description, with a synthesised voice track
//   node scripts/record.mjs main --page=sweep  # the 10,000-review sweep, 16:9
//   node scripts/record.mjs mobile --page=sweep --portrait  # the 4:5 cut for mobile X (1080×1350, captions in the script)
//   node scripts/record.mjs live --page=sweep --live  # the Bluesky firehose on the same page
//   node scripts/record.mjs meet-main --page=meet --portrait  # the meetup planner: origins, vibe, commit, a simulated suspension, share
//   node scripts/record.mjs meet-phone --page=meet --phone  # the planner's real phone UI (390×844 at 3×) framed as a 9:16 phone
//
// Needs the dev (or prod) server on port 3000 (override with BASE). playwright-core and Chromium
// are resolved exactly as in screenshot.mjs; ffmpeg from PATH or /opt/homebrew/bin.

import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
const args = process.argv.slice(2);
const script = args.find((a) => !a.startsWith("--")) ?? "main";
const delay = Number(args.find((a) => a.startsWith("--delay="))?.slice(8) ?? 1500);
/** Which page's script to record: /grid (default) or /race. */
const pageName = args.find((a) => a.startsWith("--page="))?.slice(7) ?? "grid";
/** --voice: synthesise the script's spoken line with macOS `say` and mux it in, aligned to when the words started landing. */
const voice = args.includes("--voice");
const SAY_WPM = 158; // ≈ 380 ms per word, matching SAY_MS_PER_WORD in lib/script.ts
/** --portrait: 4:5 for the mobile X feed; the page gets &layout=portrait and stacks. */
const portrait = args.includes("--portrait");
/** --live: the Bluesky firehose mode of /sweep (adds &live=1). */
const liveMode = args.includes("--live");
/**
 * --phone: the real phone UI, not the demo layout (no &demo=1, so the light theme, the
 * legend, the shortlist and the bottom sheet), at a 390×844 viewport captured at 3× and
 * framed as a rounded phone on the dark background of a 1080×1920 canvas. The 3× comes
 * from a launch flag: Playwright's screencast captures an emulated deviceScaleFactor at
 * CSS pixels, but honours one forced at launch.
 */
const phone = args.includes("--phone");
const PHONE = { width: 390, height: 844, scale: 3, radius: 44, canvas: { width: 1080, height: 1920 }, frameWidth: 830, bg: "0x07080c" };
const WIDTH = phone ? PHONE.width * PHONE.scale : portrait ? 1080 : 1920;
const HEIGHT = phone ? PHONE.height * PHONE.scale : portrait ? 1350 : 1080;

const exec = promisify(execFile);
const ffmpeg = ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((f) => f === "ffmpeg" || existsSync(f));

await mkdir("recordings", { recursive: true });
const tmp = await mkdtemp(path.join(os.tmpdir(), "jev-rec-"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.join("recordings", `${pageName}${liveMode ? "-live" : ""}${portrait ? "-portrait" : ""}${phone ? "-phone" : ""}-${stamp}.mp4`);

const browser = await chromium.launch({ executablePath, headless: true, args: phone ? [`--force-device-scale-factor=${PHONE.scale}`] : [] });
const context = await browser.newContext({
  viewport: phone ? { width: PHONE.width, height: PHONE.height } : { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: phone ? PHONE.scale : 1,
  hasTouch: phone,
  recordVideo: { dir: tmp, size: { width: WIDTH, height: HEIGHT } },
});
const videoStart = Date.now(); // the webm starts with the first page in the context
const page = await context.newPage();
const problems = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") problems.push(`[console.${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => problems.push(`[pageerror] ${err.message}`));
page.on("requestfailed", (req) => {
  // A fetch the page aborted on purpose (a superseded keystroke, a replaced firehose criterion) is not a failure.
  if (req.failure()?.errorText === "net::ERR_ABORTED") return;
  problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ""}`);
});

const url = `${BASE}/${pageName}?${phone ? "layout=phone" : "demo=1"}&script=${encodeURIComponent(script)}&delay=${delay}${portrait ? "&layout=portrait" : ""}${liveMode ? "&live=1" : ""}`;
console.log(`recording ${url}`);
const started = performance.now();
// Not "networkidle": the script starts firing requests as soon as the page mounts.
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector('body[data-demo-done="1"]', { timeout: 120_000 });
await page.waitForTimeout(300);
const hud = await page.locator("main .mono").first().innerText();
const demoStart = Number(await page.evaluate(() => document.body.dataset.demoStart));
const sayStart = Number(await page.evaluate(() => document.body.dataset.sayStart ?? 0));
const sayText = await page.evaluate(() => document.body.dataset.sayText ?? "");
await context.close(); // flushes the webm
await browser.close();

const webm = (await readdir(tmp)).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("no video was written");
const src = path.join(tmp, webm);

if (ffmpeg) {
  // Trim the lead-in (page load + warm-up + delay) so the clip opens just before the first keystroke.
  const skip = Math.max(0, (demoStart - videoStart) / 1000 - 0.4).toFixed(2);
  const video = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", "30", "-movflags", "+faststart"];
  if (phone) {
    // The phone screen scaled onto the canvas with rounded corners (an alpha mask by geq: inside the
    // corner squares, opaque within radius r of the corner's centre), centred over the dark background.
    const { radius: r, canvas, frameWidth: w, bg } = PHONE;
    const alpha = `if(gt(abs(W/2-X),W/2-${r})*gt(abs(H/2-Y),H/2-${r}),if(lte(hypot(${r}-(W/2-abs(W/2-X)),${r}-(H/2-abs(H/2-Y))),${r}),255,0),255)`;
    const filter = `[0:v]scale=${w}:-2,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[fg];color=c=${bg}:s=${canvas.width}x${canvas.height}:r=30[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p`;
    await exec(ffmpeg, ["-y", "-ss", skip, "-i", src, "-filter_complex", filter, ...video, "-an", out], { maxBuffer: 1 << 26 });
  } else if (voice && sayText && sayStart) {
    // The spoken line, offset to where the first word landed in the trimmed clip.
    const aiff = path.join(tmp, "voice.aiff");
    await exec("/usr/bin/say", ["-r", String(SAY_WPM), "-o", aiff, sayText]);
    const offset = ((sayStart - demoStart) / 1000 + 0.4).toFixed(2);
    await exec(ffmpeg, ["-y", "-ss", skip, "-i", src, "-itsoffset", offset, "-i", aiff, "-map", "0:v", "-map", "1:a", ...video, "-c:a", "aac", "-b:a", "128k", out]);
  } else {
    if (voice) console.log("--voice: the script has no `say` step, writing silent video");
    await exec(ffmpeg, ["-y", "-ss", skip, "-i", src, ...video, "-an", out]);
  }
  await rm(tmp, { recursive: true, force: true });
  console.log(`wrote ${out}`);
} else {
  const keep = out.replace(/\.mp4$/, ".webm");
  await rename(src, keep);
  console.log(`ffmpeg not found; kept ${keep} (X wants mp4, convert it yourself)`);
}

console.log(`took ${Math.round((performance.now() - started) / 1000)} s  |  ${hud.replace(/\s+/g, " ").trim()}`);
for (const p of problems) console.log(`   ${p}`);
console.log(problems.length ? `${problems.length} console problem(s)` : "no console errors");
process.exit(problems.length ? 1 : 0);
