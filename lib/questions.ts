import { choice, noul, score } from "@typesafe-ai/sdk";

/**
 * The judgments Jev makes over `message`. Every question is independent and
 * runs in parallel inside one systemOne call. Question ids are for code only;
 * the model sees instructions + criteria, so each carries its full meaning.
 */
export const INTENT_OPTIONS = {
  question:
    "Asking for information: how something works, whether something is possible, or what the status of something is",
  complaint:
    "Reporting dissatisfaction, a problem, or something that went wrong, without necessarily asking for a specific action",
  praise: "Expressing satisfaction, gratitude, or a compliment about the product or the people behind it",
  request:
    "Asking for a specific action to be taken, such as a refund, a change to an account, a cancellation, or a feature",
  other: "None of the above: small talk, an unclear fragment, or a message with no discernible purpose",
} as const;

export const TONE_LEVELS = [
  "Calm and neutral. Plain, polite, or matter-of-fact wording with no emotional charge",
  "Mildly frustrated or disappointed. Still polite, but hints of impatience or letdown",
  "Clearly annoyed. Sharp wording, exasperation, or a pointed complaint",
  "Angry. Accusatory language, demands, or threats of consequences",
  "Furious. Insults, profanity, all-caps shouting, or abusive language",
] as const;

export const TONE_LABELS = ["calm", "frustrated", "annoyed", "angry", "furious"] as const;

export const questions = {
  intent: choice("What is the writer of `message` primarily doing?", INTENT_OPTIONS),

  tone: score("How heated is the emotional tone of `message`?", TONE_LEVELS),

  needsHuman: noul("Does `message` need to be handled by a human agent rather than an automated reply?", {
    true: "The situation is sensitive, emotionally charged, ambiguous, involves money or account changes, or the writer explicitly asks for a person",
    false: "A routine, unambiguous message that a self-serve answer or automated reply could fully resolve",
  }),

  sarcasm: noul("Is the writer of `message` being sarcastic?", {
    true: "The literal words say one thing but the intended meaning is the opposite: mock praise, irony, or exaggerated enthusiasm used to criticise",
    false: "The message means what it literally says",
  }),

  churnRisk: noul(
    "Is the writer of `message` threatening to leave, cancel their subscription, or switch to a competitor?",
  ),
} as const;

export const JUDGMENT_COUNT = Object.keys(questions).length;

export type IntentOption = keyof typeof INTENT_OPTIONS;

/** Wire shape returned by /api/judge and consumed by the page. */
export interface Judgment {
  intent: { choice: IntentOption; confidence: number; probabilities: Record<IntentOption, number> };
  tone: { score: number; confidence: number; probabilities: number[] };
  needsHuman: number;
  sarcasm: number;
  churnRisk: number;
}

export interface JudgeResponse {
  judgment: Judgment;
  latencyMs: number;
  model: string;
  judgments: number;
}
