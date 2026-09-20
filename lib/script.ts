"use client";

import { DEBOUNCE_MS } from "@/lib/use-find";
import type { Dim } from "@/lib/scores";

/** Scripted typing: ms per character. */
export const TYPE_MS = 42;
/** Scripted typing: how long the re-sorted wall stays still after each word before the next one. */
export const WORD_HOLD_MS = 350;
/** Scripted speech: ms per word, matching `say -r 158` in scripts/record.mjs. */
export const SAY_MS_PER_WORD = 380;
/** How long a phrase end may wait for everything to land before the script moves on. */
const SETTLE_CAP_MS = 6000;
const PHRASE_CAP_MS = 15000;

// A script (`?demo=1&script=<name>&delay=2000`) drives a page hands-free so every take is
// identical. Presets type character by character; sliders tween; everything else is real calls.
export type Step =
  | { type: "type"; text: string; hold: number }
  | { type: "clear"; hold: number }
  | { type: "slider"; dim: Dim; to: number; ms: number; hold: number }
  | { type: "wait"; ms: number }
  /** Feed a transcript word by word at speaking pace, without waiting for calls (speech doesn't wait). */
  | { type: "say"; text: string; msPerWord?: number; hold: number }
  /** Commit the current answer as the turn a follow-up refers to (/meet: `station` commits that shortlist row instead of the top). */
  | { type: "commit"; hold: number; station?: string }
  /** Show the closing comparison card. */
  | { type: "endcard"; hold: number }
  /** Press Enter on the typed text; the hook resolves when what it started has finished (the sweep). */
  | { type: "enter"; hold: number }
  /** A caption over the page for muted autoplay; empty text clears it. */
  | { type: "caption"; text: string; hold: number }
  /** /meet: add a person by station name (or naptan id). */
  | { type: "origin"; station: string; hold: number }
  /** /meet: simulate a suspended line (null clears it; "pick" = the line the committed pick depends on); the pick re-plans around it. A later caption's `{line}` is that line's name. */
  | { type: "disrupt"; line: string | null; hold: number }
  /** /meet phone: snap the bottom sheet. */
  | { type: "sheet"; to: "peek" | "half" | "full"; hold: number }
  /** /meet: preview a shortlist row as a first tap would (by station name, or `#n` for row n); its routes draw on the map. */
  | { type: "tap"; station: string; hold: number }
  /** /meet: tween the fairness dial to `to` (0 = most equal, 1 = fastest total) over `ms`. */
  | { type: "dial"; to: number; ms: number; hold: number };

export type ScriptCtx = {
  setQuery: (q: string) => void;
  setTyping?: (on: boolean) => void;
  setListening?: (on: boolean) => void;
  /** Every request for the current keystroke has landed (or failed). */
  settled: () => boolean;
  /** Extra condition at the end of a phrase, e.g. the chat model has answered too. */
  phraseSettled?: () => boolean;
  aborted: () => boolean;
  /** Lead-in before the first step, after the warm-up call. */
  delay: number;
  /** Page-specific steps. A step with no hook is skipped. */
  hooks?: Partial<Record<"slider" | "commit" | "endcard" | "enter" | "caption" | "origin" | "disrupt" | "sheet" | "tap" | "dial", (s: Step) => Promise<void>>>;
  /** The hidden warm-up call before the lead-in; defaults to /api/find. */
  warm?: () => Promise<unknown>;
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(ok: () => boolean, aborted: () => boolean, cap: number) {
  const until = performance.now() + cap;
  while (!ok() && !aborted() && performance.now() < until) await sleep(50);
}

/**
 * Types `text` character by character and pauses at every word boundary until that word's
 * call has landed, so the wall visibly re-ranks word by word. Typing straight through would
 * outrun the debounce and fire one call per phrase, which is fast but shows nothing.
 * Shared by the preset chips and the script runner.
 */
export async function typeWords(text: string, ctx: Pick<ScriptCtx, "setQuery" | "setTyping" | "settled" | "phraseSettled" | "aborted">) {
  ctx.setTyping?.(true);
  ctx.setQuery("");
  await sleep(250);
  for (let i = 1; i <= text.length && !ctx.aborted(); i++) {
    ctx.setQuery(text.slice(0, i));
    const last = i === text.length;
    if (!last && text[i] !== " ") {
      await sleep(TYPE_MS);
      continue;
    }
    await sleep(DEBOUNCE_MS + 60);
    await waitFor(ctx.settled, ctx.aborted, SETTLE_CAP_MS);
    if (last && ctx.phraseSettled) await waitFor(ctx.phraseSettled, ctx.aborted, PHRASE_CAP_MS);
    if (!last) await sleep(WORD_HOLD_MS);
  }
  if (!ctx.aborted()) ctx.setTyping?.(false);
}

/** Feeds a transcript one word at a time at speaking pace; calls fire as they would from a microphone. */
export async function sayWords(text: string, msPerWord: number, ctx: Pick<ScriptCtx, "setQuery" | "setListening" | "settled" | "phraseSettled" | "aborted">) {
  const words = text.split(/\s+/).filter(Boolean);
  document.body.dataset.sayStart = String(Date.now());
  document.body.dataset.sayText = text;
  ctx.setListening?.(true);
  ctx.setQuery("");
  for (let i = 1; i <= words.length && !ctx.aborted(); i++) {
    ctx.setQuery(words.slice(0, i).join(" "));
    await sleep(msPerWord);
  }
  ctx.setListening?.(false);
  await sleep(DEBOUNCE_MS + 60);
  await waitFor(ctx.settled, ctx.aborted, SETTLE_CAP_MS);
  if (ctx.phraseSettled) await waitFor(ctx.phraseSettled, ctx.aborted, PHRASE_CAP_MS);
}

/**
 * Runs a script: warms the model with a hidden call first so the first keystroke isn't a cold
 * start, waits the lead-in, then plays the steps. Sets body[data-demo-start] (wall clock, so
 * the recorder can trim the lead-in) and body[data-demo-done] for the recorder.
 */
export async function runScript(steps: Step[], ctx: ScriptCtx) {
  const warm = ctx.warm ?? (() => fetch("/api/find", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "warm up" }) }));
  await warm().catch(() => null);
  await sleep(ctx.delay);
  document.body.dataset.demoStart = String(Date.now());
  for (const s of steps) {
    if (ctx.aborted()) break;
    if (s.type === "type") {
      await typeWords(s.text, ctx);
      await sleep(s.hold);
    } else if (s.type === "say") {
      await sayWords(s.text, s.msPerWord ?? SAY_MS_PER_WORD, ctx);
      await sleep(s.hold);
    } else if (s.type === "clear") {
      ctx.setQuery("");
      await sleep(s.hold);
    } else if (s.type === "wait") {
      await sleep(s.ms);
    } else {
      const hook = ctx.hooks?.[s.type];
      if (hook) await hook(s);
      await sleep(s.hold);
    }
  }
  ctx.setTyping?.(false);
  ctx.setListening?.(false);
  document.body.dataset.demoDone = "1";
}

/** Reads `?demo=1&script=<name>&delay=<ms>` the same way on every page. */
export function readScriptParams(): { demo: boolean; script: string | null; delay: number } {
  const sp = new URLSearchParams(window.location.search);
  const delay = Number(sp.get("delay"));
  return { demo: sp.get("demo") === "1", script: sp.get("script"), delay: Number.isFinite(delay) && delay > 0 ? delay : 2000 };
}
