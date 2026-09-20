import type { Origin } from "@/lib/stations";

export type MeetParams = {
  origins: Origin[];
  q: string;
  /** Travel budget in minutes for the slowest person. */
  budget: number | null;
  pick: string | null;
  /** Line id whose disruption is simulated (recording); null for live status only. */
  disrupt: string | null;
};

export const DEFAULT_BUDGET = 40;

type SP = Record<string, string | string[] | undefined> | URLSearchParams;

const get = (sp: SP, k: string): string | null => {
  if (sp instanceof URLSearchParams) return sp.get(k);
  const v = sp[k];
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
};

/** Short naptans in the URL: 940GZZLUBXN → BXN. */
const shortId = (id: string) => id.replace(/^940GZZLU/, "");
const longId = (s: string) => (/^940G/.test(s) ? s : `940GZZLU${s}`);

export function decodeMeetParams(sp: SP): MeetParams {
  const o = get(sp, "o");
  const b = Number(get(sp, "b"));
  const pick = get(sp, "pick");
  return {
    origins: o ? o.split(",").filter(Boolean).slice(0, 5).map((s) => ({ id: longId(s) })) : [],
    q: (get(sp, "q") ?? "").slice(0, 200),
    budget: Number.isFinite(b) && b > 0 ? b : null,
    pick: pick ? longId(pick) : null,
    disrupt: get(sp, "disrupt"),
  };
}

export function encodeMeetParams(p: MeetParams, keep?: URLSearchParams): string {
  const sp = new URLSearchParams();
  // Recording params survive so a scripted page keeps its mode while it rewrites the URL.
  for (const k of ["demo", "script", "delay", "layout"]) {
    const v = keep?.get(k);
    if (v) sp.set(k, v);
  }
  if (p.origins.length) sp.set("o", p.origins.map((o) => shortId(o.id)).join(","));
  if (p.q) sp.set("q", p.q);
  if (p.budget) sp.set("b", String(p.budget));
  if (p.pick) sp.set("pick", shortId(p.pick));
  if (p.disrupt) sp.set("disrupt", p.disrupt);
  const s = sp.toString();
  return s ? `?${s}` : "";
}
