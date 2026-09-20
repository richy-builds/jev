"use client";

import type { RefObject } from "react";
import { CHAT_PRICE_PER_TOKEN, HudCell, PRICE_PER_TOKEN, Sparkline, money, pct, useStopwatch } from "@/app/grid/ui";
import type { MeetFindResponse } from "@/lib/stations";
import type { Status, Totals, TracePoint } from "@/lib/use-find";
import { EXISTS_FLOOR } from "@/lib/use-meet";

/**
 * Telemetry for /meet, adapted from the grid page: one round trip per keystroke over
 * every reachable station, tokens read, what it cost next to a chat model's rate,
 * whether the description asks for a place at all, and the confidence sparkline.
 */
export function MeetTelemetry({
  status,
  find,
  totals,
  trace,
  startedAt,
  candidates,
  budget,
  compact = false,
}: {
  status: Status;
  find: MeetFindResponse | null;
  totals: Totals;
  trace: TracePoint[];
  startedAt: RefObject<number>;
  /** Stations sent this keystroke (after the travel-budget filter). */
  candidates: number;
  /** Budget in force, and whether it came from the description. */
  budget: { mins: number; stated: boolean };
  compact?: boolean;
}) {
  const pending = status === "pending";
  const elapsed = useStopwatch(pending, startedAt);
  const ms = pending ? `${elapsed} ms` : find ? `${find.latencyMs} ms` : "—";
  const msTone = pending ? "text-[var(--warn)]" : find ? "text-[var(--good)]" : "text-[var(--muted)]";
  const tokens = find?.tokens ?? null;
  const lit = find ? find.exists >= EXISTS_FLOOR : false;
  const existsText = !find ? "—" : lit ? "a place" : "nothing yet";
  const existsTone = !find ? "text-[var(--muted)]" : lit ? "text-[var(--accent)]" : "text-[var(--muted)]";
  const last = trace.at(-1);

  if (compact) {
    return (
      <div className="mono flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[11px]">
        <span className={`flex shrink-0 items-center gap-1.5 ${msTone}`}>
          {pending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--warn)]" />}
          {ms}
        </span>
        <span className="shrink-0 text-[var(--muted)]">{candidates} stn</span>
        <span className="shrink-0 text-[var(--muted)]">{tokens ? `${(tokens / 1000).toFixed(1)}k tok` : "—"}</span>
        <span className="shrink-0 text-[var(--muted)]">≤{budget.mins}m</span>
        <span className={`ml-auto min-w-0 truncate ${existsTone}`}>{existsText}</span>
      </div>
    );
  }

  return (
    <div className="mono flex flex-wrap items-stretch gap-x-7 gap-y-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-5 py-3">
      <HudCell size="md" label="per keystroke" value={ms} width={7} tone={msTone} pulse={pending} sub={find ? "one round trip" : "every station, every time"} />
      <HudCell size="md" label="stations ranked" value={String(candidates)} width={4} sub={`within ${budget.mins} min of everyone${budget.stated ? " (from the text)" : ""}`} />
      <HudCell size="md" label="tokens read" value={tokens ? tokens.toLocaleString() : "—"} width={6} sub={tokens ? `≈ ${Math.max(1, Math.round(tokens / 650))} pages of hooks` : "name, lines, zone, hook"} />
      <HudCell
        size="md"
        label="this keystroke"
        value={tokens ? money(tokens * PRICE_PER_TOKEN) : "—"}
        width={5}
        sub={tokens ? `chat model: ${money(tokens * CHAT_PRICE_PER_TOKEN)} to read the same` : "—"}
      />
      <HudCell size="md" label="session" value={`${totals.calls} calls · ${money(totals.tokens * PRICE_PER_TOKEN)}`} width={12} sub={totals.calls ? `avg ${Math.round(totals.ms / totals.calls)} ms a call` : "—"} />
      <HudCell size="md" label="describes" value={existsText} width={9} tone={existsTone} sub={find ? `${pct(find.exists)} sure it's a place` : "a place, or nothing?"} />
      <div className="flex basis-full flex-col justify-center">
        <Sparkline trace={trace} />
        <span className="mt-1.5 flex justify-between gap-3 text-[10px] uppercase tracking-wide text-[var(--muted)]">
          <span className="truncate">
            confidence, keystroke by keystroke
            {last?.title && <span className="normal-case"> · {last.title}</span>}
          </span>
          <span className="shrink-0 normal-case">{find?.model ?? "jev"}</span>
        </span>
      </div>
    </div>
  );
}
