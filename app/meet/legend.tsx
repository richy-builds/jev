"use client";

import { STATION_BY_ID, type Origin } from "@/lib/stations";
import { shortName } from "@/lib/use-tube-graph";

/**
 * The map's key: who is who, what the filled dot and the dashed ring mean, and the
 * checkbox that shades where everyone can be within the budget. Bottom-left from `md`
 * up; on phones top-left under the status banner, where the sheet never reaches
 * (client.tsx places it). Not in the recording layout.
 */
export function Legend({ origins, budget, region, onRegion, compact = false }: { origins: Origin[]; budget: number; region: boolean; onRegion: (on: boolean) => void; compact?: boolean }) {
  if (!origins.length) return null;
  if (compact)
    // Phones: one wrapping row, so the key takes two lines of a small map rather than a column of it.
    return (
      <div className="pointer-events-auto flex w-fit flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--line)] bg-[var(--panel)]/92 px-2 py-1 text-[10px] text-[var(--muted)] shadow backdrop-blur" aria-label="Map key">
        {origins.map((o, i) => (
          <span key={o.id} className="flex items-center gap-1">
            <span className="mono grid h-3 w-3 place-items-center rounded-full bg-[var(--accent-2)] text-[8px] font-bold text-[var(--on-accent)]">{i + 1}</span>
            <span className="text-[var(--text)]">{shortName(o.label ?? STATION_BY_ID[o.id]?.name ?? o.id)}</span>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full bg-[var(--good)]" />
          meeting point
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full border-[1.5px] border-dashed border-[var(--text)]/80" />
          change
        </span>
        <label className="flex cursor-pointer items-center gap-1">
          <input type="checkbox" checked={region} onChange={(e) => onRegion(e.target.checked)} className="h-3 w-3 accent-[var(--accent)]" />
          within {budget} min
        </label>
      </div>
    );
  return (
    <div className="pointer-events-auto flex w-fit flex-col gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--panel)]/92 px-3 py-2.5 text-[11px] text-[var(--muted)] shadow-lg backdrop-blur" aria-label="Map key">
      {origins.map((o, i) => (
        <div key={o.id} className="flex items-center gap-2">
          <span className="mono grid h-3.5 w-3.5 place-items-center rounded-full bg-[var(--accent-2)] text-[9px] font-bold text-[var(--on-accent)]">{i + 1}</span>
          <span className="text-[var(--text)]">{shortName(o.label ?? STATION_BY_ID[o.id]?.name ?? o.id)}</span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-full bg-[var(--good)]" />
        <span>
          meeting point · <span className="mono">a / b</span> min
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-[var(--text)]/80" />
        <span>change, with minutes</span>
      </div>
      <label className="mt-0.5 flex cursor-pointer items-center gap-2 border-t border-[var(--line)] pt-1.5">
        <input type="checkbox" checked={region} onChange={(e) => onRegion(e.target.checked)} className="accent-[var(--accent)]" />
        <span>everyone within {budget} min</span>
      </label>
    </div>
  );
}
