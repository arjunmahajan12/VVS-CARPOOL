// Draggable bottom sheet for map-first screens.
//
//   <div className="relative h-dvh">            ← the screen's full-bleed frame
//     <MapView … padding={{ bottom: inset }} />
//     <BottomSheet snapPoints={[0.18, 0.5, 0.92]} initial={1} onInsetChange={setInset}
//                  header={<SheetHeader title="Live trip" right={<Button/>} />}>
//       …content…
//     </BottomSheet>
//   </div>
//
// Snap points are fractions of the frame's height (the nearest positioned
// ancestor; falls back to the viewport). No backdrop — the map behind stays
// interactive. Content scrolls only at the top snap; below it the whole sheet
// drags. Velocity-based snapping, safe-area bottom padding, reduced-motion aware.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";

export interface BottomSheetProps {
  snapPoints?: number[];               // ascending fractions of the frame height, e.g. [0.18, 0.5, 0.92]
  initial?: number;                    // index into snapPoints
  snap?: number;                       // controlled: set to move the sheet to that index
  onSnap?: (index: number, heightPx: number) => void;
  onInsetChange?: (px: number) => void; // resting visible height — pass to MapView padding.bottom
  header?: ReactNode;                  // sticky, sits under the handle (SheetHeader fits here)
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}

const DEFAULT_SNAPS = [0.18, 0.5, 0.92];
const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";

export default function BottomSheet({
  snapPoints = DEFAULT_SNAPS, initial = 1, snap, onSnap, onInsetChange, header, children, className = "", contentClassName = "",
}: BottomSheetProps) {
  const snaps = useMemo(() => (snapPoints.length ? [...snapPoints].sort((a, b) => a - b) : DEFAULT_SNAPS), [snapPoints]);
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [frameH, setFrameH] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initial), snaps.length - 1));
  const [dragY, setDragY] = useState<number | null>(null);   // visible height while dragging
  const [animating, setAnimating] = useState(false);
  const drag = useRef<{ startY: number; startH: number; samples: { t: number; y: number }[]; active: boolean; decided: boolean; pointerId: number; inContent: boolean } | null>(null);
  const onSnapRef = useRef(onSnap); onSnapRef.current = onSnap;
  const onInsetRef = useRef(onInsetChange); onInsetRef.current = onInsetChange;

  const maxH = frameH * snaps[snaps.length - 1];
  const heights = snaps.map((f) => f * frameH);
  const restH = heights[index];
  const atTop = index === snaps.length - 1;
  const visibleH = dragY ?? restH;
  const atTopRef = useRef(atTop); atTopRef.current = atTop;
  const heightsRef = useRef(heights); heightsRef.current = heights;
  const maxHRef = useRef(maxH); maxHRef.current = maxH;

  // measure the frame (nearest positioned ancestor)
  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    const frame = (el.offsetParent as HTMLElement | null) || el.parentElement;
    const measure = () => setFrameH(frame?.clientHeight || window.innerHeight);
    measure();
    const ro = frame ? new ResizeObserver(measure) : null;
    if (frame && ro) ro.observe(frame);
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  // controlled snap
  useEffect(() => {
    if (snap == null) return;
    const i = Math.min(Math.max(0, snap), snaps.length - 1);
    if (i !== index) { setAnimating(true); setIndex(i); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  // report resting inset / snap
  useEffect(() => {
    onSnapRef.current?.(index, restH);
    onInsetRef.current?.(Math.round(restH));
  }, [index, restH]);

  // when leaving the top snap, reset the internal scroll so the next drag is clean
  useEffect(() => { if (!atTop && content.current) content.current.scrollTop = 0; }, [atTop]);

  const settle = useCallback((h: number, vy: number) => {
    // vy = pointer velocity in px/ms (down = +). Project the release point ~180 ms
    // ahead and pick the nearest snap; a flick always moves at least one snap.
    const projected = h - vy * 180;
    let best = 0, bestD = Infinity;
    heights.forEach((hh, i) => { const d = Math.abs(hh - projected); if (d < bestD) { bestD = d; best = i; } });
    if (Math.abs(vy) > 0.6) {
      if (vy < 0) best = Math.max(best, Math.min(heights.length - 1, index + 1));
      else best = Math.min(best, Math.max(0, index - 1));
    }
    setAnimating(true); setDragY(null);
    setIndex(best);
  }, [heights, index]);
  const settleRef = useRef(settle); settleRef.current = settle;

  // Press on the sheet → listen on the window until release, so a fast mouse
  // drag that leaves the sheet (or the frame) still drives it. Touch pointers
  // are implicitly captured by the browser; mouse ones are not.
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button != null && e.button !== 0) return;
    if (drag.current) return;
    const inContent = !!content.current?.contains(e.target as Node);
    const d = { startY: e.clientY, startH: visibleH, samples: [{ t: e.timeStamp, y: e.clientY }], active: false, decided: false, pointerId: e.pointerId, inContent };
    drag.current = d;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      const dy = ev.clientY - d.startY;
      if (!d.decided) {
        if (Math.abs(dy) < 4) return;
        d.decided = true;
        const c = content.current;
        // At the top snap the content owns the gesture unless it is scrolled to the top and the user pulls down.
        if (d.inContent && atTopRef.current && c && !(c.scrollTop <= 0 && dy > 0)) { cleanup(); return; }
        d.active = true;
      }
      if (ev.cancelable) ev.preventDefault();
      d.samples.push({ t: ev.timeStamp, y: ev.clientY });
      if (d.samples.length > 6) d.samples.shift();
      const raw = d.startH - dy;
      const minH = heightsRef.current[0], top = maxHRef.current;
      // rubber-band beyond the ends
      const h = raw > top ? top + (raw - top) * 0.25 : raw < minH ? minH - (minH - raw) * 0.25 : raw;
      setAnimating(false); setDragY(h);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      cleanup();
      if (!d.active) return;
      const last = d.samples[d.samples.length - 1], first = d.samples.find((s) => last.t - s.t <= 120) || d.samples[0];
      const vy = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      settleRef.current(d.startH - (ev.clientY - d.startY), vy);
    };
    const cleanup = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // stop the page/browser from scrolling while the sheet is being dragged (non-passive)
  useEffect(() => {
    const el = root.current; if (!el) return;
    const h = (ev: TouchEvent) => { if (drag.current?.active) ev.preventDefault(); };
    el.addEventListener("touchmove", h, { passive: false });
    return () => el.removeEventListener("touchmove", h);
  }, []);
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const style: CSSProperties = {
    height: Math.round(maxH),
    transform: `translate3d(0, ${Math.round(maxH - visibleH)}px, 0)`,
    transition: dragY == null && animating && !reduce ? `transform 380ms ${SPRING}` : "none",
    background: "var(--color-card, #FFFFFF)",
    color: "var(--color-ink-900, #111A2E)",
    boxShadow: "0 -8px 40px -12px rgba(11,18,32,0.28), 0 -1px 0 rgba(11,18,32,0.06)",
    touchAction: "none",
  };

  return (
    <SheetCtx.Provider value={{ index, atTop, snaps, setIndex: (i) => { setAnimating(true); setIndex(Math.min(Math.max(0, i), snaps.length - 1)); } }}>
      <div
        ref={root}
        role="dialog"
        aria-label="Details"
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[28px] will-change-transform select-none ${className}`}
        style={style}
        onPointerDown={onPointerDown}
        onTransitionEnd={(e) => { if (e.target === root.current) setAnimating(false); }}
      >
        <div className="flex shrink-0 cursor-grab items-center justify-center pt-2.5 pb-1.5 active:cursor-grabbing" aria-hidden>
          <div className="h-1.5 w-10 rounded-full bg-slate-300/90 dark:bg-slate-600" />
        </div>
        {header && <div className="shrink-0 px-5">{header}</div>}
        <div
          ref={content}
          className={`min-h-0 flex-1 overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] ${atTop ? "overflow-y-auto" : "overflow-hidden"} ${contentClassName}`}
          style={{ touchAction: atTop ? "pan-y" : "none", WebkitOverflowScrolling: "touch" } as CSSProperties}
        >
          {children}
        </div>
      </div>
    </SheetCtx.Provider>
  );
}

// ---- context so nested content can nudge the sheet (e.g. expand on tap)
interface SheetCtxValue { index: number; atTop: boolean; snaps: number[]; setIndex: (i: number) => void }
const SheetCtx = createContext<SheetCtxValue | null>(null);
export function useSheet(): SheetCtxValue {
  return useContext(SheetCtx) || { index: 0, atTop: false, snaps: DEFAULT_SNAPS, setIndex: () => {} };
}

// ---- inset plumbing: `const sheet = useSheetInset(); <MapView padding={{ bottom: sheet.inset }} /> <BottomSheet {...sheet.bind} />`
export function useSheetInset(initialPx = 0) {
  const [inset, setInset] = useState(initialPx);
  const bind = useMemo(() => ({ onInsetChange: setInset }), []);
  return { inset, setInset, bind };
}

// ---- simple header slot: title (+sub) on the left, an action on the right
export function SheetHeader({ title, sub, right, className = "" }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start justify-between gap-3 pb-3 ${className}`}>
      <div className="min-w-0">
        <div className="truncate text-[17px] font-bold leading-tight" style={{ fontFamily: "var(--font-display, inherit)" }}>{title}</div>
        {sub && <div className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">{sub}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
