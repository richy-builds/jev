// Builds data/stations.json and data/tube-graph.json for /meet from TfL Unified API
// (station coordinates, line sequences, hop times) and OpenStreetMap via Overpass
// (what is near each station, drafted into a one-line hook). Every upstream response
// is cached under scripts/cache/ so re-runs are free and resumable.
//
//   node scripts/build-stations.mjs            # full build (uses cache)
//   node scripts/build-stations.mjs --no-osm   # skip Overpass, keep hooks from overrides/previous build
//   node scripts/build-stations.mjs --refresh  # ignore the TfL cache (not Overpass)
//
// Hand-written hooks in data/station-hooks.json ({ "<naptan>": "hook" }) win over drafts.
// Attribution: Powered by TfL Open Data · © OpenStreetMap contributors (ODbL).

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const NO_OSM = args.includes("--no-osm");
const REFRESH = args.includes("--refresh");
const CACHE = "scripts/cache";
const TFL = "https://api.tfl.gov.uk";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const APP_KEY = process.env.TFL_APP_KEY ?? "";
// overpass-api.de answers 406 to requests with no User-Agent.
const UA = "jev-meet-build/1.0 (github.com/richyjudge; contact via repo)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(key, fetcher, { refresh = false } = {}) {
  const file = path.join(CACHE, `${key}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const data = await fetcher();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

async function tfl(pathname) {
  const key = `tfl/${pathname.replace(/^\//, "").replace(/[^\w.-]+/g, "_")}`;
  return cached(
    key,
    async () => {
      const url = `${TFL}${pathname}${APP_KEY ? `${pathname.includes("?") ? "&" : "?"}app_key=${APP_KEY}` : ""}`;
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { headers: { "user-agent": UA } });
        if (res.ok) {
          await sleep(APP_KEY ? 50 : 400); // anonymous TfL throttles bursts of timetable calls
          return res.json();
        }
        if (attempt >= 5) throw new Error(`TfL ${res.status} ${pathname}`);
        console.warn(`  TfL ${res.status} on ${pathname}, retrying`);
        await sleep(4000 * (attempt + 1));
      }
    },
    { refresh: REFRESH },
  );
}

// ---------------------------------------------------------------- TfL: stations, edges

const stripName = (n) => n.replace(/ Underground Station$/, "").replace(/-Underground$/, "").replace(/ \(.*\)$/, "").trim();
// "2+3" → 2.5, "6" → 6, anything else → 0 (unknown).
const parseZone = (z) => {
  const nums = String(z ?? "").match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
};

const lines = (await tfl("/Line/Mode/tube")).map((l) => ({ id: l.id, name: l.name }));
console.log(`${lines.length} lines`);

/** id → station */
const stations = new Map();
/** "a|b|line" → { a, b, line, mins: number[] } (a < b) */
const edges = new Map();
/** Per line, every ordered stop sequence (both directions, every branch) for the timetable pass. */
const sequences = [];

for (const line of lines) {
  for (const dir of ["inbound", "outbound"]) {
    const seq = await tfl(`/Line/${line.id}/Route/Sequence/${dir}`);
    for (const sps of seq.stopPointSequences ?? []) {
      const ids = [];
      for (const sp of sps.stopPoint) {
        ids.push(sp.id);
        const s = stations.get(sp.id) ?? {
          id: sp.id,
          name: stripName(sp.name),
          lat: sp.lat,
          lon: sp.lon,
          zone: parseZone(sp.zone),
          hub: sp.parentId ?? sp.topMostParentId ?? null,
          lines: new Set(),
        };
        s.lines.add(line.id);
        stations.set(sp.id, s);
      }
      for (let i = 0; i + 1 < ids.length; i++) {
        const [a, b] = ids[i] < ids[i + 1] ? [ids[i], ids[i + 1]] : [ids[i + 1], ids[i]];
        const key = `${a}|${b}|${line.id}`;
        if (!edges.has(key)) edges.set(key, { a, b, line: line.id, mins: [] });
      }
      sequences.push({ line: line.id, ids });
    }
  }
}
console.log(`${stations.size} stations, ${edges.size} edges`);

// ---------------------------------------------------------------- TfL: hop minutes from timetables

// Timetable from a sequence's first stop lists timeToArrival (whole minutes) for every stop
// downstream; consecutive differences are the hop times. Both directions are fetched so
// every edge gets at least one reading; the median is kept.
const seen = new Set();
for (const { line, ids } of sequences) {
  const from = ids[0];
  const to = ids[ids.length - 1];
  const k = `${line}|${from}|${to}`;
  if (seen.has(k) || from === to) continue;
  seen.add(k);
  let tt;
  try {
    tt = await tfl(`/Line/${line}/Timetable/${from}/to/${to}`);
  } catch (e) {
    console.warn(`  no timetable ${line} ${from}→${to}: ${e.message}`);
    continue;
  }
  for (const route of tt.timetable?.routes ?? []) {
    for (const si of route.stationIntervals ?? []) {
      const stops = [{ stopId: from, timeToArrival: 0 }, ...(si.intervals ?? [])];
      for (let i = 0; i + 1 < stops.length; i++) {
        const [a, b] = stops[i].stopId < stops[i + 1].stopId ? [stops[i].stopId, stops[i + 1].stopId] : [stops[i + 1].stopId, stops[i].stopId];
        const e = edges.get(`${a}|${b}|${line}`);
        if (!e) continue; // interval lists can skip stops on express patterns
        const d = stops[i + 1].timeToArrival - stops[i].timeToArrival;
        if (d >= 1 && d <= 15) e.mins.push(d);
      }
    }
  }
}

const km = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const median = (xs) => {
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
};
let fallback = 0;
const graphEdges = [...edges.values()].map((e) => {
  let mins;
  if (e.mins.length) mins = median(e.mins);
  else {
    fallback++;
    mins = Math.max(1, Math.round(km(stations.get(e.a), stations.get(e.b)) * 1.6 + 0.6));
  }
  return { a: e.a, b: e.b, line: e.line, mins };
});
console.log(`hop times: ${graphEdges.length - fallback} from timetables, ${fallback} from distance`);

// Stations sharing a TfL hub but with different naptans (Bank/Monument, Paddington's two) get a walking link.
const byHub = new Map();
for (const s of stations.values()) if (s.hub) (byHub.get(s.hub) ?? byHub.set(s.hub, []).get(s.hub)).push(s.id);
const walks = [];
for (const ids of byHub.values()) {
  if (ids.length < 2) continue;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) walks.push({ a: ids[i], b: ids[j], line: "walk", mins: 4 });
}
// Bank and Monument are one interchange with two naptans and, in TfL data, two hubs.
const byName = (n) => [...stations.values()].find((s) => s.name === n)?.id;
if (byName("Bank") && byName("Monument")) walks.push({ a: byName("Bank"), b: byName("Monument"), line: "walk", mins: 4 });
console.log(`hub walking links: ${walks.map((w) => `${stations.get(w.a).name}↔${stations.get(w.b).name}`).join(", ") || "none"}`);

// ---------------------------------------------------------------- candidates (≤250 for one Choice)

// Outer ends nobody would suggest for a meetup; the map still draws them.
const NOT_CANDIDATES = new Set([
  // Metropolitan beyond Harrow-on-the-Hill
  "North Harrow", "Pinner", "Northwood Hills", "Northwood", "Moor Park", "Croxley", "Watford", "Rickmansworth", "Chorleywood", "Chalfont & Latimer", "Chesham", "Amersham",
  "West Harrow", "Rayners Lane", "Eastcote", "Ruislip Manor", "Ruislip", "Ickenham", "Hillingdon", "Uxbridge",
  // Central beyond Woodford / Newbury Park / Ruislip Gardens
  "Buckhurst Hill", "Loughton", "Debden", "Theydon Bois", "Epping", "Barkingside", "Fairlop", "Hainault", "Grange Hill", "Chigwell", "Roding Valley", "West Ruislip",
]);
for (const s of stations.values()) s.candidate = !NOT_CANDIDATES.has(s.name);
const SHORT = { bakerloo: "Bakerloo", central: "Central", circle: "Circle", district: "District", "hammersmith-city": "H&C", jubilee: "Jubilee", metropolitan: "Met", northern: "Northern", piccadilly: "Piccadilly", victoria: "Victoria", "waterloo-city": "W&C" };
{
  const groups = new Map();
  for (const s of stations.values()) (groups.get(s.name) ?? groups.set(s.name, []).get(s.name)).push(s);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => b.lines.size - a.lines.size);
    for (const s of g.slice(1)) {
      s.candidate = false;
      s.name = `${s.name} (${[...s.lines].map((l) => SHORT[l]).join("/")})`;
    }
  }
}
// The two Edgware Roads are a street apart; TfL lists them under different hubs.
{
  const er = [...stations.values()].filter((s) => /^Edgware Road/.test(s.name));
  if (er.length === 2) walks.push({ a: er[0].id, b: er[1].id, line: "walk", mins: 6 });
}
const candidates = [...stations.values()].filter((s) => s.candidate);
console.log(`${candidates.length} candidates (cap 250)`);
if (candidates.length > 250) throw new Error("too many candidates for one Choice");
const unknownNames = [...NOT_CANDIDATES].filter((n) => ![...stations.values()].some((s) => s.name === n));
if (unknownNames.length) console.warn(`  exclusion names not found: ${unknownNames.join(", ")}`);

// ---------------------------------------------------------------- layout: Mercator, centred, log fisheye

// Centre on Oxford Circus, compress the outer city with r' = R·ln(1 + r/R) so Zone 1 is legible
// and Amersham still fits, then scale into a 1000×800 box with a margin.
const centre = [...stations.values()].find((s) => s.name === "Oxford Circus");
const merc = (s) => {
  const x = (s.lon * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (s.lat * Math.PI) / 360));
  return [x, y];
};
const [cx, cy] = merc(centre);
const KM_PER_RAD = 6371;
const R = 4; // km
const projected = new Map();
for (const s of stations.values()) {
  const [x, y] = merc(s);
  const dx = (x - cx) * KM_PER_RAD * Math.cos((centre.lat * Math.PI) / 180);
  const dy = (y - cy) * KM_PER_RAD * Math.cos((centre.lat * Math.PI) / 180);
  const r = Math.hypot(dx, dy);
  const f = r > 0 ? (R * Math.log(1 + r / R)) / r : 1;
  projected.set(s.id, [dx * f, -dy * f]);
}
const xs = [...projected.values()].map((p) => p[0]);
const ys = [...projected.values()].map((p) => p[1]);
const W = 1000, H = 800, M = 30;
const sx = (W - 2 * M) / (Math.max(...xs) - Math.min(...xs));
const sy = (H - 2 * M) / (Math.max(...ys) - Math.min(...ys));
const scale = Math.min(sx, sy);
const ox = (W - (Math.max(...xs) - Math.min(...xs)) * scale) / 2 - Math.min(...xs) * scale;
const oy = (H - (Math.max(...ys) - Math.min(...ys)) * scale) / 2 - Math.min(...ys) * scale;
for (const s of stations.values()) {
  const [px, py] = projected.get(s.id);
  s.x = Math.round((px * scale + ox) * 10) / 10;
  s.y = Math.round((py * scale + oy) * 10) / 10;
}

// ---------------------------------------------------------------- OSM: what is near each station

const CATS = {
  pubs: (t) => t.amenity === "pub",
  bars: (t) => t.amenity === "bar" || t.amenity === "nightclub",
  restaurants: (t) => t.amenity === "restaurant",
  cafes: (t) => t.amenity === "cafe",
  parks: (t) => t.leisure === "park" || t.leisure === "garden" || t.leisure === "nature_reserve",
  culture: (t) => ["museum", "gallery", "attraction", "artwork", "viewpoint", "zoo", "aquarium"].includes(t.tourism) || ["theatre", "cinema", "arts_centre", "music_venue"].includes(t.amenity) || !!t.historic,
  markets: (t) => t.amenity === "marketplace" || t.shop === "mall" || t.shop === "department_store",
};
// Places worth naming in a hook. Statues, memorials, plaques and listed railings carry wikidata
// tags too, so they are ruled out by tag and by name pattern; markets, parks, museums and
// theatres are what people actually describe.
const JUNK = /memorial|monument to|statue|plaque|railings|numbers? \d|entrance|substation|water tower|drinking fountain|bollard|milestone|war memorial|k\d kiosk|telephone kiosk/i;
const notableWeight = (t) => {
  if (!t.name || JUNK.test(t.name)) return 0;
  if (["memorial", "boundary_stone", "milestone", "wayside_cross", "wayside_shrine", "cannon"].includes(t.historic)) return 0;
  let w = 0;
  if (t.amenity === "marketplace") w = 3;
  else if (t.tourism === "museum" || t.tourism === "gallery") w = 2.5;
  else if (t.tourism === "attraction" || t.tourism === "zoo" || t.tourism === "aquarium" || t.tourism === "theme_park") w = 2.5;
  else if (t.leisure === "park" || t.leisure === "garden" || t.leisure === "nature_reserve") w = t.wikidata ? 2.5 : 1;
  else if (t.amenity === "theatre" || t.amenity === "arts_centre" || t.amenity === "music_venue") w = 2;
  else if (t.historic) w = t.wikidata ? 1.5 : 0;
  else if (t.shop === "department_store") w = 1.5;
  else if (t.amenity === "pub" && t.wikidata) w = 1;
  else return 0;
  return w + (t.wikidata ? 0.5 : 0);
};

let pois = new Map(); // station id → { counts, notable: [{name, weight}], river }
const previous = existsSync("data/stations.json") ? JSON.parse(await readFile("data/stations.json", "utf8")) : [];
if (NO_OSM) {
  for (const p of previous) pois.set(p.id, { counts: p.pois, notable: [], river: false, draft: p.draft ?? "" });
} else {
  const RADIUS = 400;
  const BATCH = 30;
  const targets = [...stations.values()].filter((s) => s.candidate);
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const key = `overpass/${batch.map((s) => s.id.slice(-3)).join("")}`;
    const around = (filter) => batch.map((s) => `nwr(around:${RADIUS},${s.lat},${s.lon})${filter};`).join("\n");
    const q = `[out:json][timeout:120];
(
${around('[amenity~"^(pub|bar|nightclub|restaurant|cafe|theatre|cinema|arts_centre|music_venue|marketplace)$"]')}
${around('[tourism~"^(museum|gallery|attraction|artwork|viewpoint|zoo|aquarium|theme_park)$"]')}
${around('[leisure~"^(park|garden|nature_reserve)$"][name]')}
${around("[historic][name]")}
${around('[shop~"^(mall|department_store)$"]')}
${around('[waterway=river][name="River Thames"]')}
);
out center tags;`;
    const data = await cached(key, async () => {
      for (let attempt = 0; ; attempt++) {
        console.log(`  Overpass batch ${i / BATCH + 1}/${Math.ceil(targets.length / BATCH)}`);
        const res = await fetch(OVERPASS, { method: "POST", body: `data=${encodeURIComponent(q)}`, headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA } });
        if (res.ok) {
          await sleep(5000);
          return res.json();
        }
        if (attempt >= 4) throw new Error(`Overpass ${res.status}`);
        console.warn(`  Overpass ${res.status}, backing off 30 s`);
        await sleep(30000);
      }
    });
    for (const s of batch) pois.set(s.id, { counts: Object.fromEntries(Object.keys(CATS).map((c) => [c, 0])), notable: new Map(), river: false });
    for (const el of data.elements ?? []) {
      const t = el.tags ?? {};
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null) continue;
      for (const s of batch) {
        const d = km(s, { lat, lon }) * 1000;
        if (d > RADIUS) continue;
        const p = pois.get(s.id);
        if (t.waterway === "river") {
          p.river = true;
          continue;
        }
        for (const [c, test] of Object.entries(CATS)) if (test(t)) p.counts[c]++;
        const nw = notableWeight(t);
        if (nw > 0) {
          const w = nw + (RADIUS - d) / RADIUS;
          const prev = p.notable.get(t.name) ?? 0;
          p.notable.set(t.name, Math.max(prev, w));
        }
      }
    }
    for (const s of batch) {
      const p = pois.get(s.id);
      p.notable = [...p.notable.entries()].sort((x, y) => y[1] - x[1]).map(([name]) => name);
    }
  }
}

/** A one-line draft hook: the three most notable named places, then what kind of area it is. */
function draftHook(s, p) {
  if (!p) return "";
  const parts = [];
  const names = (p.notable ?? []).slice(0, 3).filter((n) => n.toLowerCase() !== s.name.toLowerCase());
  if (names.length) parts.push(names.join(", "));
  const c = p.counts ?? {};
  const kinds = [];
  if (c.bars >= 8) kinds.push("late-night bars");
  if (c.pubs >= 10) kinds.push("lots of pubs");
  else if (c.pubs >= 4) kinds.push("pubs");
  if (c.restaurants >= 40) kinds.push("packed with restaurants");
  else if (c.restaurants >= 12) kinds.push("restaurants");
  if (c.culture >= 8) kinds.push("theatres and galleries");
  if (c.parks >= 2 && c.pubs < 10) kinds.push("green");
  if (c.markets >= 1) kinds.push("market");
  if (p.river) kinds.push("riverside");
  if (!kinds.length) kinds.push(Object.values(c).reduce((a, b) => a + b, 0) < 5 ? "quiet, residential" : "local high street");
  kinds.splice(4);
  parts.push(kinds.join(", "));
  return parts.join("; ");
}

const overrides = existsSync("data/station-hooks.json") ? JSON.parse(await readFile("data/station-hooks.json", "utf8")) : {};

const out = [...stations.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((s) => {
    const p = pois.get(s.id);
    const draft = NO_OSM ? p?.draft ?? "" : draftHook(s, p);
    return {
      id: s.id,
      name: s.name,
      lines: [...s.lines].sort(),
      zone: s.zone,
      lat: s.lat,
      lon: s.lon,
      x: s.x,
      y: s.y,
      hub: s.hub,
      candidate: s.candidate,
      pois: p?.counts ?? null,
      draft,
      hook: overrides[s.id] ?? draft,
    };
  });

await mkdir("data", { recursive: true });
await writeFile("data/stations.json", JSON.stringify(out, null, 1));
await writeFile(
  "data/tube-graph.json",
  JSON.stringify({ lines, nodes: out.map((s) => s.id), edges: [...graphEdges, ...walks], interchangeMins: 5 }, null, 0),
);
console.log(`wrote data/stations.json (${out.length}) and data/tube-graph.json (${graphEdges.length + walks.length} edges)`);
console.log(`hooks: ${Object.keys(overrides).length} hand-written, ${out.filter((s) => s.candidate && !overrides[s.id]).length} drafted`);
