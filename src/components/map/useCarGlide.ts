// Smooth car motion shared by both providers. Each new `car` prop becomes a
// ~900 ms rAF glide from wherever the puck currently is (even mid-glide) to the
// new point; heading follows the shortest arc, derived from movement when the
// ping carries none. `apply` is called every frame with the interpolated state.
import { useEffect, useRef } from "react";
import { bearing, haversineKm, num } from "./mapTypes";
import { easeOut, lerp, lerpHeading } from "./mapUtils";

export interface CarFrame { lat: number; lng: number; heading: number; moving: boolean }
type Car = { lat: number; lng: number; heading?: number | null } | null | undefined;

export function useCarGlide(
  car: Car,
  enabled: boolean,
  apply: (f: CarFrame, first: boolean) => void,
  onGone: () => void,
  durationMs = 900,
) {
  const cur = useRef<CarFrame | null>(null);
  const raf = useRef<number | null>(null);
  const applyRef = useRef(apply); applyRef.current = apply;
  const goneRef = useRef(onGone); goneRef.current = onGone;

  const lat = car && num(car.lat) ? car.lat : null;
  const lng = car && num(car.lng) ? car.lng : null;
  const hdg = car && num(car.heading) ? car.heading : null;

  useEffect(() => {
    if (!enabled) return;
    if (lat == null || lng == null) {
      if (raf.current) cancelAnimationFrame(raf.current); raf.current = null;
      cur.current = null; goneRef.current();
      return;
    }
    const target = { lat, lng };
    const from = cur.current;
    if (!from) {
      cur.current = { lat, lng, heading: hdg ?? 0, moving: false };
      applyRef.current(cur.current, true);
      return;
    }
    const movedKm = haversineKm(from, target);
    const targetHeading = hdg ?? (movedKm > 0.003 ? bearing(from, target) : from.heading);
    if (raf.current) cancelAnimationFrame(raf.current);
    const start = { ...from }, t0 = performance.now();
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce ? 0 : durationMs;
    const step = (now: number) => {
      const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = easeOut(t);
      const f: CarFrame = {
        lat: lerp(start.lat, target.lat, e), lng: lerp(start.lng, target.lng, e),
        heading: lerpHeading(start.heading, targetHeading, e), moving: movedKm > 0.003,
      };
      cur.current = f; applyRef.current(f, false);
      raf.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null; };
  }, [lat, lng, hdg, enabled, durationMs]);

  // reset when the map is torn down so a re-init starts fresh
  useEffect(() => { if (!enabled) cur.current = null; }, [enabled]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  return cur;
}
