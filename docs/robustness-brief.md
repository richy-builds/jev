# Brief: make "Jev Finds the Movie" robust to the queries it currently fails

You are working in `~/Richy/jev`, a Next.js 16 App Router project (React 19, Tailwind v4, framer-motion, `@typesafe-ai/sdk` 0.6). It holds demo pages for short X videos about Jev, TypeSafe's System One model, which answers typed questions (Choice, Score, Noul) with calibrated probabilities instead of generating text. Read the TypeSafe skill and the live docs before designing questions, in particular the primitives pages, the speculative fan-out and composite scoring patterns, and the jev-1.13 jaggedness page. Keep the API key server-side.

## What exists

- `app/grid/page.tsx`: the poster wall. As you type a vague description, 250 film posters re-sort on every keystroke. Presets type themselves out for recording. Deep link `/grid?q=`.
- `app/api/find/route.ts` and `lib/find.ts`: one `systemOne` call per keystroke. State is `{ description, movies: [{id, title, year, hook}] }`. Questions are one Choice with the 250 film ids as undescribed options (the catalogue in state carries their meaning) and one Noul, "does the description recognisably describe any film in the list". The page uses the Noul to keep the wall flat on meaningless input, because Choice probabilities always sum to 1 and park on the first film otherwise.
- `scripts/build-movies.mjs`: hand-written film list with plot-first hooks, fetches posters and canonical titles from the Wikipedia API (no key, polite retry on 429), writes `data/movies.json` and `public/posters/*.jpg`. 252 films built; `lib/movies.ts` caps at 250.
- Measured today: ~21k input tokens per call, 350 to 500 ms warm, about $0.0009 per call. Every plot-fragment preset lands at 90% or higher.

Hard constraints: a Choice question accepts at most 255 options. State is capped at 32k tokens per request, 64k total. The user's `next dev` is usually already running on port 3000 and a second one refuses to start, so test against 3000. No browser extension is available; screenshots work with playwright-core plus the Chromium cached in `~/Library/Caches/ms-playwright`.

## What fails today, with evidence

1. Category descriptions. "The funny one" returns Goodfellas at 45% because its hook quotes the line "funny how?" and the model reads literally. "A comedy" spreads probability so thin nothing passes 12%. The Choice is forced to crown one film when many fit.
2. Negation. "The Nolan one that isn't Inception" ranks Inception near the top. Documented literal reading.
3. Near-duplicates. Alien versus Aliens, Toy Story versus Toy Story 3, split probability until the user adds a detail.
4. Multi-hop trivia and facts outside the hook: director, awards, runtime, "the one by the director of Heat".
5. Six well-known films have no Wikipedia poster and were dropped: Her, Aladdin, Baby Driver, Grease, Contact, Kung Fu Panda.
6. Hooks are about 85 tokens per film, which is most of the latency.

## What to build, in priority order

1. Filter mode. Add one Noul per film, "does `movies[i]` fit `description`?", to the same call as the Choice. Add a small router Choice in the same call: is the description looking for one specific film, a set of films sharing a quality, or nothing. Code reads the router and consumes the matching answers: finder mode keeps today's behaviour; set mode lights up every film whose Noul passes a threshold and shows a count; nothing mode keeps the wall flat. Measure the token and latency cost of adding 250 Nouls and report it.
2. Explicit exclusion. A speculative Choice, "which film does the description explicitly rule out?", with a `none` option, sent every call. Code zeroes the excluded film. Check it does not fire on descriptions with no negation.
3. Rank-by-quality with sliders. Score every film once, offline, on four or five dimensions with concrete level descriptions (for example scary, funny, tearjerker, slow, family-friendly), in batches that respect the state cap. Store expected scores in `data/movie-scores.json`. Add sliders to the page that re-sort the wall with zero API calls. This is the composite scoring pattern and a second beat for the video.
4. Evidence tags. For the top three films, ask Nouls in a second small request over just those films: did the description match on plot, a scene, a quoted line, an actor, the era. Render passing tags under the best match. No generated text anywhere.
5. Near-duplicate pass. When the top two probabilities are within a few points, fire a second request over just the top five with fuller descriptions, and show a split bar with a hint to add a detail when it stays close.
6. Catalogue quality and size. Rewrite hooks that contain bare adjectives or quotes that read as categories (start with Goodfellas). Add the six missing films by supplying a poster source that works. Research whether a bigger, richer catalogue is worth it: TMDB gives overviews, posters, directors, and cast with a free API key; the IMDb non-commercial datasets give ratings and crew but no plots or posters; Wikipedia stays keyless. If you go past 255 films, split into several Choice questions of up to 250 in one request, each with its own "matches anything" Noul, and merge in code by multiplying each film's probability by its chunk's existence score. Ask the user before requiring any new API key.
7. Latency. Try halving hook length and measure accuracy on the probe set before keeping it.

## How to verify

Build a probe set of at least forty queries in a script under `scripts/`, covering plot fragments, quotes, actors, category descriptions, negations, near-duplicate pairs, trivia, nonsense, and half-typed prefixes. Record top match, probability, exists score, router answer, tokens, and latency for each. Run it before and after every change and report the table. Do not tune thresholds on the same queries you report; keep a held-out third. Treat the docs' thresholds as starting points and pick yours from the probe results.

Every change must keep the existing presets at 90% or higher, keep the wall flat on nonsense, and keep round trips under about 600 ms warm. Screenshot the page in finder mode, set mode, and nothing mode and check for console errors.

## Reporting

Finish with: what changed per file, the before and after probe table, the new per-call cost in dollars and euros at the current rate, any failures you could not fix and why, and the one-line demo beat each new feature gives the video.
