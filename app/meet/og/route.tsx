import { ImageResponse } from "next/og";
import { decodeMeetParams } from "@/lib/meet-url";
import { GRAPH, LINE_COLOURS, MAP_H, MAP_W, STATIONS, STATION_BY_ID, shortName } from "@/lib/stations";
import { pathTo, reach } from "@/lib/tube-graph";
import { pathsByLine } from "@/lib/tube-segments";

export const runtime = "nodejs";

const W = 1200;
const H = 630;
const MAP_PX = { w: 720, h: 630 };
const LINE_PATHS = pathsByLine();

/** The view box around the people and the pick, in the map's aspect; the inner zones when there is nothing to frame. */
function frame(ids: string[]): { x: number; y: number; w: number; h: number } {
  const pts = ids.map((id) => STATION_BY_ID[id]).filter(Boolean);
  const base = pts.length ? pts : STATIONS.filter((s) => s.zone <= 2);
  const pad = pts.length ? 70 : 30;
  let x0 = Math.min(...base.map((s) => s.x)) - pad;
  let x1 = Math.max(...base.map((s) => s.x)) + pad;
  let y0 = Math.min(...base.map((s) => s.y)) - pad;
  let y1 = Math.max(...base.map((s) => s.y)) + pad;
  const aspect = MAP_PX.w / MAP_PX.h;
  let w = Math.max(x1 - x0, 260);
  let h = Math.max(y1 - y0, 260 / aspect);
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  x0 = Math.max(0, Math.min(MAP_W - w, cx - w / 2));
  y0 = Math.max(0, Math.min(MAP_H - h, cy - h / 2));
  return { x: x0, y: y0, w: Math.min(w, MAP_W), h: Math.min(h, MAP_H) };
}

/**
 * GET /meet/og?o=BXN,WWL&q=…&pick=ANG: the share image. Satori draws only a subset of
 * SVG, so the map is paths (one per line, plus the journeys) and circles, no text
 * inside the SVG; the words live in the flex column beside it.
 */
export async function GET(req: Request) {
  const p = decodeMeetParams(new URL(req.url).searchParams);
  const origins = p.origins.filter((o) => STATION_BY_ID[o.id]);
  const pick = p.pick && STATION_BY_ID[p.pick] ? STATION_BY_ID[p.pick] : null;
  const reaches = origins.map((o) => reach(o.id, GRAPH.edges));
  const routes = pick ? reaches.map((r) => pathTo(r, pick.id)) : [];
  const mins = pick ? reaches.map((r) => r.mins[pick.id]) : [];
  const box = frame([...origins.map((o) => o.id), ...(pick ? [pick.id] : [])]);
  const scale = box.w / MAP_PX.w; // map units per pixel, so dots and strokes hold their size at any crop
  const title = pick ? `Meet at ${pick.name}` : "Where should we meet?";
  const who = origins.map((o, i) => `${shortName(o.label ?? STATION_BY_ID[o.id].name)}${Number.isFinite(mins[i]) ? ` ${Math.round(mins[i])} min` : ""}`);

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", background: "#07080c", color: "#e8eaf2", fontFamily: "sans-serif" }}>
        <svg width={MAP_PX.w} height={MAP_PX.h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
          {Object.entries(LINE_PATHS).map(([line, d]) => (
            <path key={line} d={d} fill="none" stroke={LINE_COLOURS[line]} strokeWidth={2.6 * scale} strokeLinecap="round" opacity={routes.length ? 0.4 : 0.85} />
          ))}
          {STATIONS.map((s) => (
            <circle key={s.id} cx={s.x} cy={s.y} r={(s.lines.length > 1 ? 2.6 : 1.8) * scale} fill={s.lines.length > 1 ? "#0f1118" : "#8b90a5"} stroke={s.lines.length > 1 ? "#c8ccd8" : "none"} strokeWidth={0.8 * scale} opacity={0.7} />
          ))}
          {routes.map((legs, i) =>
            legs.map((leg, k) => {
              const pts = leg.stations.map((id) => STATION_BY_ID[id]).filter(Boolean);
              const d = pts.map((s, j) => `${j ? "L" : "M"}${s.x} ${s.y}`).join(" ");
              return <path key={`${i}-${k}`} d={d} fill="none" stroke={LINE_COLOURS[leg.line] ?? "#fff"} strokeWidth={6 * scale} strokeLinecap="round" strokeLinejoin="round" />;
            }),
          )}
          {origins.map((o) => {
            const s = STATION_BY_ID[o.id];
            return <circle key={o.id} cx={s.x} cy={s.y} r={6 * scale} fill="#fff" stroke="#4fd1c5" strokeWidth={2.5 * scale} />;
          })}
          {pick && <circle cx={pick.x} cy={pick.y} r={16 * scale} fill="none" stroke="#3ddc97" strokeWidth={2 * scale} opacity={0.6} />}
          {pick && <circle cx={pick.x} cy={pick.y} r={9 * scale} fill="#3ddc97" stroke="#07080c" strokeWidth={2 * scale} />}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: W - MAP_PX.w, padding: "48px 56px 48px 24px" }}>
          <div style={{ fontSize: 20, color: "#8b90a5", letterSpacing: 2, textTransform: "uppercase" }}>jev · london</div>
          <div style={{ fontSize: pick && pick.name.length > 14 ? 44 : 54, fontWeight: 700, lineHeight: 1.1, marginTop: 12, color: pick ? "#3ddc97" : "#e8eaf2" }}>{title}</div>
          {pick && <div style={{ fontSize: 22, color: "#8b90a5", marginTop: 14, lineHeight: 1.3 }}>{pick.hook}</div>}
          {who.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 28, gap: 8 }}>
              {who.map((w, i) => (
                <div key={i} style={{ display: "flex", fontSize: 26, gap: 14 }}>
                  <span style={{ color: "#4fd1c5", fontWeight: 700 }}>{i + 1}</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
          {p.q && <div style={{ fontSize: 22, color: "#c8ccd8", marginTop: 28, lineHeight: 1.3 }}>{`"${p.q}"`}</div>}
          <div style={{ fontSize: 14, color: "#4b5064", marginTop: 32 }}>Powered by TfL Open Data · © OpenStreetMap contributors</div>
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "cache-control": "public, max-age=300" } },
  );
}
