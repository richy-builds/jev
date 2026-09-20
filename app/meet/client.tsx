"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "@/app/grid/ui";
import type { JourneyResponse } from "@/app/api/meet/journey/route";
import { TubeMap, type ChangeMark, type RouteDraw } from "./map";
import { MeetTelemetry } from "./hud";
import { OriginPicker, matchStations } from "./picker";
import { MeetResult, ResultActions, type Verdict } from "./result";
import { Sheet, type SheetState } from "./sheet";
import { StatusBanner } from "./status-banner";
import { IntentChips } from "./intent-chips";
import { Shortlist } from "./shortlist";
import { Legend } from "./legend";
import { useAnchor } from "@/lib/use-anchor";
import { useVenues, type VenueIntent } from "@/lib/use-venues";
import { THRESHOLDS } from "@/lib/meet-find";
import { buildShortlist } from "@/lib/meet-shortlist";
import { changeWait, isLanded, personTime, splitWait, type Journey } from "@/lib/meet-times";
import { DEFAULT_BUDGET, encodeMeetParams, type MeetParams } from "@/lib/meet-url";
import { readScriptParams, runScript, type Step } from "@/lib/script";
import { CANDIDATES, GRAPH, STATION_BY_ID, lineName, type Origin, type Theme } from "@/lib/stations";
import { applyStatus, legsFromJourney, pathTo, reach } from "@/lib/tube-graph";
import { useStatus } from "@/lib/use-status";
import { blend, shortName, useTubeGraph } from "@/lib/use-tube-graph";
import { BUDGET_MIN_P, EXISTS_FLOOR, useMeet } from "@/lib/use-meet";
import { useTurns } from "@/lib/use-turns";

/**
 * Recording scripts (`?demo=1&script=meet-main&delay=2000`, see scripts/record.mjs).
 * `meet-main` is the ~45 s X clip: three people, a vibe, a commit, a simulated
 * suspension that forces a re-pick, a refinement, the share link.
 * `meet-phone` is the ~70 s phone clip (`?script=meet-phone&layout=phone`, no `demo=1`:
 * the real light phone UI at 390×844, `record.mjs --phone`): the reach shading, the
 * intent chips, the shortlist and its fairness dial, a tapped row, the bottom sheet with
 * TfL's rows and the venues, the change rings, the suspension, the refinement, the link.
 */
const SCRIPTS: Record<string, Step[]> = {
  "meet-phone": [
    { type: "caption", text: "Three friends. Three corners of London.", hold: 900 },
    { type: "origin", station: "Brixton", hold: 600 },
    { type: "origin", station: "Walthamstow Central", hold: 600 },
    { type: "origin", station: "Wembley Park", hold: 1200 },
    { type: "caption", text: "Shaded: everywhere all three can reach in 40 min.", hold: 2200 },
    { type: "caption", text: "", hold: 200 },
    { type: "type", text: "italian near soho, everyone under 45 min", hold: 1200 },
    { type: "caption", text: "Jev reads the vibe. Nobody travels over budget.", hold: 2400 },
    { type: "caption", text: "", hold: 200 },
    { type: "dial", to: 1, ms: 1200, hold: 400 },
    { type: "caption", text: "Fair for everyone ↔ fastest overall.", hold: 1800 },
    { type: "dial", to: 0, ms: 1000, hold: 300 },
    { type: "caption", text: "", hold: 200 },
    { type: "tap", station: "#fragile", hold: 1600 },
    { type: "commit", station: "#fragile", hold: 1800 },
    { type: "sheet", to: "peek", hold: 300 },
    { type: "caption", text: "Every route checked with TfL. Real places nearby.", hold: 2400 },
    { type: "caption", text: "", hold: 200 },
    { type: "sheet", to: "full", hold: 2400 },
    { type: "sheet", to: "peek", hold: 600 },
    { type: "caption", text: "The change rings add up to TfL's time.", hold: 2400 },
    { type: "caption", text: "", hold: 200 },
    { type: "disrupt", line: "pick", hold: 300 },
    { type: "caption", text: "What if the {line} line went down?", hold: 2200 },
    { type: "caption", text: "", hold: 200 },
    { type: "commit", hold: 2400 },
    { type: "sheet", to: "peek", hold: 300 },
    { type: "type", text: "no, somewhere livelier further east", hold: 1400 },
    { type: "commit", hold: 2400 },
    { type: "sheet", to: "peek", hold: 300 },
    { type: "caption", text: "Changed your mind? Just say so.", hold: 1800 },
    { type: "caption", text: "", hold: 200 },
    { type: "caption", text: "One link. Everyone sees their own route.", hold: 2400 },
    { type: "wait", ms: 400 },
  ],
  "meet-main": [
    { type: "caption", text: "Three friends, three tube lines.", hold: 900 },
    { type: "origin", station: "Brixton", hold: 700 },
    { type: "origin", station: "Walthamstow Central", hold: 700 },
    { type: "origin", station: "Ealing Broadway", hold: 1400 },
    { type: "caption", text: "", hold: 200 },
    { type: "type", text: "pub with a garden, not a chain, everyone under 45 min", hold: 2500 },
    { type: "commit", hold: 3500 },
    { type: "disrupt", line: "pick", hold: 300 },
    { type: "caption", text: "What if the {line} line went down?", hold: 3500 },
    { type: "caption", text: "", hold: 200 },
    { type: "type", text: "no, somewhere livelier further east", hold: 2200 },
    { type: "commit", hold: 3000 },
    { type: "caption", text: "One link. Everyone sees their own route.", hold: 2500 },
    { type: "wait", ms: 400 },
  ],
};

type Params = {
  demo: boolean;
  script: string | null;
  delay: number;
  portrait: boolean;
  phone: boolean;
};
type Committed = {
  query: string;
  originsKey: string;
  pick: string;
  mins: number[];
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(ok: () => boolean, cap: number) {
  const until = performance.now() + cap;
  while (!ok() && performance.now() < until) await sleep(50);
}

/**
 * For the script's `disrupt: "pick"`: the line whose suspension hurts the committed pick
 * most (the biggest added minutes for any one person, Infinity when unreachable); never a
 * line whose loss leaves no candidate inside everyone's budget on today's graph
 * (a live closure can already have taken an origin's other line), which would strand them
 * rather than re-pick.
 */
function lineThatMatters(pick: string | null, origins: string[], status: Parameters<typeof applyStatus>[1], budget: number): string | null {
  return worstLine(pick, origins, status, budget)?.line ?? null;
}
/** The line behind `lineThatMatters`, with the minutes its suspension adds (Infinity when the pick becomes unreachable). */
function worstLine(pick: string | null, origins: string[], status: Parameters<typeof applyStatus>[1], budget: number): { line: string; added: number } | null {
  if (!pick || !origins.length) return null;
  const used = new Set<string>();
  const base = origins.map((o) => reach(o, applyStatus(GRAPH, status)));
  base.forEach((r) => {
    for (const leg of pathTo(r, pick)) if (leg.line !== "walk") used.add(leg.line);
  });
  let best: { line: string; added: number } | null = null;
  for (const l of used) {
    const edges = applyStatus(GRAPH, {
      ...(status ?? {}),
      [l]: { severity: 2, description: "Suspended", reason: "" },
    });
    const after = origins.map((o) => reach(o, edges));
    if (!CANDIDATES.some((c) => after.every((r) => (r.mins[c.id] ?? Infinity) <= budget))) continue;
    const added = Math.max(...origins.map((o, i) => (after[i].mins[pick] ?? Infinity) - (base[i].mins[pick] ?? Infinity)));
    if (!best || added > best.added) best = { line: l, added };
  }
  return best;
}

/** A disruption that adds this many minutes to anyone's trip re-plans the pick even inside the budget. */
const REPICK_DELAY_MIN = 8;
/** TfL has authority: its journey beating the graph estimate by this much (or the budget) drops the pick like a suspension would. */
const VERIFY_SLACK_MIN = 10;
/** How long the flagged row stays on the card before the re-pick, so the disagreement is seen. */
const VERIFY_HOLD_MS = 2200;

type Repick = {
  line: string | null;
  simulated: boolean;
  verify?: { person: string; tfl: number; graph: number };
};

/**
 * /meet: origins in, a description in, Jev ranks the stations everyone can reach, the
 * map lights up. Travel time is code: Dijkstra per origin filters the candidates before
 * the call and a soft fairness weight reshapes the answer after it. Enter commits the
 * pick: TfL's journey planner verifies each person's route, the routes draw along the
 * graph, and the URL becomes the share link. Live line status feeds the graph; when a
 * committed pick stops being reachable, it is dropped and the finder re-picks. TfL has
 * the last word: a journey it plans that blows the budget, or the graph's estimate by
 * ten minutes, is flagged on the card and the pick is dropped and vetoed the same way.
 */
export function MeetClient({ initial, demo = false }: { initial: MeetParams; demo?: boolean }) {
  const [query, setQuery] = useState(initial.q);
  const [origins, setOrigins] = useState<Origin[]>(() => initial.origins.filter((o) => STATION_BY_ID[o.id]));
  /** A budget chosen by hand (or from the URL); a budget read from the text wins while the text states one. */
  const [manualBudget, setManualBudget] = useState<number | null>(initial.budget);
  const [hovered, setHovered] = useState<string | null>(null);
  /** A shortlist row under the pointer (or first-tapped), or a station first-tapped on the map (`map`): its routes preview on the map. */
  const [previewed, setPreviewed] = useState<{
    id: string;
    map: boolean;
  } | null>(null);
  /** The phone sheet's snap state (app/meet/sheet.tsx), mirrored for the phone legend, which hides while the sheet is full. */
  const [sheetState, setSheetState] = useState<SheetState>("half");
  /** The fairness dial, 0 = most equal (today's ranking), 1 = fastest total. Not in the URL. */
  const [lambda, setLambda] = useState(0);
  const [disrupt, setDisrupt] = useState<string | null>(initial.disrupt);
  const [caption, setCaption] = useState("");
  const [params, setParams] = useState<Params>({
    demo,
    script: null,
    delay: 2000,
    portrait: false,
    phone: false,
  });
  /** A snap the script asked the phone sheet for, tied to the pick it was asked on (a new pick's sheet opens at half). */
  const [sheetTo, setSheetTo] = useState<{
    to: SheetState;
    pick: string;
  } | null>(null);
  /** The "everyone within N min" shading on the map (the legend's checkbox). */
  const [region, setRegion] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const originIds = useMemo(() => origins.map((o) => o.id), [origins]);
  const originsKey = originIds.join(",");

  const line = useStatus(disrupt);
  const graph = useTubeGraph(originIds, line.status);

  // Two passes: the previous answer's budget decides this keystroke's candidate set. The
  // budget comes back with the same query, so the set settles after one extra call at most.
  const [statedBudget, setStatedBudget] = useState<number | null>(null);
  const budget = statedBudget ?? manualBudget ?? DEFAULT_BUDGET;
  /** Picks TfL's planner has rejected for these origins and budget: out of the candidate set until either changes. */
  const [vetoed, setVetoed] = useState<Set<string>>(() => new Set());
  const candidates = useMemo(() => graph.feasible(budget).filter((id) => !vetoed.has(id)), [graph, budget, vetoed]);

  // Commit: the pick holds while the description is unchanged; editing it keeps the pick
  // as the "previous" Jev reads follow-ups against, and drops the routes.
  const turns = useTurns<{ id: string }>();
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [journeys, setJourneys] = useState<Record<string, Journey>>({});
  const [shared, setShared] = useState(false);
  const [repick, setRepick] = useState<Repick | null>(null);
  const active = !!committed && committed.query === query.trim() && committed.originsKey === originsKey;
  const pick = active ? committed.pick : null;

  const live = useMeet(query, {
    origins: originIds,
    candidates,
    previous: active ? null : turns.previous,
    earlier: active ? [] : turns.earlier,
  });
  const find = live.find;
  useEffect(() => {
    if (!query.trim()) setStatedBudget(null);
    else if (find) setStatedBudget(find.budget.mins !== null && find.budget.p >= BUDGET_MIN_P ? find.budget.mins : null);
  }, [find, query]);

  const lit = !!find && find.exists >= EXISTS_FLOOR && live.status !== "error";
  /** "near <place>" in the description, resolved to a station for the chips and the venues. */
  const anchor = useAnchor(query);
  // Venues (lib/use-venues.ts): what the finder read from the text, above the chip threshold, plus the anchor station. A list under the card's rows; never part of the ranking.
  const venueIntent = useMemo<VenueIntent>(
    () => ({
      kind: find && find.venue.kind && find.venue.kindP >= THRESHOLDS.venue ? find.venue.kind : null,
      cuisine: find && find.venue.cuisine && find.venue.cuisineP >= THRESHOLDS.venue ? find.venue.cuisine : null,
      near: anchor?.id ?? null,
      q: query.trim(),
    }),
    [find, anchor?.id, query],
  );
  const venues = useVenues(pick, venueIntent);

  // Fairness: Jev's probability times a soft penalty for the slowest person's time, or for
  // the total as the dial moves towards "fastest total" (lib/use-tube-graph.ts `blend`).
  const probabilities = useMemo(() => {
    if (!lit) return null;
    if (!originIds.length) return find.probabilities;
    const raw: Record<string, number> = {};
    let sum = 0;
    for (const [id, p] of Object.entries(find.probabilities)) {
      const mins = graph.minsTo(id);
      const w = blend(
        p,
        Math.max(...mins),
        mins.reduce((a, m) => a + m, 0),
        mins.length,
        budget,
        lambda,
      );
      raw[id] = w;
      sum += w;
    }
    if (!sum) return find.probabilities;
    for (const id in raw) raw[id] /= sum;
    return raw;
  }, [lit, find, originIds.length, graph, budget, lambda]);
  const liveTop = useMemo(() => {
    if (!probabilities) return null;
    return Object.entries(probabilities).reduce((a, b) => (b[1] > a[1] ? b : a), ["", -1])[0] || null;
  }, [probabilities]);
  const top = pick ?? liveTop;
  // The shortlist: the top three of the same ranking, minutes through `personTime` so the committed row carries TfL's times.
  const shortlist = useMemo(
    () =>
      probabilities && lit
        ? buildShortlist({
            probabilities,
            raw: find.probabilities,
            origins: originIds,
            pick,
            journeys,
            minsTo: graph.minsTo,
          })
        : [],
    [probabilities, lit, find, originIds, pick, journeys, graph],
  );
  const shortlistIds = useMemo(() => shortlist.map((r) => r.id), [shortlist]);
  /** A shortlist preview only holds while its row is on the shortlist (a re-rank or a new answer drops it); a map tap's holds until the next tap. */
  const preview = previewed && (previewed.map ? !!STATION_BY_ID[previewed.id] : shortlistIds.includes(previewed.id)) ? previewed.id : null;
  const previewRow = useCallback((id: string | null) => setPreviewed(id ? { id, map: false } : null), []);
  const previewStation = useCallback((id: string | null) => setPreviewed(id ? { id, map: true } : null), []);

  // Journeys: one TfL call per person, landing independently; a newer commit wins.
  const journeyGen = useRef(0);
  const fetchJourneys = useCallback(async (target: string, os: Origin[]) => {
    const gen = ++journeyGen.current;
    setJourneys({});
    await Promise.all(
      os.map(async (o) => {
        let j: Journey;
        try {
          const res = await fetch(`/api/meet/journey?from=${o.id}&to=${target}`);
          const data = (await res.json()) as JourneyResponse & {
            error?: string;
          };
          j = res.ok ? data : { error: data.error ?? `HTTP ${res.status}` };
        } catch (err) {
          j = { error: err instanceof Error ? err.message : "failed" };
        }
        if (gen === journeyGen.current) setJourneys((all) => ({ ...all, [o.id]: j }));
      }),
    );
  }, []);

  const queryRef = useRef(query);
  queryRef.current = query;
  const topRef = useRef(top);
  topRef.current = top;
  const shortlistRef = useRef(shortlistIds);
  shortlistRef.current = shortlistIds;
  const originsRef = useRef(origins);
  originsRef.current = origins;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const commitTurn = turns.commit;
  const committedRef = useRef(committed);
  committedRef.current = committed;
  const statedBudgetRef = useRef(statedBudget);
  statedBudgetRef.current = statedBudget;
  /**
   * Enter, "meet here", a tap on a station, or the script's `commit` step. Resolves when
   * every journey has landed. A budget the text stated becomes the hand-set one, so it
   * survives a follow-up that no longer mentions it.
   */
  const commit = useCallback(
    async (target: string | null = topRef.current) => {
      if (!target || !STATION_BY_ID[target]) return;
      const q = queryRef.current.trim();
      const os = originsRef.current;
      if (statedBudgetRef.current !== null) setManualBudget(statedBudgetRef.current);
      commitTurn(q, { id: target });
      setCommitted({
        query: q,
        originsKey: os.map((o) => o.id).join(","),
        pick: target,
        mins: graphRef.current.minsTo(target),
      });
      setRepick(null);
      setShared(false);
      await fetchJourneys(target, os);
    },
    [commitTurn, fetchJourneys],
  );

  // A share link opens on its result.
  useEffect(() => {
    if (initial.pick && STATION_BY_ID[initial.pick]) void commit(initial.pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disruption (or a tighter budget) can put the pick out of reach, or make it materially
  // slower for someone: drop it and let the finder re-rank over the new candidate set and
  // fairness weights; say which line went.
  useEffect(() => {
    if (!committed || !originIds.length) return;
    const now = graph.minsTo(committed.pick);
    if (now.every((m, i) => m <= budget && m < (committed.mins[i] ?? Infinity) + REPICK_DELAY_MIN)) return;
    const gone = line.impacts.find((i) => i.removed && i.simulated) ?? line.impacts.find((i) => i.removed) ?? null;
    setCommitted(null);
    setRepick({
      line: gone?.line ?? null,
      simulated: gone?.simulated ?? false,
    });
  }, [committed, graph, budget, originIds.length, line.impacts]);
  useEffect(() => setRepick(null), [query]);
  useEffect(() => setVetoed(new Set()), [originsKey, budget]);

  // Verify: TfL's duration against the budget and the graph estimate the pick was made on.
  const verdicts = useMemo<Record<string, Verdict>>(() => {
    if (!pick || !committed) return {};
    const out: Record<string, Verdict> = {};
    origins.forEach((o, i) => {
      const j = journeys[o.id];
      if (!isLanded(j)) return;
      const est = committed.mins[i] ?? Infinity;
      const over = j.duration > budget || j.duration >= est + VERIFY_SLACK_MIN;
      // The line to blame: one the graph rode that has a live problem, else one TfL avoided, else TfL's longest leg.
      const ridden = new Set(j.legs.map((l) => l.line));
      const graphLines = graph
        .pathBetween(o.id, pick)
        .map((l) => l.line)
        .filter((l) => l !== "walk");
      const troubled = graphLines.find((l) => line.impacts.some((i) => i.line === l));
      const avoided = graphLines.find((l) => !ridden.has(l));
      const longest = j.legs.filter((l) => l.mode === "tube" && l.line).sort((a, b) => b.mins - a.mins)[0]?.line ?? null;
      out[o.id] = {
        tfl: j.duration,
        graph: Math.round(est),
        over,
        line: troubled ?? avoided ?? longest,
      };
    });
    return out;
  }, [pick, committed, origins, journeys, budget, graph, line.impacts]);
  useEffect(() => {
    if (!pick) return;
    const bad = origins.find((o) => verdicts[o.id]?.over);
    if (!bad) return;
    const v = verdicts[bad.id];
    const timer = setTimeout(() => {
      if (committedRef.current?.pick !== pick) return;
      setVetoed((prev) => new Set(prev).add(pick));
      setCommitted(null);
      setRepick({
        line: v.line,
        simulated: false,
        verify: {
          person: shortName(bad.label ?? STATION_BY_ID[bad.id].name),
          tfl: v.tfl,
          graph: v.graph,
        },
      });
    }, VERIFY_HOLD_MS);
    return () => clearTimeout(timer);
  }, [pick, origins, verdicts]);

  // Routes: TfL's legs once a journey lands (flagging any on a suspended line), the graph's path until then or when a name cannot be placed.
  const routes = useMemo<RouteDraw[]>(() => {
    if (!pick) return [];
    return originIds.map((o) => {
      const j = journeys[o];
      const legs = isLanded(j) ? legsFromJourney(j.legs, line.dimmedLines) : null;
      return { origin: o, legs: legs ?? graph.pathBetween(o, pick) };
    });
  }, [pick, originIds, graph, journeys, line.dimmedLines]);

  // Change stations on the drawn routes (where one tube leg hands to the next), with TfL's change + wait minutes shared across them once the journey has landed (lib/meet-times.ts); "change" alone on the graph's path.
  const changes = useMemo<ChangeMark[]>(() => {
    const out: ChangeMark[] = [];
    for (const r of routes) {
      const at: string[] = [];
      for (let i = 1; i < r.legs.length; i++) {
        const prev = r.legs[i - 1];
        if (prev.line !== "walk" && r.legs[i].line !== "walk") at.push(prev.stations[prev.stations.length - 1]);
      }
      const j = journeys[r.origin];
      const mins = isLanded(j) ? splitWait(changeWait(j), at.length) : null;
      at.forEach((id, i) => out.push({ id, mins: mins ? mins[i] : null }));
    }
    return out;
  }, [routes, journeys]);

  // The previewed shortlist row: the graph's paths to it, drawn under the committed routes. Nothing to add when it is the pick itself.
  const previewRoutes = useMemo<RouteDraw[]>(() => {
    if (!preview || preview === pick) return [];
    return originIds.map((o) => ({
      origin: o,
      legs: graph.pathBetween(o, preview),
    }));
  }, [preview, pick, originIds, graph]);

  // Lines someone would ride to the pick (TfL's legs once landed) or to the live top (the graph's path): what the status banner is scoped to.
  const routeLines = useMemo<Set<string> | null>(() => {
    if (!top || !originIds.length) return null;
    const lines = new Set<string>();
    const legs = pick ? routes.flatMap((r) => r.legs) : originIds.flatMap((o) => graph.pathBetween(o, top));
    for (const l of legs) if (l.line !== "walk") lines.add(l.line);
    return lines;
  }, [top, pick, routes, originIds, graph]);

  const share = useCallback(async () => {
    const url = window.location.href;
    const title = pick ? `Meet at ${STATION_BY_ID[pick].name}` : "Where should we meet?";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* dismissed or unsupported: fall through to the clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }, [pick]);

  // One time source (lib/meet-times.ts): TfL's minutes for the committed pick once they land, the graph estimate otherwise, said so.
  const minutesLabel = useCallback(
    (id: string | null) => {
      if (!id || !origins.length) return null;
      const est = graph.minsTo(id);
      const times = origins.map((o, i) => personTime(id, pick, journeys[o.id], est[i]));
      const parts = origins.map((o, i) => `${shortName(o.label ?? STATION_BY_ID[o.id].name)} ${Number.isFinite(times[i].mins) ? Math.round(times[i].mins) : "—"}`);
      return `${parts.join(" · ")}${times.some((t) => t.source === "est") ? " · est." : ""}`;
    },
    [origins, graph, pick, journeys],
  );
  const topLabel = useMemo(() => {
    if (!top) return null;
    const s = STATION_BY_ID[top];
    return minutesLabel(top) ?? (s ? `zone ${s.zone}` : null);
  }, [top, minutesLabel]);
  const shown = hovered ?? preview;
  const hoverLabel = useMemo(() => (shown && shown !== top ? minutesLabel(shown) : null), [shown, top, minutesLabel]);
  const feasibleSet = useMemo(() => (originIds.length ? new Set(candidates) : null), [originIds.length, candidates]);

  // Share-ready URL: origins, description, a hand-set budget, the pick, a simulated disruption, without a reload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const next = encodeMeetParams(
      {
        origins,
        q: query,
        budget: statedBudget ? null : manualBudget,
        pick,
        disrupt,
      },
      sp,
    );
    if (next !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${next}`);
  }, [origins, query, manualBudget, statedBudget, pick, disrupt]);

  // ?demo=1 is the recording layout, &layout=portrait the 4:5 cut, &script=meet-main drives it.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams({
      ...readScriptParams(),
      portrait: sp.get("layout") === "portrait",
      phone: sp.get("layout") === "phone",
    });
  }, []);
  const statusRef = line.statusRef;
  const budgetRef = useRef(budget);
  budgetRef.current = budget;
  const lambdaRef = useRef(lambda);
  lambdaRef.current = lambda;
  /**
   * A script's station: a naptan, a name (fuzzy, like the picker), `#n` for the n-th shortlist
   * row, or `#fragile` for the row a single suspended line would hurt enough to re-pick (so the
   * clip's suspension has teeth; the first row when none would).
   */
  const resolveStation = useCallback(
    (station: string, taken: Set<string> = new Set()): string | undefined => {
      const rows = shortlistRef.current;
      if (station === "#fragile") {
        const os = originsRef.current.map((o) => o.id);
        let best: { id: string; added: number } | null = null;
        for (const id of rows) {
          const w = worstLine(id, os, statusRef.current, budgetRef.current);
          if (w && w.added >= REPICK_DELAY_MIN && (!best || w.added > best.added)) best = { id, added: w.added };
        }
        return best?.id ?? rows[0];
      }
      const row = /^#(\d+)$/.exec(station);
      if (row) return rows[Number(row[1]) - 1];
      return STATION_BY_ID[station]?.id ?? matchStations(station, taken, 1)[0];
    },
    [statusRef],
  );
  const addOrigin = useCallback(
    (station: string) => {
      setOrigins((os) => {
        const id = resolveStation(station, new Set(os.map((o) => o.id)));
        return id && !os.some((o) => o.id === id) && os.length < 5 ? [...os, { id }] : os;
      });
    },
    [resolveStation],
  );
  const lastDisruptRef = useRef<string | null>(null);
  const scriptAbortRef = useRef(false);
  useEffect(() => {
    const steps = params.script ? SCRIPTS[params.script] : null;
    if (!steps) return;
    scriptAbortRef.current = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") scriptAbortRef.current = true;
    };
    window.addEventListener("keydown", onKey);
    void runScript(steps, {
      setQuery,
      settled: live.settled,
      aborted: () => scriptAbortRef.current,
      delay: params.delay,
      warm: () =>
        fetch("/api/meet/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: "warm up",
            origins: [],
            candidates: CANDIDATES.slice(0, 40).map((s) => s.id),
          }),
        }).then((r) => r.text()),
      hooks: {
        commit: async (s) => {
          const id = s.type === "commit" && s.station ? resolveStation(s.station) : undefined;
          await commit(id);
        },
        sheet: async (s) => {
          if (s.type === "sheet" && committedRef.current) setSheetTo({ to: s.to, pick: committedRef.current.pick });
        },
        tap: async (s) => {
          if (s.type === "tap") previewRow(resolveStation(s.station) ?? null);
        },
        dial: async (s) => {
          if (s.type !== "dial") return;
          const from = lambdaRef.current;
          const t0 = performance.now();
          await new Promise<void>((done) => {
            const tick = () => {
              const k = Math.min(1, (performance.now() - t0) / s.ms);
              const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
              setLambda(from + (s.to - from) * e);
              if (k < 1 && !scriptAbortRef.current) requestAnimationFrame(tick);
              else done();
            };
            requestAnimationFrame(tick);
          });
        },
        caption: async (s) => {
          if (s.type !== "caption") return;
          if (s.text.includes("{line}") && !lastDisruptRef.current) return;
          setCaption(s.text.replace("{line}", lastDisruptRef.current ? lineName(lastDisruptRef.current) : ""));
        },
        origin: async (s) => {
          if (s.type === "origin") addOrigin(s.station);
        },
        disrupt: async (s) => {
          if (s.type !== "disrupt") return;
          const l =
            s.line === "pick"
              ? lineThatMatters(
                  committedRef.current?.pick ?? topRef.current,
                  originsRef.current.map((o) => o.id),
                  statusRef.current,
                  budgetRef.current,
                )
              : s.line;
          lastDisruptRef.current = l;
          setDisrupt(l);
          await waitFor(() => (l ? !!statusRef.current?.[l]?.simulated : !Object.values(statusRef.current ?? {}).some((v) => v.simulated)), 6000);
        },
      },
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      scriptAbortRef.current = true;
    };
    // The hooks read refs; only the script identity restarts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.script, params.delay]);

  const big = params.demo;
  // Size the query box to its text (one row to about three); the value can change from the script as well as the keyboard.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, big ? 200 : 132)}px`;
  }, [query, big]);
  /** Light everywhere but the recording layout, which stays dark (and so do the OG image and the Caption). */
  const theme: Theme = big ? "dark" : "light";
  const nobody = originIds.length > 0 && candidates.length === 0;
  const canCommit = !!top && !pick && lit;
  const pillCls = big ? "rounded-full px-4 py-1.5 text-base" : "rounded-full px-3 py-1 text-xs";

  return (
    <main data-theme={theme} className={`flex h-dvh flex-col bg-[var(--bg)] text-[var(--text)] ${big ? "px-4" : ""}`}>
      <header className={`flex items-center gap-3 px-4 pt-4 pb-2 ${big ? "pt-6" : ""}`}>
        <h1 className={`font-semibold tracking-tight ${big ? "text-3xl" : "text-lg"}`}>Where should we meet?</h1>
        <span className={`ml-auto text-[var(--muted)] ${big ? "text-base" : "text-xs"}`}>jev · london</span>
      </header>
      <OriginPicker
        origins={origins}
        onChange={setOrigins}
        budget={budget}
        budgetStated={statedBudget !== null}
        onBudget={(b) => {
          setManualBudget(b);
          setStatedBudget(null);
        }}
      />
      <div className="relative px-4 pb-2">
        {/* A one-row textarea that grows with the query: on a phone a long ask wraps under the button instead of vanishing behind it. Enter commits, Shift+Enter breaks the line. */}
        <textarea
          ref={inputRef}
          rows={1}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void commit();
            }
          }}
          placeholder={origins.length ? (big ? "pub with a garden, not a chain, everyone under 35 min…" : "pub with a garden, everyone under 35 min…") : "add who's coming, then say what you fancy…"}
          className={`block w-full resize-none overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] ${big ? "px-6 py-4 pr-40 text-2xl" : "px-4 py-3 pr-28 text-base"}`}
        />
        <AnimatePresence>
          {canCommit && (
            <motion.button key="commit" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING} onClick={() => void commit()} className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] font-semibold text-[var(--on-accent)] ${big ? "right-7 px-5 py-2 text-lg" : "right-6 px-3.5 py-1.5 text-xs"}`}>
              meet here ↵
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <IntentChips find={find} lit={lit} query={query} statedBudget={statedBudget} anchor={anchor} big={big} />
      <div className="relative min-h-0 flex-1 px-1">
        <TubeMap className="h-full w-full" probabilities={probabilities} feasible={feasibleSet} origins={origins} routes={routes} previewRoutes={previewRoutes} shortlist={shortlistIds} dimmedLines={line.dimmedLines} cutSegments={line.cutSegments} hovered={shown} onHover={setHovered} onTap={(id) => void commit(id)} onPreview={previewStation} previewed={preview} pick={pick} top={top} topLabel={topLabel} hoverLabel={hoverLabel} theme={theme} changes={changes} showRegion={region && !big} />
        <div className={`pointer-events-none absolute inset-x-4 top-2 flex flex-wrap gap-2 ${big ? "text-base" : "text-xs"}`}>
          {/* Phones: the legend sits under the banner, top-left, where the sheet never reaches (it hides while the sheet is full); from md up it is bottom-left below. */}
          {!big && (
            <div className={`order-last basis-full md:hidden ${pick && sheetState === "full" ? "hidden" : ""}`}>
              <Legend compact origins={origins} budget={budget} region={region} onRegion={setRegion} />
            </div>
          )}
          {live.error && <span className={`${pillCls} bg-[var(--hot)]/15 text-[var(--hot)]`}>{live.error}</span>}
          {nobody && <span className={`${pillCls} bg-[var(--warn)]/15 text-[var(--warn)]`}>nowhere is within {budget} min of everyone · raise the budget</span>}
          {repick && (
            <span className={`${pillCls} bg-[var(--warn)]/20 font-semibold text-[var(--warn)]`}>
              {repick.verify ? `TfL says ${repick.verify.tfl} min for ${repick.verify.person}, not ${repick.verify.graph}${repick.line ? ` · ${lineName(repick.line)} line` : ""}` : repick.line ? `${lineName(repick.line)} line suspended` : "the pick fell out of budget"} · re-picking{repick.simulated ? " · what if" : ""}
            </span>
          )}
          {!repick && <StatusBanner impacts={line.impacts} routeLines={routeLines} pillCls={pillCls} big={big} theme={theme} />}
        </div>
        <div className={`pointer-events-none absolute bottom-3 left-3 right-3 flex flex-col gap-2 ${big ? "" : "md:left-auto md:w-[440px]"}`}>
          <AnimatePresence>
            {/* Not in the recording layout: full-width it would cover the 4:5 map, and the script never touches the dial. */}
            {/* On phones the sheet below carries the shortlist and the card once there is a pick; these wrappers only hide them there (`contents` keeps the column's layout). */}
            {shortlist.length > 0 && !nobody && !big && (
              <div key="shortlist" className={pick ? "hidden md:contents" : "contents"}>
                <Shortlist rows={shortlist} pick={pick} previewed={preview} lambda={lambda} onLambda={setLambda} onPreview={previewRow} onCommit={(id) => void commit(id)} />
              </div>
            )}
            {pick && (
              <div key={pick} className={big ? "contents" : "hidden md:contents"}>
                <MeetResult
                  pick={pick}
                  origins={origins}
                  journeys={journeys}
                  verdicts={verdicts}
                  venues={
                    venues
                      ? {
                          state: venues,
                          kind: venueIntent.kind,
                          cuisine: venueIntent.cuisine,
                        }
                      : null
                  }
                  dimmedLines={line.dimmedLines}
                  localisedLines={line.localisedLines}
                  actions={<ResultActions onShare={() => void share()} shared={shared} onClose={() => setCommitted(null)} big={big} />}
                  big={big}
                  theme={theme}
                />
              </div>
            )}
          </AnimatePresence>
        </div>
        {!big && (
          <div className="pointer-events-none absolute bottom-3 left-3 hidden md:block">
            <Legend origins={origins} budget={budget} region={region} onRegion={setRegion} />
          </div>
        )}
        {/* Phones: the committed card as a bottom sheet over the live map (peek / half / full), the shortlist between its rows and venues. Never in the recording layout. Closing it drops the pick; a re-pick drops the pick too, so the sheet slides away. */}
        {!big && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden md:hidden">
            <AnimatePresence>
              {pick && (
                <Sheet key={pick} initial="half" to={sheetTo?.pick === pick ? sheetTo.to : null} onState={setSheetState}>
                  <MeetResult
                    layout="sheet"
                    pick={pick}
                    origins={origins}
                    journeys={journeys}
                    verdicts={verdicts}
                    venues={
                      venues
                        ? {
                            state: venues,
                            kind: venueIntent.kind,
                            cuisine: venueIntent.cuisine,
                          }
                        : null
                    }
                    dimmedLines={line.dimmedLines}
                    localisedLines={line.localisedLines}
                    actions={<ResultActions onShare={() => void share()} shared={shared} onClose={() => setCommitted(null)} />}
                    shortlist={shortlist.length > 0 && !nobody ? <Shortlist flat rows={shortlist} pick={pick} previewed={preview} lambda={lambda} onLambda={setLambda} onPreview={previewRow} onCommit={(id) => void commit(id)} /> : null}
                    theme={theme}
                  />
                </Sheet>
              )}
            </AnimatePresence>
          </div>
        )}
        <Caption text={caption} compact={params.phone} />
      </div>
      {/* Not in the phone recording: the clip is for people, not for the ms/tokens line. */}
      {!params.phone && (
        <div className="px-4 pb-2">
          <div className="hidden md:block">
            <MeetTelemetry status={live.status} find={find} totals={live.totals} trace={live.trace} startedAt={live.startedAtRef} candidates={candidates.length} budget={{ mins: budget, stated: statedBudget !== null }} />
          </div>
          <div className="md:hidden">
            <MeetTelemetry compact status={live.status} find={find} totals={live.totals} trace={live.trace} startedAt={live.startedAtRef} candidates={candidates.length} budget={{ mins: budget, stated: statedBudget !== null }} />
          </div>
        </div>
      )}
      <footer className={`px-4 pb-2 uppercase tracking-wide text-[var(--muted)] ${big ? "pb-4 text-xs" : "text-[10px]"}`}>Powered by TfL Open Data · © OpenStreetMap contributors · map is our own drawing</footer>
    </main>
  );
}

/** A caption over the map for muted autoplay (the recording scripts). */
function Caption({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div key={text} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={SPRING} className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center ${compact ? "top-[15%] px-3" : "top-[22%] px-6"}`}>
          <span className={`bg-black/75 text-center font-semibold leading-snug text-white shadow-2xl backdrop-blur ${compact ? "rounded-xl px-4 py-2 text-lg" : "rounded-2xl px-6 py-3 text-3xl"}`}>{text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
