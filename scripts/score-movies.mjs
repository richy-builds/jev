// Scores every film once, offline, on five dimensions (composite scoring pattern).
// Writes data/movie-scores.json; the grid page's sliders re-sort the wall from this
// file with zero API calls.
//
//   node --env-file=.env.local scripts/score-movies.mjs
//
// One Score question per film per dimension, with the film's title in the question
// (Jev resolves a named film far better than a `movies[i]` path in a large state).
// Films are batched so state plus the questions stay well inside the 64k budget.

import { readFile, writeFile } from "node:fs/promises";
import { TypeSafeClient, score } from "@typesafe-ai/sdk";

const BATCH = 50;
const client = new TypeSafeClient();

// Levels describe concrete situations, never degrees; the model sees each level alone.
export const DIMENSIONS = {
  scary: {
    label: "Scary",
    question: (t) => `How frightening is the film ${t} to watch?`,
    levels: [
      "Nothing frightening at all; a nervous viewer is completely comfortable",
      "A few tense or unsettling moments in an otherwise unfrightening film",
      "Sustained dread, menace, or graphic violence; a jump scare or two",
      "A horror film built to frighten from start to finish",
    ],
  },
  funny: {
    label: "Funny",
    question: (t) => `How much of the film ${t} is played for laughs?`,
    levels: [
      "Played straight; no laughs intended",
      "Occasional wit or a light touch inside a serious story",
      "Comedy is a main ingredient alongside the drama or action",
      "An out-and-out comedy; gags and jokes scene after scene",
    ],
  },
  tearjerker: {
    label: "Tearjerker",
    question: (t) => `How much does the film ${t} make audiences cry?`,
    levels: [
      "Emotionally light; nobody reaches for a tissue",
      "A touching moment or two, quickly moved past",
      "Loss, grief, or heartbreak is central and lands hard",
      "Famous for leaving audiences in tears",
    ],
  },
  slow: {
    label: "Slow burn",
    question: (t) => `How slow and contemplative is the pacing of the film ${t}?`,
    levels: [
      "Relentless pace; action or plot turns every few minutes",
      "Brisk storytelling with a few breathers",
      "Deliberate pacing; long scenes, silences, and quiet stretches",
      "Meditative and unhurried; mood matters more than plot momentum",
    ],
  },
  family: {
    label: "Family-friendly",
    question: (t) => `How suitable is the film ${t} for a family with young children?`,
    levels: [
      "Adults only: graphic violence, sex, drugs, or relentless profanity",
      "Teens and up; some strong language, violence, or frightening scenes",
      "Fine for most children with a parent in the room",
      "Made for young children; nothing a parent needs to worry about",
    ],
  },
};

const movies = JSON.parse(await readFile("data/movies.json", "utf8"));
const scores = {};
let tokens = 0;
let calls = 0;

for (let i = 0; i < movies.length; i += BATCH) {
  const batch = movies.slice(i, i + BATCH);
  const state = { movies: batch.map(({ id, title, year, hook }) => ({ id, title, year, hook })) };
  const questions = {};
  for (const m of batch) {
    const t = `"${m.title}" (${m.year})`;
    for (const [dim, d] of Object.entries(DIMENSIONS)) {
      questions[`${dim}|${m.id}`] = score({ question: d.question(t), film: `movies[${batch.indexOf(m)}]` }, d.levels);
    }
  }
  const t0 = performance.now();
  const res = await client.systemOne({ state, questions }, { timeout: 60_000 });
  calls++;
  tokens += res.usage?.input_tokens ?? 0;
  for (const m of batch) {
    scores[m.id] = {};
    for (const [dim, d] of Object.entries(DIMENSIONS)) {
      const a = res.answers[`${dim}|${m.id}`];
      // Normalise the expected level to 0..1 so slider weights mean the same on every dimension.
      scores[m.id][dim] = Number((a.score / (d.levels.length - 1)).toFixed(3));
      scores[m.id][`${dim}_confidence`] = Number(a.confidence.toFixed(2));
    }
  }
  console.error(`batch ${i / BATCH + 1}: ${batch.length} films, ${Object.keys(questions).length} questions, ${res.usage?.input_tokens} tokens, ${Math.round(performance.now() - t0)} ms`);
}

const out = {
  model: "see console",
  builtAt: new Date().toISOString(),
  dimensions: Object.fromEntries(Object.entries(DIMENSIONS).map(([k, d]) => [k, { label: d.label, levels: d.levels }])),
  scores,
};
await writeFile("data/movie-scores.json", JSON.stringify(out, null, 1));
console.error(`done: ${calls} calls, ${tokens} input tokens (~$${(tokens * 0.042e-6).toFixed(4)})`);

// Sanity print: extremes per dimension.
for (const dim of Object.keys(DIMENSIONS)) {
  const sorted = Object.entries(scores).sort((a, b) => b[1][dim] - a[1][dim]);
  const show = (xs) => xs.map(([id, s]) => `${id.replace(/-\d{4}$/, "")}=${s[dim]}`).join(", ");
  console.error(`${dim}: top ${show(sorted.slice(0, 6))} | bottom ${show(sorted.slice(-4))}`);
}
