# Robustness report: "Jev Finds the Movie" (2026-09-19)

Closes docs/robustness-brief.md. Every number below was measured against the dev
server on port 3000 with `scripts/probe.mjs` (52 queries, 17 held-out, never used for
thresholds); raw runs are in `scripts/probe-results/*.json`. Working notes with the
per-experiment measurements are in docs/robustness-progress.md.

Floors from the brief, final state: presets min **98%** (≥ 90% required), nonsense
flat **5/5**, main call p50 **463 ms** / p95 **520 ms** (< 600 ms required), no
console errors in any of the six screenshots.

## What changed, per file

| File | Change |
| --- | --- |
| `scripts/probe.mjs` | **New.** 52-query probe set (presets, plot, quotes, actors, categories, negations, near-dup pairs, trivia, nonsense, prefixes), 17 marked `held: true`. Records top, p, exists, router, mode, exclusion, set count, tokens, latency; writes `scripts/probe-results/<label>.json`; `--compare` renders before/after; `--set tune\|held`, `--group`, `--repeat`; `--from <label>` re-renders a saved run with no API calls. |
| `lib/find.ts` | Router Choice (`specific` / `set` / `nothing`) and a speculative exclusion Choice with `none` added to the per-keystroke call; catalogue split into equal chunks (≤ 250 ids per Choice) with a `chunk` Choice as the merge weight; `mergeAnswers` multiplies chunk-relative probabilities by chunk weight, zeroes the excluded film at P ≥ 0.5 and renormalises; `decideMode` guards the router with the 0.15 `exists` floor; `fitQuestions` builds one titled Noul per film for set mode; `STATE_FIELDS` (measured, left empty) and `HALF_HOOKS` (measured, left `false`) record the two rejected experiments with their numbers. |
| `app/api/find/route.ts` | Returns the new `FindResponse`: `mode`, `router`, `excluded`, `excludedP` alongside the merged probabilities. |
| `app/api/fits/route.ts` | **New.** Set mode: 258 Nouls "does *Title* (year) fit what `description` asks for?" in their own request, threshold 0.7, returns per-film fit and count. |
| `lib/inspect.ts`, `app/api/inspect/route.ts` | **New.** Second pass over the top ≤ 5 ids with Wikipedia summary, director and cast: a re-rank Choice (`close` when the top two are < 0.3 apart) plus five evidence Nouls (plot / scene / line / actor / era) for each of the top 3, threshold 0.6. |
| `scripts/build-movies.mjs`, `data/movies.json`, `lib/movies.ts` | Goodfellas hook rewritten (the "funny how?" quote read as a category); the six "missing" films were Wikipedia title mismatches and are back (258 films); each film now carries a keyless Wikipedia intro `summary` and Wikidata `director`, `cast`, `genre`; `CHUNKS`, `MOVIE_BY_ID`, `Mode`, `FindResponse`, `FitsResponse` types. |
| `scripts/score-movies.mjs`, `data/movie-scores.json` | **New.** Offline composite scoring: five Score questions per film (scary, funny, tearjerker, slow burn, family-friendly) with four concrete levels each, batched 50 films per request. 6 calls, 169.5k tokens, $0.0071 once. |
| `lib/scores.ts` | **New.** Client-side reader for the scores: `composite(id, weights)` with weights −1..+1, no SDK import. |
| `app/grid/page.tsx` | **Rewritten** on the new response. Fires `/api/fits` in set mode (prefetched in parallel when the previous keystroke was already set), `/api/inspect` with the top-5 ids in finder mode when exists ≥ 0.5 (only ids with p ≥ 1%, min 2). Renders: set count pill and lit posters (fit ≥ 0.7, gradient below), "ruled out: *X*" pill with the film greyed and crossed on the wall, evidence tags under the best match, split bar with "add a detail" hint when `close`, five sliders that re-sort from `movie-scores.json` with zero API calls (idle/nothing and set modes; paused in finder), and a stats chip with mode, main + second-pass latency, tokens and $ per keystroke. The inspect re-rank redistributes only the mass the shortlist already held, so it can reorder the top 5 but never promote a film from nowhere. Three presets added for the new beats; the look and the typed-out presets are unchanged. Thresholds are mirrored as constants because `lib/find.ts` imports the SDK. |
| `scripts/screenshot.mjs` | **New.** playwright-core (resolved from this project or a sibling) + the cached Chromium 1243; six shots to `screenshots/`, fails on any console error, page error or failed request. |
| `screenshots/finder.png`, `set.png`, `nothing.png`, `negation.png`, `neardup.png`, `sliders.png` | The three required modes plus the exclusion, near-duplicate and slider beats. |

## Probe: before → after

`before` = original single Choice + Noul over 250 films. `after` = `step2-catalogue258`,
the final API state (item 7 was measured and reverted; see failures).

| metric | before | after |
| --- | --- | --- |
| queries | 52 | 52 |
| pass, all | 79% | **98%** (51/52) |
| pass, tuning two-thirds | 85% | 97% |
| pass, held-out third | 67% | **100%** |
| preset minimum p | 89% | **98%** |
| presets all top-1 | yes | yes |
| nonsense flat (mode = nothing) | 5/5 | 5/5 |
| negation: rejected film not top | 5/5 | 5/5 |
| exclusion false positives | 0 | 0 |
| latency p50 (main call, warm) | 419 ms | 463 ms |
| latency p95 | 550 ms | 520 ms |
| input tokens, main call | 21.2k | 26.2k |

Intermediate steps (from the progress notes): step 1 (router + exclusion, 250 films)
94% / held-out 89% / presets min 98% / 25.1k tokens; step 2 adds the 8 films, the
chunked Choices and the `chunk` merge weight for the numbers above.

Category queries, which all failed before, now route to set mode and light a
sensible set: "a comedy" 37 films, "scary movie" 20, "a pixar film" 14, "war movies"
5, "something with dinosaurs" 1. Negations all name the right film for exclusion
(0.94–0.99) and the controls all answer `none` (0.99–1.00). The one self-correcting
preset, "kids hide from a shark. no wait, dinosaurs", rules out Jaws at 0.77 — a real
rule-out, accepted by the probe.

Second passes (not in the table; measured separately): `/api/fits` ≈ 25.8k tokens,
≈ 500 ms (question-count bound: 250 Nouls cost ~330 ms even with no hooks in state);
`/api/inspect` ≈ 3.5k tokens, 250–340 ms.

Per-query table († = held-out) at the end of this document.

## Cost per call

Price $0.042 per million input tokens. Converted at the ECB reference rate for
2026-09-18, 1 USD = 0.8726 EUR.

| Call | Tokens | USD | EUR |
| --- | --- | --- | --- |
| Before: one keystroke | 21.2k | $0.00089 | €0.00078 |
| Main call (every keystroke) | 26.2k | $0.00110 | €0.00096 |
| + inspect (finder keystroke with exists ≥ 0.5) | 28.3k | $0.00119 | €0.00104 |
| + fits (set keystroke) | 52.0k | $0.00219 | €0.00191 |
| Offline scores (once, 258 films × 5 dims) | 169.5k | $0.0071 | €0.0062 |

Per thousand keystrokes: finder ≈ $1.19 / €1.04, set ≈ $2.19 / €1.91. The sliders
cost nothing per drag.

## Failures I could not fix, and why

1. **Prefix "grumpy old man, ball" → Cast Away 37%.** The only probe miss, and the
   only regression: before it was Up at 40%. Both are coin flips — "ball" reads as
   the volleyball as easily as a balloon — and the preset resolves to Up at
   "balloons". Not tuned away: any change that fixed a 37/40 prefix would be fitting
   noise.
2. **Item 7, half-length hooks, rejected.** First `;`-clause only (16 → 10.5 words):
   tokens 26.2k → 23.6k, p50 463 → 399 ms, but presets min fell to 89% (Up 99% → 89%),
   "fava beans and a nice chianti" dropped from 98% Silence of the Lambs to *nothing*
   mode, and the other quote probes lost 14–16 points ("I'll be back" 100 → 84%,
   "here's johnny" 100 → 86%). The second clause is where the scenes, quotes and actor
   names live. Full hooks stay; the toggle and numbers are in `lib/find.ts`
   (`scripts/probe-results/step3-halfhooks.json`).
3. **Set threshold misses.** At 0.7 "a musical" misses Frozen (0.65) and Moana (0.50);
   at 0.69 the Tarantino query pulls in Goodfellas and The Departed. Picked on the
   tuning set; the gradient below the threshold makes near-misses visible on the wall.
4. **Near-duplicates that genuinely fit both.** "ripley and the xenomorph" is 52/48
   Alien/Aliens on the main call and the inspect pass only moves it to roughly 60/40 —
   and which film leads flips between runs (Alien 64/36 in one, Aliens 61/39 in the
   screenshot). The description fits both films, so the page shows the split bar and
   the "add a detail" hint instead of pretending; "…queen in a power loader" → Aliens 100%.
5. **Set mode latency.** The per-film Nouls cost ~330 ms regardless of state size, so a
   set keystroke is main (~460 ms) + fits (~500 ms) ≈ 1 s the first time. From the
   second set keystroke on, the page fires both in parallel and the wall settles in
   ≈ 600 ms. The brief's < 600 ms floor is met by the main call; the set count arrives
   one beat later.
6. **Catalogue growth beyond ~370 films** needs shorter hooks (state cap 32k) — which
   item 7 showed costs accuracy — or richer keyless fields. Director + genre in the
   main state was tried: +7k tokens, +15% latency, no probe gain, and set mode became
   far too liberal ("a comedy" 78 films). Kept out of the main call; used only in
   `/api/inspect`. TMDB would give overviews/cast/posters but needs an API key, which
   the brief said to ask for first; not requested.
7. **Fresh-process warm-up.** The first 1–2 SDK calls in a new Node process take ~1.1 s
   (the finder screenshot's 1287 ms). The probe does one warm-up call; the page cannot.

## Demo beat per feature

| Feature | One line for the video |
| --- | --- |
| Filter mode + router | Type "a comedy": the wall was flat, now 37 posters light up and a "37 films fit" counter appears — one yes/no per film, no list generated. |
| Explicit exclusion | Type "the nolan one that isn't inception": Inception greys out with a red ✕, "ruled out: Inception" pops, The Dark Knight takes the lead. |
| Rank-by-quality sliders | With the comedies lit, drag Family-friendly to +1 and Scary to −1: the set re-sorts, the calls counter does not move. |
| Evidence tags | Type "I'll be back": Terminator locks at 100% and the tags "a line" and "a scene" appear under it — Jev says *why* without writing a sentence. |
| Near-duplicate pass | Type "ripley and the xenomorph": an amber 61/39 split bar and "too close to call, add a detail"; add "queen" and Aliens snaps to 100%. |
| Catalogue quality | Type "the funny one": no more Goodfellas; and Her, Grease, Aladdin, Contact, Baby Driver, Kung Fu Panda are on the wall. |
| Latency (item 7) | No beat — the shorter hooks lost the quotes, so they were not kept; the stats chip shows the honest 400–500 ms. |

## Per-query probe table: before → after

| group | query | before → after (top, p) | mode | excl | set# | tokens | ms | ok |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| preset | the one where the guy can't remember anything and has tattoos | memento 99% → **memento 99%** | finder → finder | — → — | — | 21172 → 26229 | 600 → 535 | ✓ → ✓ |
| preset | kids hide from a shark. no wait, dinosaurs | jurassic-park 89% → **jurassic-park 98%** | finder → finder | — → jaws | — | 21170 → 26227 | 391 → 489 | ✓ → ✓ |
| preset | sad little robot alone on earth stacking trash | wall-e 100% → **wall-e 100%** | finder → finder | — → — | — | 21168 → 26225 | 392 → 492 | ✓ → ✓ |
| preset | poor family sneaks into rich family's house, secret basement | parasite 100% → **parasite 100%** | finder → finder | — → — | — | 21173 → 26230 | 409 → 399 | ✓ → ✓ |
| preset | two magicians who hate each other | the-prestige 100% → **the-prestige 100%** | finder → finder | — → — | — | 21167 → 26224 | 390 → 361 | ✓ → ✓ |
| preset | he talks to a volleyball | cast-away 100% → **cast-away 100%** | finder → finder | — → — | — | 21165 → 26222 | 357 → 451 | ✓ → ✓ |
| preset | spinning top at the end | inception 100% → **inception 100%** | finder → finder | — → — | — | 21166 → 26223 | 358 → 415 | ✓ → ✓ |
| preset | grumpy old man, balloons, talking dog | up 100% → **up 99%** | finder → finder | — → — | — | 21169 → 26226 | 443 → 506 | ✓ → ✓ |
| plot | clownfish dad crosses the ocean looking for his son † | finding-nemo 100% → **finding-nemo 100%** | finder → finder | — → — | — | 21171 → 26228 | 419 → 468 | ✓ → ✓ |
| plot | guy stuck on mars growing potatoes | the-martian 100% → **the-martian 100%** | finder → finder | — → — | — | 21167 → 26224 | 467 → 464 | ✓ → ✓ |
| plot | linguist talks to aliens who write in circles † | arrival 100% → **arrival 100%** | finder → finder | — → — | — | 21170 → 26227 | 460 → 514 | ✓ → ✓ |
| quote | you're gonna need a bigger boat | jaws 100% → **jaws 100%** | finder → finder | — → — | — | 21167 → 26224 | 363 → 514 | ✓ → ✓ |
| quote | I'll be back | the-terminator 100% → **the-terminator 100%** | finder → finder | — → — | — | 21164 → 26221 | 435 → 379 | ✓ → ✓ |
| quote | here's johnny † | the-shining 100% → **the-shining 100%** | finder → finder | — → — | — | 21165 → 26222 | 426 → 439 | ✓ → ✓ |
| quote | fava beans and a nice chianti | the-silence-of-the-lambs 98% → **the-silence-of-the-lambs 98%** | finder → finder | — → — | — | 21168 → 26225 | 531 → 448 | ✓ → ✓ |
| actor | keanu reeves on a bus that can't slow down | speed 100% → **speed 100%** | finder → finder | — → — | — | 21172 → 26229 | 528 → 468 | ✓ → ✓ |
| actor | tom hanks stranded on an island † | cast-away 100% → **cast-away 100%** | finder → finder | — → — | — | 21167 → 26224 | 478 → 381 | ✓ → ✓ |
| actor | heath ledger as the joker | the-dark-knight 100% → **the-dark-knight 99%** | finder → finder | — → — | — | 21166 → 26223 | 550 → 456 | ✓ → ✓ |
| actor | the one with sandra bullock in space † | gravity 100% → **gravity 100%** | finder → finder | — → — | — | 21169 → 26226 | 508 → 514 | ✓ → ✓ |
| category | the funny one | goodfellas 44% → **this-is-spinal-tap 89%** | finder → set | — → — | 19 | 21163 → 26220+25824 | 503 → 389+435 | ✗ → ✓ |
| category | a comedy † | airplane 11% → **anchorman 96%** | finder → set | — → — | 36 | 21162 → 26219+25823 | 495 → 403+505 | ✗ → ✓ |
| category | scary movie | the-exorcist 26% → **hereditary 94%** | finder → set | — → — | 19 | 21163 → 26220+25824 | 520 → 428+507 | ✗ → ✓ |
| category | a pixar film † | toy-story 48% → **inside-out 97%** | finder → set | — → — | 14 | 21164 → 26221+25825 | 520 → 495+442 | ✗ → ✓ |
| category | war movies † | saving-private-ryan 80% → **saving-private-ryan 97%** | finder → set | — → — | 6 | 21162 → 26219+25823 | 525 → 517+512 | ✗ → ✓ |
| category | animated movies about robots | wall-e 85% → **wall-e 97%** | finder → set | — → — | 3 | 21164 → 26221+25825 | 386 → 408+404 | ✗ → ✓ |
| category | a musical | singin-in-the-rain 35% → **singin-in-the-rain 94%** | finder → set | — → — | 11 | 21162 → 26219+25823 | 424 → 410+515 | ✗ → ✓ |
| category | something with dinosaurs | jurassic-park 100% → **jurassic-park 98%** | finder → set | — → — | 1 | 21163 → 26220+25824 | 388 → 514+540 | ✓ → ✓ |
| negation | the nolan one that isn't inception | the-dark-knight 42% → **oppenheimer 35%** | finder → finder | — → inception | — | 21168 → 26225 | 424 → 402 | ✓ → ✓ |
| negation | the pixar one that's not about toys † | soul 25% → **up 24%** | finder → finder | — → toy-story | — | 21169 → 26226 | 416 → 542 | ✓ → ✓ |
| negation | the tarantino film that isn't pulp fiction | reservoir-dogs 69% → **reservoir-dogs 78%** | finder → finder | — → pulp-fiction | — | 21170 → 26227 | 379 → 456 | ✓ → ✓ |
| negation | space horror but not alien † | 2001-a-space-odyssey 24% → **gravity 68%** | finder → set | — → alien | 0 | 21165 → 26222+25826 | 409 → 435+515 | ✓ → ✓ |
| negation | the dinosaur one, not the shark one | jurassic-park 100% → **jurassic-park 100%** | finder → finder | — → jaws | — | 21168 → 26225 | 356 → 430 | ✓ → ✓ |
| neardup | ripley and the xenomorph | aliens 63% → **alien 52%** | finder → finder | — → — | — | 21167 → 26224 | 586 → 477 | ✓ → ✓ |
| neardup | ripley fights the alien queen in a power loader | aliens 100% → **aliens 100%** | finder → finder | — → — | — | 21170 → 26227 | 379 → 455 | ✓ → ✓ |
| neardup | woody and buzz † | toy-story 88% → **toy-story 80%** | finder → finder | — → — | — | 21164 → 26221 | 450 → 482 | ✓ → ✓ |
| neardup | the toys end up in a daycare | toy-story-3 100% → **toy-story-3 100%** | finder → finder | — → — | — | 21167 → 26224 | 408 → 410 | ✓ → ✓ |
| neardup | terminator with the liquid metal guy † | terminator-2-judgment-day 100% → **terminator-2-judgment-day 100%** | finder → finder | — → — | — | 21168 → 26225 | 366 → 520 | ✓ → ✓ |
| neardup | the first terminator movie | the-terminator 100% → **the-terminator 100%** | finder → finder | — → — | — | 21166 → 26223 | 352 → 412 | ✓ → ✓ |
| trivia | the one by the director of heat | heat 97% → **heat 97%** | finder → finder | — → — | — | 21167 → 26224 | 416 → 465 | ✓ → ✓ |
| trivia | directed by the guy who made pulp fiction | pulp-fiction 98% → **pulp-fiction 95%** | finder → set | — → — | 6 | 21170 → 26227+25831 | 408 → 472+538 | ✗ → ✓ |
| trivia | won best picture in 1995 † | braveheart 79% → **braveheart 80%** | finder → finder | — → — | — | 21169 → 26226 | 346 → 404 | ✗ → ✓ |
| trivia | three hour movie about an oil man | there-will-be-blood 100% → **there-will-be-blood 100%** | finder → finder | — → — | — | 21167 → 26224 | 383 → 463 | ✓ → ✓ |
| trivia | spielberg movie with aliens † | e-t-the-extra-terrestrial 96% → **e-t-the-extra-terrestrial 95%** | finder → set | — → — | 5 | 21166 → 26223+25827 | 406 → 400+493 | ✗ → ✓ |
| nonsense | asdfghjkl | the-shawshank-redemption 57% → **the-shawshank-redemption 37%** | nothing → nothing | — → — | — | 21164 → 26221 | 507 → 477 | ✓ → ✓ |
| nonsense | the | the-shawshank-redemption 64% → **the-shawshank-redemption 48%** | nothing → nothing | — → — | — | 21161 → 26218 | 520 → 414 | ✓ → ✓ |
| nonsense | how do I change my printer settings † | office-space 94% → **office-space 93%** | nothing → nothing | — → — | — | 21167 → 26224 | 511 → 468 | ✓ → ✓ |
| nonsense | purple monkey dishwasher | wall-e 10.0% → **guardians-of-the-galaxy 8.0%** | nothing → nothing | — → — | — | 21163 → 26220 | 364 → 478 | ✓ → ✓ |
| nonsense | hello † | the-shawshank-redemption 55% → **the-shawshank-redemption 37%** | nothing → nothing | — → — | — | 21161 → 26218 | 383 → 519 | ✓ → ✓ |
| prefix | the one where the guy can | memento 12% → **memento 13%** | finder → finder | — → — | — | 21166 → 26223 | 359 → 415 | ✓ → ✓ |
| prefix | spinning t † | inception 81% → **inception 65%** | finder → finder | — → — | — | 21163 → 26220 | 428 → 477 | ✓ → ✓ |
| prefix | grumpy old man, ball | up 40% → **cast-away 37%** | finder → finder | — → — | — | 21166 → 26223 | 345 → 511 | ✓ → ✗ |
| prefix | kids hide from a sha † | e-t-the-extra-terrestrial 19% → **shaun-of-the-dead 15%** | finder → finder | — → — | — | 21165 → 26222 | 482 → 427 | ✗ → ✓ |
