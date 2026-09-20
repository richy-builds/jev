# Robustness brief: progress and measured findings (2026-09-19)

Working notes for docs/robustness-brief.md. Everything below is measured, not guessed.
Probe results live in scripts/probe-results/*.json (before, step1-filter-exclude,
step2-catalogue258, exp-fields-on). Re-run: `node scripts/probe.mjs --label X --compare step2-catalogue258`
against the dev server on port 3000.

## Done (API side)

| Item | Status | Files |
| --- | --- | --- |
| 0 Probe script | done, 52 queries, 17 held-out (`held: true`), `--group`, `--set`, `--repeat`, `--compare` | scripts/probe.mjs |
| 1 Filter mode + router | done: router Choice in main call; per-film Nouls in a second `/api/fits` request | lib/find.ts, app/api/find, app/api/fits |
| 2 Exclusion | done: speculative Choice per chunk with `none`, zeroed + renormalised at P ≥ 0.5 | lib/find.ts mergeAnswers |
| 3 Offline scores | done: data (5 dims, 258 films, $0.0071) + sliders on the page (lib/scores.ts) | scripts/score-movies.mjs, data/movie-scores.json |
| 4 Evidence tags | done: `/api/inspect` (5 Nouls × top 3, threshold 0.6) + tags under the best match | lib/inspect.ts, app/api/inspect |
| 5 Near-dup pass | done: same `/api/inspect` (Choice over top 5 with summary/director/cast; `close` when gap < 0.3) + split bar on the page | same |
| 6 Catalogue | done: Goodfellas hook rewritten; 6 missing films were Wikipedia title mismatches (now 258 films); Wikipedia intro `summary` + Wikidata `director`/`cast`/`genre` per film (keyless); chunked Choices (2 × 129) | scripts/build-movies.mjs, lib/movies.ts |
| 7 Latency (half hooks) | measured and rejected: 23.6k tokens, p50 399 vs 463 ms, but presets min 89%, "fava beans" → nothing, quotes −14–16 pts (step3-halfhooks.json). `HALF_HOOKS = false` in lib/find.ts |

## Done (page, 2026-09-19)

- app/grid/page.tsx rewritten on the new `FindResponse`; lib/scores.ts added; screenshots in
  screenshots/{finder,set,nothing,negation,neardup,sliders}.png via scripts/screenshot.mjs
  (no console errors); final report in docs/robustness-report.md. `scripts/probe.mjs --from <label>`
  re-renders a saved run without API calls.

## Key measurements

- Baseline (before): 52 probes, 79% pass, held-out 67%, every category query fails, presets min 89%, p50 419 ms, 21.2k tokens.
- Step 1 (router + exclusion, 250 films): 94% pass, held-out 89%, presets min 98%, p50 417 ms, 25.1k tokens (+4k for router + 250-id exclusion Choice).
- Step 2 (258 films, chunked, Wikipedia/Wikidata fields NOT in main state): 98% pass (51/52), held-out 100%, p50 463 ms, p95 520 ms, 26.2k tokens. Only miss: prefix "grumpy old man, ball" → Cast Away (ball ≈ volleyball).
- 250 per-film Nouls `Does movies[i] fit description?` (index reference): pure noise (Gravity 0.42 for "the funny one"; T2 0.90 for "dinosaurs"). Title in the question fixes it (Anchorman/Airplane 0.87, Goodfellas 0.32; Hereditary/Exorcist 0.95). Jaggedness: indirection + large state.
- 250 Nouls add +7.7k tokens and ~+330 ms warm **regardless of state size** (question-count driven: 720–890 ms with hooks, 600–720 ms with no hooks at all). Hence the second `/api/fits` request (~500 ms, ~25k tokens) fired only in set mode.
- Set threshold 0.7 chosen on tune set: at 0.69 the Tarantino query pulls in Goodfellas/The Departed. Misses Frozen 0.65, Moana 0.50 for "a musical".
- Exclusion: 0.94–0.99 on negations, none = 0.99–1.00 on controls. Preset "kids hide from a shark. no wait, dinosaurs" rules out Jaws at 0.77 — a real self-correction, allowed in the probe (excludedAlt).
- Chunk merge with per-chunk exists Nouls leaked mass (Dark Knight 100% → 75%): the absent chunk's Noul sits ~0.3. Replaced by a `chunk` Choice {movies_a, movies_b, neither} → back to 99–100%.
- director+genre in main state: 33.2k tokens (+7k), +15% latency, no probe gain, and set mode became far too liberal ("a comedy" 78 films vs 33). Kept out; used only in /api/inspect.
- Inspect pass: 250–340 ms, ~3.5k tokens. Tags: "I'll be back" line 0.98/scene 0.85; "spinning top" scene 0.98; "keanu bus" actor 0.98/plot 0.97; "90s prison escape" plot 0.94/era 0.96. Near-dup: "ripley and the xenomorph" 52/48 → 64/36 Alien.
- Offline scores: 6 calls, 169.5k tokens, $0.0071; extremes sane (Exorcist scariest, Spinal Tap least; Schindler's List/Life Is Beautiful/Titanic/Up top tearjerkers).
- Per-process warm-up: first 1–2 SDK calls in a fresh Node process are ~1.1 s; the probe does one warm-up call.
- Price: $0.042/Mtok → main call 26.2k ≈ $0.0011; set keystroke +$0.00105; inspect +$0.00015. Convert to € at the current rate in the report.
- Catalogue research: TMDB needs a key (not requested from the user); IMDb datasets have ratings/crew but no plots/posters; Wikipedia+Wikidata are keyless and gave summaries, posters, director, cast, genre for all 258. State cap (32k) limits ~85-token hooks to ~370 films; halving hooks (item 7) is the lever for growth.
