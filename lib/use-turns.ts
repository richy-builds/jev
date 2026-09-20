"use client";

import { useCallback, useRef, useState } from "react";
import type { Previous } from "@/lib/use-find";

/** One committed description and the answer Jev had settled on when it was committed. */
export type Turn<A = Previous> = { query: string; answer: A | null };

/**
 * The follow-up model shared by /grid, /race and /meet (generic in the answer type): pressing Enter (or "not it") commits the
 * current description as a turn, and the next description is read against that turn's
 * answer ("no, the sequel"). Committing while nothing is locked keeps the last answer, so
 * a wrong guess can be corrected twice in a row without losing the reference.
 */
export function useTurns<A extends { id: string } = Previous>() {
  const [turns, setTurns] = useState<Turn<A>[]>([]);
  const previous = turns.at(-1)?.answer ?? null;
  const previousRef = useRef(previous);
  previousRef.current = previous;

  /** Returns false when there is nothing to commit (empty box, or no answer yet and none before). */
  const commit = useCallback((query: string, locked: A | null) => {
    const answer = locked ?? previousRef.current;
    if (!query.trim() || !answer) return false;
    setTurns((t) => [...t, { query: query.trim(), answer }]);
    return true;
  }, []);
  const reset = useCallback(() => setTurns([]), []);

  return { turns, previous, earlier: turns.map((t) => t.query), commit, reset };
}
