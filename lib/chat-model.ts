// The chat model Jev races on /race, and what it costs. Client-safe: no catalogue, no keys.
//
// Pick the current flagship with reasoning switched off, so the comparison is not a
// strawman and its first token is not a think-time artefact; the id is shown on screen.
// Prices are per token, from developers.openai.com/api/docs/pricing on 2026-09-19 (Sol's
// promotional pricing runs at least to 2026-11-21). VERIFY BEFORE PUBLISHING A CLIP.
//
// The key's rate limits matter more than the price: every attempt carries the ~9.5k-token
// catalogue, and a phrase is ~20 attempts, so a model needs well over 200k tokens per
// minute on the key. gpt-4.1 gets 30k TPM on a tier-1 key and stalled for 38 s on 429s.
export const CHAT_MODEL = {
  id: "gpt-5.6-sol",
  label: "GPT-5.6 Sol",
  inputPerToken: 4.0e-6,
  cachedInputPerToken: 0.4e-6,
  outputPerToken: 20.0e-6,
  /** Reasoning models reject temperature; leave undefined for those. */
  temperature: undefined as number | undefined,
  /** GPT-5.x thinks before the first token unless told not to; "none" is what a chat box would use for a one-liner. */
  reasoningEffort: "none" as "none" | "low" | "medium" | "high" | undefined,
};

export type ChatUsage = { prompt: number; cached: number; completion: number };

export type ChatEvent =
  | { t: "delta"; text: string }
  | { t: "usage"; prompt: number; cached: number; completion: number }
  | { t: "done"; ms: number }
  | { t: "error"; message: string };

/**
 * What the provider bills for one attempt. `billed` honours prompt caching (the catalogue
 * prefix is identical every attempt, so from the second one on most of it is cached);
 * `uncached` is the same attempt at list price, shown smaller so nobody can say the
 * comparison leaned on a cache.
 */
export function chatCost(u: ChatUsage) {
  const { inputPerToken, cachedInputPerToken, outputPerToken } = CHAT_MODEL;
  return {
    billed: (u.prompt - u.cached) * inputPerToken + u.cached * cachedInputPerToken + u.completion * outputPerToken,
    uncached: u.prompt * inputPerToken + u.completion * outputPerToken,
  };
}
