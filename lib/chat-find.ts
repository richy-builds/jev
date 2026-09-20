// Server side of the race: the same 258 films the Jev call sees, as the prompt a chat
// model gets. Never imported by the client (it would drag the catalogue text into the bundle).
import { MOVIES } from "@/lib/movies";
import { CHAT_MODEL } from "@/lib/chat-model";

/** The catalogue exactly as Jev sees it (title, year, hook), built once at module load. */
export const CATALOGUE_JSON = JSON.stringify(MOVIES.map(({ title, year, hook }) => ({ title, year, hook })));

/** Prompt size when an attempt is cancelled before the provider reports usage (~4 chars per token). */
export const PROMPT_TOKENS_ESTIMATE = Math.round(CATALOGUE_JSON.length / 4) + 120;

// System prompt first, catalogue second, the description last: the provider's automatic
// prefix cache only pays off when everything before the changing part is byte-identical.
const SYSTEM =
  "You are given a film catalogue as JSON. The user is describing one film from it, possibly badly or partially. " +
  "Reply with exactly one line: <Title> (<year>) — <one short sentence why>. " +
  "If it is a genre or mood request, name the single best example. Never say you cannot tell.\n\nCatalogue:\n" +
  CATALOGUE_JSON;

/** A committed turn: what the person typed and the film that turn settled on, as the chat model would have said it. */
export type ChatTurn = { query: string; answer: string };

/**
 * Earlier turns go in as real chat history, so a follow-up ("no, the sequel") is as fair
 * to the chat model as the `previous_answer` Jev gets. History sits after the catalogue,
 * so the cached prefix is unchanged.
 */
export function chatMessages(description: string, turns: ChatTurn[] = []) {
  return [
    { role: "system" as const, content: SYSTEM },
    ...turns.flatMap((t) => [
      { role: "user" as const, content: t.query },
      { role: "assistant" as const, content: t.answer },
    ]),
    { role: "user" as const, content: description },
  ];
}

export const chatModelId = CHAT_MODEL.id;
