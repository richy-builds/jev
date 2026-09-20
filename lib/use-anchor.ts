"use client";

import { useEffect, useState } from "react";
import type { MeetLocateResponse } from "@/lib/stations";

/** "italian near soho, under 45 min" → "soho". The phrase after "near", up to a comma or full stop. */
export const anchorText = (query: string): string | null => {
  const m = query.match(/\bnear (?:the )?([^,.]+)/i);
  const t = m?.[1].trim() ?? "";
  return t.length >= 3 ? t : null;
};

/** The picker's acceptance bar for locate mode (app/meet/picker.tsx): below it the place is "not placed". */
export const LOCATE_EXISTS_MIN = 0.5;
export const LOCATE_TOP_MIN = 0.25;
const DEBOUNCE_MS = 600;

export type Anchor = { text: string; id: string | null; pending: boolean };

/**
 * Resolves a "near <place>" phrase in the description to the nearest candidate station
 * through the existing locate call, debounced so a half-typed place is not sent, and
 * remembered per phrase so backspacing through it costs nothing. `pending` while the
 * phrase has no answer yet; `id` null once it does and the place could not be placed.
 */
export function useAnchor(query: string): Anchor | null {
  const text = anchorText(query);
  const key = text?.toLowerCase() ?? null;
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const known = key !== null && key in resolved;

  useEffect(() => {
    if (!text || !key || known) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      let id: string | null = null;
      try {
        const res = await fetch("/api/meet/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: text, kind: "locate" }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as MeetLocateResponse;
        if (data.exists >= LOCATE_EXISTS_MIN && (data.probabilities[data.top] ?? 0) >= LOCATE_TOP_MIN) id = data.top;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
      setResolved((r) => ({ ...r, [key]: id }));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, key, known]);

  if (!text || !key) return null;
  return { text, id: known ? resolved[key] : null, pending: !known };
}
