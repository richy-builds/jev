# Jev demos

Five small Next.js pages that put [Jev](https://typesafe.ai), TypeSafe's System One model, in front of
a lot of data at once. Jev answers typed questions (yes/no with a probability, a choice over options)
in a few hundred milliseconds with no generated text, so every page here re-judges on each keystroke.

| Route | What it shows |
| --- | --- |
| `/` | **Jev Live** — intent, tone, sarcasm and churn dials that move as you type a support message. |
| `/grid` | **Find the movie** — 258 film posters re-sort live against a vague description ("shark but dinosaurs"). One Choice over 250 options plus a "matches anything?" Noul per call, ~350–500 ms warm. Press Enter or "not it" to refine ("no, the sequel"). |
| `/race` | **Jev vs a chat model** — the same input to both sides. Jev returns 13 answers in ~1.4 s for ~2¢; the chat model (GPT-5.6 Sol, streamed, restarted on every keystroke) finishes 6 of them in ~2.7 s for ~9¢. |
| `/sweep` | **10,000 Steam reviews in ~2–3 s** — type a criterion, watch a dot-matrix of 10k Elden Ring reviews light up (≈3,000–5,000 judgments/s, 3.3¢). Live mode runs the same thing on the Bluesky firehose, with a second "unsafe for a public screen" Noul hiding posts. |
| `/meet` | **Where should we meet** — 2–5 friends across London type a vibe; Jev ranks tube stations against it, a client-side tube graph enforces everyone's travel budget, TfL's journey planner verifies the pick on commit and live line closures force a re-pick. Own SVG tube map, share links, OG image. |

Each page has an "inside the call" view showing the request, the response and the wall-clock latency,
because the point is that this is one round trip, not a pipeline.

## Run

```sh
cp .env.example .env.local     # TYPESAFE_API_KEY required; OPENAI_API_KEY for /race
npm install
node scripts/build-movies.mjs  # /grid and /race: fetches 258 posters from Wikipedia into public/posters (not committed)
npm run dev
```

`data/` holds the built datasets (movies, 10k Steam reviews, 272 tube stations with hand-written
hooks, the tube graph); the `scripts/build-*.mjs` scripts regenerate them.

## What was measured

- **Throughput** (`scripts/throughput.mjs`, 10k HN comments): ~2,600–2,900 items/s sustained without
  rate limiting, 4,000+ in bursts. The binding limit is tokens/s, not requests/s.
- **Request shape matters more than batch size** (`scripts/calibrate-steam.mjs`, against Steam's own
  thumbs): pointing questions at `state.reviews[i].text` decays with position inside a batch (AUC 0.93
  at batch 10 → 0.56 at 250); quoting the text inline in each question is flat at AUC 0.93 from 10 to
  250. Write-up in `docs/sweep-calibration.md`.
- **Robustness probes** for `/grid` and `/meet` (`scripts/probe.mjs`, `scripts/probe-meet.mjs`,
  results in `scripts/probe-results/`): vague descriptions, negation, nonsense, follow-ups.

## Recording

The pages double as video sets. `node scripts/record.mjs <script> --page=<route> [--portrait] [--voice]`
drives a scripted session headless with Playwright and encodes an H.264 clip into `recordings/`;
`node scripts/screenshot.mjs <shot>` captures stills. Scripts live in each page's `SCRIPTS` table.

## Layout

```
app/            one folder per route, plus app/api/* server routes that hold the keys
lib/            Jev question builders, hooks (use-find, use-turns, use-speech, use-meet), tube graph, closures
data/           built datasets
scripts/        dataset builders, probes, calibration, throughput, recording
docs/           calibration and robustness write-ups
```
