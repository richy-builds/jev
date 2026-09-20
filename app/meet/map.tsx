"use client";

import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { motion } from "framer-motion";
import { MAP_H, MAP_W, STATIONS, STATION_BY_ID, lineColour, type Origin, type Theme } from "@/lib/stations";
import { edgeKey } from "@/lib/closures";
import { convexHull, polygonPath } from "@/lib/hull";
import type { Leg } from "@/lib/tube-graph";
import { SEGMENTS } from "@/lib/tube-segments";
import { useViewBox, type ViewBox } from "@/lib/use-viewbox";

const HOME: ViewBox = { x: 0, y: 0, w: MAP_W, h: MAP_H };

/** Zones 1–2 with a margin: what a portrait screen opens on (the rest is a pan away). */
const INNER = (() => {
  const z = STATIONS.filter((s) => s.zone <= 2);
  const pad = 28;
  const x0 = Math.min(...z.map((s) => s.x)) - pad;
  const x1 = Math.max(...z.map((s) => s.x)) + pad;
  const y0 = Math.min(...z.map((s) => s.y)) - pad;
  const y1 = Math.max(...z.map((s) => s.y)) + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();

/**
 * The home box for a container of the given aspect: the whole map when it is wide
 * enough, otherwise the inner zones filling the container's shape, so a phone opens
 * on a legible centre rather than the whole network at a third of the width.
 */
function homeFor(aspect: number, origins: Origin[]): ViewBox {
  if (!aspect || aspect >= (MAP_W / MAP_H) * 0.85) return HOME;
  // The inner zones, stretched to take in everyone's origin (an outer-zone origin off the edge of the screen reads as missing).
  const pad = 28;
  const box = { ...INNER };
  for (const o of origins) {
    const s = STATION_BY_ID[o.id];
    if (!s) continue;
    const x0 = Math.min(box.x, s.x - pad);
    const y0 = Math.min(box.y, s.y - pad);
    box.w = Math.max(box.x + box.w, s.x + pad) - x0;
    box.h = Math.max(box.y + box.h, s.y + pad) - y0;
    box.x = x0;
    box.y = y0;
  }
  let w = box.w;
  let h = w / aspect;
  if (h < box.h) {
    h = box.h;
    w = h * aspect;
  }
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}



/** A route to draw: legs along the graph, or TfL's legs; `flagged` legs ride a suspended line and draw dashed. */
export type RouteDraw = { origin: string; legs: (Leg & { flagged?: boolean })[] };

/** A change station on a route: a dashed ring, with the minutes TfL's journey spends there once it has landed (lib/meet-times.ts `splitWait`), plain "change" until then. */
export type ChangeMark = { id: string; mins: number | null };

/** The label pill under the pick and the hovered station stays dark in both themes (the mockup does the same): a / b minutes on ink. */
const PILL = { bg: "#0f1118", text: "#e8eaf2", sub: "#8b90a5", line: "#232738" };

/**
 * The "everyone within N min" region. A convex hull over the feasible stations
 * (lib/hull.ts) over-covers here: the feasible set runs out along fast lines, so at
 * 45 min for Brixton / Walthamstow / Ealing the hull reaches Northwick Park and only
 * ~40 % of its area lies within 14 units of a feasible station. The union of soft
 * circles follows the spokes instead; the hull stays selectable.
 */
const REGION_STYLE = "circles" as "hull" | "circles";
const REGION_R = 24;

export type MapProps = {
  /** Per station id, 0..1. Missing means unlit. */
  probabilities?: Record<string, number> | null;
  /** Ids sent to Jev this keystroke; the rest are drawn dim. Null lights nothing specially. */
  feasible?: Set<string> | null;
  top?: string | null;
  pick?: string | null;
  origins?: Origin[];
  routes?: RouteDraw[];
  /** A shortlist row under the pointer: the graph's paths to it, drawn thinner and lighter than a committed route, with no reveal. */
  previewRoutes?: RouteDraw[];
  /** Runner-up ids from the shortlist: hollow rings, so they read as candidates next to the pick. */
  shortlist?: string[];
  /** Line ids to dim (disrupted). */
  dimmedLines?: Set<string>;
  /** Edge keys (lib/closures.ts) whose track is closed today: those segments dash while the rest of the line stays lit. */
  cutSegments?: Set<string>;
  hovered?: string | null;
  onHover?: (id: string | null) => void;
  onTap?: (id: string) => void;
  /** Touch has no hover: the first tap on a station previews it (its routes and the minutes label), the second commits through `onTap`. Mouse and pen commit on click. */
  onPreview?: (id: string | null) => void;
  /** The station a touch previewed; a tap on it commits. */
  previewed?: string | null;
  /** Label text under the top pick, e.g. "Brixton 12 · Walthamstow 31". */
  topLabel?: string | null;
  /** Label text under the hovered station (per-origin minutes). */
  hoverLabel?: string | null;
  /** Light: context lines faint in their own colour, route legs cased in white, official TfL colours. Dark (the default, the recording, the OG image) is unchanged. */
  theme?: Theme;
  /** Change stations on the committed routes: dashed rings with "change · N min". */
  changes?: ChangeMark[];
  /** Shade the region the `feasible` stations cover ("everyone within N min"). */
  showRegion?: boolean;
  className?: string;
};

/**
 * The schematic tube map: our own drawing from TfL station coordinates (a log fisheye
 * keeps Zone 1 legible), not TfL's map. Stations light with probability; the top pick
 * gets a label; committed journeys draw along the graph's own path so they follow the
 * schematic rather than the geography.
 */
export const TubeMap = memo(function TubeMap({
  probabilities,
  feasible,
  top,
  pick,
  origins = [],
  routes = [],
  previewRoutes = [],
  shortlist = [],
  dimmedLines,
  cutSegments,
  hovered,
  onHover,
  onTap,
  onPreview,
  previewed,
  topLabel,
  hoverLabel,
  theme = "dark",
  changes = [],
  showRegion = false,
  className,
}: MapProps) {
  const light = theme === "light";
  const svgRef = useRef<SVGSVGElement>(null);
  /**
   * The station the pointer went down on. Taps resolve on the svg's click, not the
   * circle's: lib/use-viewbox.ts captures the pointer on the svg for panning, so a mouse's
   * pointerup and click are retargeted to the svg and never reach the circle (a touch's
   * click still does; it bubbles here too). A pan that started on a station is not a tap.
   */
  const tap = useRef<{ id: string; type: string; x: number; y: number } | null>(null);
  const onSvgClick = (e: ReactMouseEvent) => {
    const t = tap.current;
    tap.current = null;
    if (!t || !onTap || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 6) return;
    // Touch has no hover: the first tap previews, a tap on the previewed station commits.
    if (t.type === "touch" && onPreview && previewed !== t.id) onPreview(t.id);
    else onTap(t.id);
  };
  const [home, setHome] = useState<ViewBox>(HOME);
  const { vb, viewBox, scale, size } = useViewBox(svgRef, home);
  const aspect = size.h ? Math.round((size.w / size.h) * 50) / 50 : 0;
  useEffect(() => {
    const next = homeFor(aspect, origins);
    setHome((h) => (h.x === next.x && h.y === next.y && h.w === next.w && h.h === next.h ? h : next));
  }, [aspect, origins]);
  const originIds = useMemo(() => new Set(origins.map((o) => o.id)), [origins]);
  const routeActive = routes.length > 0;
  /** Sizes below are in screen pixels times `scale`, so they hold whatever the zoom or device. */
  const fs = 11 * scale;

  const lit = (id: string) => probabilities?.[id] ?? 0;
  const maxP = useMemo(() => (probabilities ? Math.max(0.0001, ...Object.values(probabilities)) : 1), [probabilities]);
  const colour = (line: string) => lineColour(line, theme);

  // The region: the feasible stations' positions, as a hull path or as circles (see REGION_STYLE).
  const regionPts = useMemo(() => (showRegion && feasible ? [...feasible].map((id) => STATION_BY_ID[id]).filter(Boolean).map((st) => ({ x: st.x, y: st.y })) : []), [showRegion, feasible]);
  const hullPath = useMemo(() => (REGION_STYLE === "hull" && regionPts.length >= 3 ? polygonPath(convexHull(regionPts)) : null), [regionPts]);

  /** The label pill's box for the top pick or the hovered station (screen-sized, kept inside the view). */
  const labelBox = (id: string, isTop: boolean) => {
    const s = STATION_BY_ID[id];
    const label = s.name;
    const sub = isTop ? topLabel : hoverLabel;
    const w = Math.max(label.length, sub?.length ?? 0) * fs * 0.58 + fs * 1.2;
    const h = sub ? fs * 3.1 : fs * 1.9;
    const above = s.y - vb.y > vb.h * 0.2;
    const y = above ? s.y - 14 * scale - h : s.y + 14 * scale;
    // Keep the box inside the view so a label near the edge is not cut off.
    const x = Math.min(Math.max(s.x, vb.x + w / 2 + 4 * scale), vb.x + vb.w - w / 2 - 4 * scale);
    return { s, label, sub, x, y, w, h };
  };
  const labels = [top, hovered !== top ? hovered : null].map((id, i) => (id && STATION_BY_ID[id] ? { ...labelBox(id, i === 0), isTop: i === 0 } : null));
  const pillBoxes = labels.filter((l) => l !== null).map((l) => ({ x: l.x - l.w / 2, y: l.y, w: l.w, h: l.h }));
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** Boxes a change label must not sit under: the pills, then each change label already placed this render. */
  const obstacles = [...pillBoxes];

  /** One leg as a path, with its length for the dash reveal. */
  const legPath = (leg: Leg) => {
    const pts = leg.stations.map((id) => STATION_BY_ID[id]).filter(Boolean);
    const d = pts.map((st, j) => `${j ? "L" : "M"}${st.x} ${st.y}`).join(" ");
    const len = pts.reduce((acc, st, j) => (j ? acc + Math.hypot(st.x - pts[j - 1].x, st.y - pts[j - 1].y) : 0), 0);
    return { d, len };
  };

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className={className}
      style={{ touchAction: "none", cursor: "grab" }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Schematic map of the London Underground"
      onClick={onSvgClick}
    >
      {/* Region: where everyone can be within the budget, under everything else. Soft circles merge into one blob through the blur + alpha ramp; the hull is one path. */}
      {regionPts.length > 0 && (
        <g fill="var(--accent)" pointerEvents="none">
          {hullPath ? (
            <path d={hullPath} fillOpacity={0.08} stroke="var(--accent)" strokeOpacity={0.3} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="6 6" strokeLinejoin="round" />
          ) : (
            <>
              <defs>
                <filter id="meet-region" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
                  <feGaussianBlur stdDeviation={REGION_R * 0.6} />
                  <feComponentTransfer>
                    <feFuncA type="table" tableValues="0 0 0 1 1 1" />
                  </feComponentTransfer>
                </filter>
              </defs>
              <g filter="url(#meet-region)" opacity={light ? 0.1 : 0.14}>
                {regionPts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={REGION_R} />
                ))}
              </g>
            </>
          )}
        </g>
      )}

      <g strokeLinecap="round" fill="none">
        {SEGMENTS.map((s) => {
          const [a, b] = s.key.split("|");
          const dim = dimmedLines?.has(s.line) || cutSegments?.has(edgeKey(s.line, a, b));
          // Light: context lines faint in their own colour (the cased route legs carry the contrast). Dark: as before.
          const opacity = light ? (dim ? 0.18 : 0.35) : dim ? 0.18 : routeActive ? 0.42 : 0.8;
          return (
            <line
              key={s.key}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={colour(s.line)}
              strokeWidth={2.4}
              vectorEffect="non-scaling-stroke"
              strokeOpacity={opacity}
              strokeDasharray={dim ? "3 3" : undefined}
              style={{ transition: "stroke-opacity 400ms" }}
            />
          );
        })}
      </g>

      {/* Preview: a shortlist row's routes along the graph, thinner and lighter, no reveal, so it reads as "what if". Under the committed routes; cased in light. */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
        {(light ? [true, false] : [false]).map((casing) =>
          previewRoutes.map((r) =>
            r.legs.map((leg, i) => (
              <motion.path
                key={`preview-${casing ? "case-" : ""}${r.origin}-${i}`}
                d={legPath(leg).d}
                stroke={casing ? "var(--panel)" : colour(leg.line)}
                strokeWidth={casing ? 6 : 3}
                strokeOpacity={casing ? 0.85 : 0.6}
                vectorEffect="non-scaling-stroke"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
              />
            )),
          ),
        )}
      </g>

      {/* Journeys: each leg along the graph path, in its line colour, drawn on with a dash reveal. Light draws every leg twice: a white casing under the colour, so a route reads over the faint context. */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {(light ? [true, false] : [false]).map((casing) =>
          routes.map((r) =>
            r.legs.map((leg, i) => {
              const { d, len } = legPath(leg);
              return (
                <motion.path
                  key={`${casing ? "case-" : ""}${r.origin}-${i}`}
                  d={d}
                  stroke={casing ? "var(--panel)" : colour(leg.line)}
                  strokeWidth={casing ? 8 : 5}
                  strokeOpacity={leg.flagged ? 0.45 : 1}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={leg.flagged ? "6 6" : len}
                  initial={{ strokeDashoffset: leg.flagged ? 0 : len, opacity: 0 }}
                  animate={{ strokeDashoffset: 0, opacity: 1 }}
                  transition={{ duration: Math.min(1.6, 0.25 + len / 400), ease: "easeInOut", delay: i * 0.25 }}
                />
              );
            }),
          ),
        )}
      </g>

      <g>
        {STATIONS.map((s) => {
          const p = lit(s.id);
          const rel = p / maxP;
          const isTop = s.id === top;
          const isPick = s.id === pick;
          const isOrigin = originIds.has(s.id);
          const out = feasible ? !feasible.has(s.id) : !s.candidate;
          const interchange = s.lines.length > 1;
          const base = (interchange ? 3.2 : 2.3) * scale;
          const r = isOrigin ? 5 * scale : base + rel * 11 * scale;
          const fill = isOrigin ? "var(--map-origin)" : isPick ? "var(--good)" : rel > 0.02 ? "var(--accent)" : interchange ? "var(--panel)" : "var(--map-station)";
          const stroke = isOrigin ? "var(--accent-2)" : interchange ? "var(--map-ring)" : "none";
          return (
            <circle
              key={s.id}
              cx={s.x}
              cy={s.y}
              r={r}
              fill={fill}
              fillOpacity={out && !isOrigin ? 0.25 : rel > 0.02 ? 0.35 + 0.65 * rel : 1}
              stroke={stroke}
              strokeWidth={(isOrigin ? 2 : 1) * scale}
              strokeOpacity={out ? 0.3 : 1}
              style={{ transition: "r 260ms ease-out, fill-opacity 260ms, fill 260ms", cursor: onTap ? "pointer" : undefined }}
              onPointerEnter={onHover ? () => onHover(s.id) : undefined}
              onPointerLeave={onHover ? () => onHover(null) : undefined}
              onPointerDown={(e) => {
                tap.current = { id: s.id, type: e.pointerType, x: e.clientX, y: e.clientY };
              }}
            >
              <title>{s.name}</title>
            </circle>
          );
        })}
      </g>

      {/* Glow ring on the top pick. */}
      {top && STATION_BY_ID[top] && (
        <motion.circle
          key={top}
          cx={STATION_BY_ID[top].x}
          cy={STATION_BY_ID[top].y}
          fill="none"
          stroke={pick === top ? "var(--good)" : "var(--accent)"}
          strokeWidth={1.5 * scale}
          initial={{ r: 6 * scale, opacity: 0.9 }}
          animate={{ r: 24 * scale, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      )}

      {/* Shortlist runner-ups: hollow rings (the top pick has its glow, the committed pick its fill). A touch heavier on white. */}
      {shortlist
        .filter((id) => id !== top && id !== pick && STATION_BY_ID[id])
        .map((id) => (
          <circle
            key={`ring-${id}`}
            cx={STATION_BY_ID[id].x}
            cy={STATION_BY_ID[id].y}
            r={7 * scale}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={(light ? 2 : 1.5) * scale}
            strokeOpacity={light ? 0.85 : 0.7}
            pointerEvents="none"
          />
        ))}

      {/* Change stations on the committed routes: a dashed ring and "change · N min" (the minutes once TfL has landed). One ring per station, however many people change there; each label placed keeps the next off it. */}
      {[...changes.reduce((m, c) => m.set(c.id, [...(m.get(c.id) ?? []), c.mins]), new Map<string, (number | null)[]>())]
        .filter(([id]) => STATION_BY_ID[id] && id !== pick)
        .map(([id, mins]) => {
          const s = STATION_BY_ID[id];
          const ns = mins.filter((m): m is number => m !== null);
          const text = ns.length ? `change · ${[...new Set(ns)].join(" / ")} min` : "change";
          const tf = fs * 0.85;
          const w = text.length * tf * 0.58 + tf;
          // Right-above the ring by default; the other corners when that would sit under a label pill, and beside the pill when the ring is wholly behind it (a change one stop from the pick is).
          const spots = [
            { x: s.x + 11 * scale, y: s.y - 8 * scale, end: false },
            { x: s.x - 11 * scale, y: s.y - 8 * scale, end: true },
            { x: s.x + 11 * scale, y: s.y + 12 * scale + tf, end: false },
            { x: s.x - 11 * scale, y: s.y + 12 * scale + tf, end: true },
            ...pillBoxes.flatMap((b) => [
              { x: b.x + b.w + tf * 0.8, y: s.y + tf * 0.35, end: false },
              { x: b.x - tf * 0.8, y: s.y + tf * 0.35, end: true },
            ]),
          ].map((p) => ({ ...p, box: { x: p.end ? p.x - w + tf * 0.5 : p.x - tf * 0.5, y: p.y - tf * 1.1, w, h: tf * 1.5 } }));
          const spot = spots.find((p) => !obstacles.some((b) => overlaps(p.box, b))) ?? spots[0];
          obstacles.push(spot.box);
          return (
            <motion.g key={`change-${id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} pointerEvents="none">
              <circle cx={s.x} cy={s.y} r={8 * scale} fill="none" stroke="var(--text)" strokeOpacity={0.85} strokeWidth={1.3 * scale} strokeDasharray={`${2.5 * scale} ${2.5 * scale}`} />
              <rect x={spot.box.x} y={spot.box.y} width={w} height={tf * 1.5} rx={tf * 0.35} fill="var(--panel)" fillOpacity={0.92} stroke="var(--line)" strokeWidth={1 * scale} />
              <text x={spot.x} y={spot.y} textAnchor={spot.end ? "end" : "start"} fontSize={tf} fontWeight={600} fill="var(--text)">
                {text}
              </text>
            </motion.g>
          );
        })}

      {/* Origins: numbered rings. */}
      {origins.map((o, i) => {
        const s = STATION_BY_ID[o.id];
        if (!s) return null;
        return (
          <g key={o.id} pointerEvents="none">
            <circle cx={s.x} cy={s.y} r={8 * scale} fill="none" stroke="var(--accent-2)" strokeWidth={1.5 * scale} />
            <text x={s.x} y={s.y - 11 * scale} textAnchor="middle" fontSize={fs} fontWeight={700} fill={light ? "var(--text)" : "var(--accent-2)"} className="mono">
              {i + 1}
            </text>
          </g>
        );
      })}

      {/* Labels: the top pick and the hovered station. */}
      {labels.map((l) => {
        if (!l) return null;
        const { s, label, sub, x, y, w, h, isTop } = l;
        return (
          <motion.g key={`label-${s.id}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} pointerEvents="none">
            <rect x={x - w / 2} y={y} width={w} height={h} rx={fs * 0.5} fill={PILL.bg} fillOpacity={0.94} stroke={isTop ? "var(--accent)" : PILL.line} strokeWidth={1 * scale} />
            <text x={x} y={y + fs * 1.3} textAnchor="middle" fontSize={fs} fontWeight={600} fill={PILL.text}>
              {label}
            </text>
            {sub && (
              <text x={x} y={y + fs * 2.5} textAnchor="middle" fontSize={fs * 0.85} fill={PILL.sub} className="mono">
                {sub}
              </text>
            )}
          </motion.g>
        );
      })}
    </svg>
  );
});
