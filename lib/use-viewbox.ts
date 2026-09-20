"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type ViewBox = { x: number; y: number; w: number; h: number };
/** How long a changed home box eases in once the map is on screen. */
const HOME_TWEEN_MS = 450;

/**
 * Pan and zoom for an SVG by rewriting its viewBox (so strokes and text stay crisp).
 * One pointer pans, two pinch about their midpoint, the wheel zooms about the cursor,
 * a double tap or double click resets. Hand-rolled: ~100 lines, no dependency.
 * `scale` is user units per CSS pixel: multiply a pixel size by it to keep text and
 * dots the same size on screen whatever the zoom or the device.
 */
export function useViewBox(svgRef: RefObject<SVGSVGElement | null>, home: ViewBox, opts: { minScale?: number; maxScale?: number } = {}) {
  const minW = home.w / (opts.maxScale ?? 8);
  const maxW = home.w * (opts.minScale ?? 1.4);
  const [vb, setVb] = useState<ViewBox>(home);
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);
  /** The SVG's CSS size, so callers can size text and dots in screen pixels and pick a home box for the container's shape. */
  const [size, setSize] = useState({ w: 0, h: 0 });

  // A new home replaces the current view: at once for the first (the container's shape
  // just became known), with a short ease when the view is already on screen (the map
  // zooming out to take in a new origin on a phone).
  const homed = useRef(false);
  useEffect(() => {
    const from = vbRef.current;
    if (!homed.current || typeof requestAnimationFrame === "undefined") {
      homed.current = true;
      vbRef.current = home;
      setVb(home);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / HOME_TWEEN_MS);
      const e = 1 - (1 - k) ** 3;
      const next = { x: from.x + (home.x - from.x) * e, y: from.y + (home.y - from.y) * e, w: from.w + (home.w - from.w) * e, h: from.h + (home.h - from.h) * e };
      vbRef.current = next;
      setVb(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [home]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [svgRef]);

  /** Client pixel → SVG user units, through the SVG's own CTM so letterboxing is handled. */
  const toSvg = useCallback(
    (cx: number, cy: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: cx, y: cy };
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: cx, y: cy };
      const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    },
    [svgRef],
  );

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const cur = vbRef.current;
      const p = toSvg(cx, cy);
      const w = Math.min(maxW, Math.max(minW, cur.w * factor));
      const k = w / cur.w;
      const next = { x: p.x - (p.x - cur.x) * k, y: p.y - (p.y - cur.y) * k, w, h: cur.h * k };
      vbRef.current = next;
      setVb(next);
    },
    [toSvg, minW, maxW],
  );

  const reset = useCallback(() => {
    vbRef.current = home;
    setVb(home);
  }, [home]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onDown = (e: PointerEvent) => {
      svg.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1 && e.pointerType === "touch") {
        const now = performance.now();
        if (now - lastTap.current < 300) reset();
        lastTap.current = now;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const cur = vbRef.current;
      const rect = svg.getBoundingClientRect();
      const unitsPerPx = cur.w / rect.width;
      if (pointers.current.size === 1) {
        const next = { ...cur, x: cur.x - (e.clientX - prev.x) * unitsPerPx, y: cur.y - (e.clientY - prev.y) * unitsPerPx };
        vbRef.current = next;
        setVb(next);
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.entries()];
        const other = a[0] === e.pointerId ? b[1] : a[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (d0 > 0 && d1 > 0) zoomAt(d0 / d1, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      }
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent) => pointers.current.delete(e.pointerId);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * 0.0022), e.clientX, e.clientY);
    };
    const onDbl = () => reset();
    const stop = (e: Event) => e.preventDefault();
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("dblclick", onDbl);
    // Safari's own pinch gesture on the page, which would otherwise zoom the whole document.
    svg.addEventListener("gesturestart", stop);
    svg.addEventListener("gesturechange", stop);
    return () => {
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("dblclick", onDbl);
      svg.removeEventListener("gesturestart", stop);
      svg.removeEventListener("gesturechange", stop);
    };
  }, [svgRef, zoomAt, reset]);

  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  // With preserveAspectRatio="meet" the box is letterboxed on the axis with room to spare,
  // so the units-per-pixel ratio is the larger of the two.
  const scale = size.w && size.h ? Math.max(vb.w / size.w, vb.h / size.h) : vb.w / home.w;
  return { vb, viewBox, scale, size, zoomAt, reset };
}
