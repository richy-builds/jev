"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { animate, motion, useDragControls, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { SPRING } from "@/app/grid/ui";

export type SheetState = "peek" | "half" | "full";
const ORDER: SheetState[] = ["peek", "half", "full"];
/** The peek state shows the handle and the card's header; this is the floor until they are measured. */
const PEEK_MIN = 64;
/**
 * Snap heights. The sheet lives inside the map container, which on a phone is ~560 px
 * of an 844 px screen (header, people, the text field, chips and the telemetry take
 * the rest), so 90 dvh would cover the text field: full is the whole container (the
 * banner goes under it), half is 50 dvh capped so a strip of map stays visible, peek is
 * the measured head.
 */
const FULL_INSET = 0;
const HALF_DVH = 0.5;
const HALF_MAP_MIN = 72;
/** How far a fling is projected before choosing the nearest snap. */
const FLING_MS = 120;

/**
 * The phone's bottom sheet: the committed card (app/meet/result.tsx, `layout="sheet"`)
 * on a framer-motion `drag="y"` panel with three snap points. Peek shows the header
 * alone, the one-line answer; half the rows, the shortlist and the first venues; full
 * everything, scrolling inside. Absolutely positioned at the bottom of the map
 * container, so the map behind keeps its own pointer events and stays live. The drag
 * starts from the handle and the header only (`dragControls`), so the body scrolls
 * natively. The panel is always its full height and translated down; the inner
 * wrapper's height follows the visible part, so the body's scroll region is exactly
 * what is on screen in every state.
 */
export function Sheet({ initial = "half", to, onState, children }: { initial?: SheetState; to?: SheetState | null; onState?: (s: SheetState) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SheetState>(initial);
  // A snap asked for from outside (the recording script); drags still own the state between.
  useEffect(() => {
    if (to) setState(to);
  }, [to]);
  const [box, setBox] = useState({ h: 0, vh: 0, head: PEEK_MIN });
  const full = Math.max(0, box.h - FULL_INSET);
  const half = Math.min(Math.round(box.vh * HALF_DVH), Math.max(0, box.h - HALF_MAP_MIN));
  const peek = Math.max(PEEK_MIN, box.head);
  const snap = (s: SheetState) => (s === "full" ? 0 : s === "half" ? full - half : full - peek);

  const y = useMotionValue(0);
  const visible = useTransform(y, (v) => Math.max(peek, full - v));
  const controls = useDragControls();
  const dragged = useRef(false);

  // The container's height (the map's) and the head's (handle + the card's header, the peek height).
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const head = el.querySelector<HTMLElement>("[data-sheet-head]");
    const handle = el.querySelector<HTMLElement>("[data-sheet-handle]");
    const ro = new ResizeObserver(() => {
      setBox({ h: parent.clientHeight, vh: window.innerHeight, head: (handle?.offsetHeight ?? 0) + (head?.offsetHeight ?? 0) });
    });
    ro.observe(parent);
    if (head) ro.observe(head);
    return () => ro.disconnect();
  }, []);

  // Slide in from below once measured, then follow the state (and the container as it resizes).
  const entered = useRef(false);
  useEffect(() => {
    if (!box.h) return;
    if (!entered.current) {
      entered.current = true;
      y.set(full);
    }
    const ctrl = animate(y, snap(state), SPRING);
    return () => ctrl.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, full, half, peek, box.h]);
  useEffect(() => onState?.(state), [state, onState]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const at = y.get() + info.velocity.y * (FLING_MS / 1000);
    const next = ORDER.reduce((a, b) => (Math.abs(snap(b) - at) < Math.abs(snap(a) - at) ? b : a));
    if (next === state) animate(y, snap(state), SPRING);
    else setState(next);
  };
  const cycle = () => setState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]);
  const onHeadPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // The map behind must not pan with the sheet; the body scrolls on its own.
    e.stopPropagation();
    if ((e.target as Element).closest("[data-sheet-scroll]")) return;
    dragged.current = false;
    controls.start(e);
  };

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label="Meeting point"
      className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl border border-b-0 border-[var(--line)] bg-[var(--panel)] text-[var(--text)] shadow-[0_-8px_30px_rgba(0,0,0,0.16)]"
      style={{ y, height: full || undefined, touchAction: "none" }}
      drag="y"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ top: 0, bottom: Math.max(0, full - peek) }}
      dragElastic={0.06}
      dragMomentum={false}
      onDrag={(_, info) => {
        if (Math.abs(info.offset.y) > 4) dragged.current = true;
      }}
      onDragEnd={onDragEnd}
      onPointerDown={onHeadPointerDown}
      onClick={(e) => {
        // A tap on the header text (not its buttons) toggles peek and half, as the handle cycles.
        const t = e.target as Element;
        if (!dragged.current && t.closest("[data-sheet-head]") && !t.closest("button")) setState(state === "peek" ? "half" : "peek");
      }}
      exit={{ y: full }}
      transition={SPRING}
      data-sheet-state={state}
    >
      <motion.div className="flex min-h-0 flex-col" style={{ height: visible }}>
        <button
          type="button"
          data-sheet-handle
          aria-label={state === "full" ? "Collapse" : "Expand"}
          onClick={() => {
            if (!dragged.current) cycle();
          }}
          className="flex w-full shrink-0 justify-center pt-2.5 pb-2"
        >
          <span className="h-1.5 w-10 rounded-full bg-[var(--line)]" />
        </button>
        {children}
      </motion.div>
    </motion.div>
  );
}
