"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cutEdges } from "@/lib/closures";
import { GRAPH, STATION_BY_ID, type LineStatus } from "@/lib/stations";
import { severityWeight } from "@/lib/tube-graph";

export const POLL_MS = 60_000;

/**
 * A line whose status changes the graph: removed (suspended/closed), cut between named
 * stations (a localised part closure, `closed` names the stretch), or slowed (delays,
 * part closures the reason text did not localise).
 */
export type Impact = { line: string; removed: boolean; closed: string | null; description: string; simulated: boolean };

/**
 * Live TfL line status, polled every 60 s, re-fetched at once when the simulated
 * disruption changes. State only moves when the JSON differs, so a quiet poll does not
 * rebuild the graph. `impacts` is the list the UI shows and dims; `cutSegments` the
 * edge keys (lib/closures.ts `edgeKey`) whose track is closed today, for the map to dash.
 */
export function useStatus(simulate: string | null) {
  const [status, setStatus] = useState<LineStatus | null>(null);
  const lastJson = useRef("");
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const res = await fetch(`/api/meet/status${simulate ? `?disrupt=${encodeURIComponent(simulate)}` : ""}`, { signal: controller.signal });
        if (!res.ok || !alive) return;
        const text = await res.text();
        if (!alive || text === lastJson.current) return;
        lastJson.current = text;
        setStatus(JSON.parse(text) as LineStatus);
      } catch {
        /* keep the last status */
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [simulate]);

  const impacts = useMemo<Impact[]>(() => {
    if (!status) return [];
    return Object.entries(status)
      .filter(([, s]) => severityWeight(s.severity) !== 1 || s.closedBetween?.length)
      .map(([line, s]) => ({
        line,
        removed: severityWeight(s.severity) === null,
        closed: s.closedBetween?.length ? closedLabel(s.closedBetween) : null,
        description: s.description,
        simulated: !!s.simulated,
      }));
  }, [status]);
  const dimmedLines = useMemo(() => new Set(impacts.filter((i) => i.removed).map((i) => i.line)), [impacts]);
  const cutSegments = useMemo(() => {
    const out = new Set<string>();
    for (const [line, s] of Object.entries(status ?? {})) {
      if (!s.closedBetween?.length) continue;
      for (const k of cutEdges(GRAPH.edges, line, s.closedBetween)) out.add(k);
    }
    return out;
  }, [status]);

  /** Lines whose closure is localised: TfL plans around the cut, so its legs on these lines are not disrupted. */
  const localisedLines = useMemo(() => new Set(impacts.filter((i) => i.closed).map((i) => i.line)), [impacts]);

  return { status, statusRef, impacts, dimmedLines, cutSegments, localisedLines };
}

/** "Earl's Court → Ealing Broadway / Richmond": pairs sharing a first station are folded into one stretch. */
function closedLabel(pairs: [string, string][]): string {
  const name = (id: string) => STATION_BY_ID[id]?.name ?? id;
  const byFrom = new Map<string, string[]>();
  for (const [a, b] of pairs) (byFrom.get(a) ?? byFrom.set(a, []).get(a)!).push(b);
  return [...byFrom].map(([a, bs]) => `${name(a)} → ${bs.map(name).join(" / ")}`).join(", ");
}
