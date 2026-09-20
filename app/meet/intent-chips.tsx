"use client";

import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "@/app/grid/ui";
import { THRESHOLDS } from "@/lib/meet-find";
import { STATION_BY_ID, type MeetFindResponse } from "@/lib/stations";
import type { Anchor } from "@/lib/use-anchor";
import { EXISTS_FLOOR } from "@/lib/use-meet";
import { CUISINE_LABEL, KIND_LABEL } from "@/lib/venues";

type Chip = { key: string; text: string; tone: "good" | "muted" | "hot" | "warn" };

/**
 * What the finder understood from the description, read back under the input: the
 * travel budget, exclusions, the kind of place, the cuisine, and a "near X" anchor with
 * the station it resolved to. Nothing here changes the ranking; the chips only show the
 * answers the same call already returns, so a wrong reading is visible before Enter.
 */
export function IntentChips({ find, lit, query, statedBudget, anchor, big }: { find: MeetFindResponse | null; lit: boolean; query: string; statedBudget: number | null; anchor: Anchor | null; big: boolean }) {
  const chips: Chip[] = [];
  const typed = query.trim().length > 0;
  if (statedBudget !== null) chips.push({ key: "budget", text: `≤ ${statedBudget} min`, tone: "good" });
  if (find && lit) {
    // The rejected previous pick can also be a ranked exclusion, so the id appears twice; one chip.
    for (const id of new Set(find.excludedIds)) {
      const s = STATION_BY_ID[id];
      if (s) chips.push({ key: `not-${id}`, text: `not ${s.name}`, tone: "hot" });
    }
    if (find.venue.kind && find.venue.kindP >= THRESHOLDS.venue) chips.push({ key: "kind", text: KIND_LABEL[find.venue.kind] ?? find.venue.kind, tone: "good" });
    if (find.venue.cuisine && find.venue.cuisineP >= THRESHOLDS.venue) chips.push({ key: "cuisine", text: CUISINE_LABEL[find.venue.cuisine] ?? find.venue.cuisine, tone: "good" });
  }
  if (anchor) {
    const station = anchor.id ? STATION_BY_ID[anchor.id]?.name : null;
    chips.push({
      key: "near",
      text: anchor.pending ? `near ${anchor.text} · placing…` : station ? `near ${anchor.text} → ${station}` : `near ${anchor.text} · not placed`,
      tone: anchor.pending ? "muted" : station ? "good" : "warn",
    });
  }
  if (typed && find && !lit && find.exists < EXISTS_FLOOR) chips.push({ key: "nothing", text: "not a place yet", tone: "muted" });

  const tone = { good: "bg-[var(--good)]/15 text-[var(--good)]", muted: "bg-[var(--panel-2)] text-[var(--muted)]", hot: "bg-[var(--hot)]/15 text-[var(--hot)]", warn: "bg-[var(--warn)]/15 text-[var(--warn)]" };
  return (
    <div className={`flex min-h-[1.5rem] flex-wrap items-center gap-1.5 px-4 ${big ? "min-h-[2rem] pb-1 text-sm" : "pb-1 text-[11px]"}`} aria-label="Understood as">
      <AnimatePresence initial={false}>
        {chips.length > 0 && (
          <motion.span key="lead" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[var(--muted)]">
            understood as
          </motion.span>
        )}
        {chips.map((c) => (
          <motion.span
            key={c.key}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={SPRING}
            className={`rounded-md font-semibold ${big ? "px-2 py-0.5" : "px-1.5 py-px"} ${tone[c.tone]}`}
          >
            {c.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
