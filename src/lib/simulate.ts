// Demo driver: walks a ride's OSRM road geometry and posts GPS pings exactly
// like a phone in the car would — speed + heading on the move, and a genuine
// PULL-OVER at every stop (a burst of identical, zero-speed pings that lasts
// longer than the school's dwell rule) so stop-detection boards/drops children
// the real way. Owned at module level so it keeps running if the driver
// switches screens; stops itself when the backend reports the trip ended.
import { api } from "./api";
import { bearingDeg, densify, nearestIndex, type LatLng } from "./geo";

export interface SimState { rideId: string | null; running: boolean; step: number; total: number; }
const state: SimState = { rideId: null, running: false, step: 0, total: 0 };
const listeners = new Set<(s: SimState) => void>();
let timer: number | null = null;
let inflight = false;
const notify = () => listeners.forEach((f) => { try { f({ ...state }); } catch { /* ignore */ } });

export function onSimChange(fn: (s: SimState) => void): () => void {
  listeners.add(fn); fn({ ...state });
  return () => { listeners.delete(fn); };
}
export const simState = (): SimState => ({ ...state });

export function stopSimulation(): void {
  if (timer != null) window.clearInterval(timer);
  timer = null; inflight = false;
  state.rideId = null; state.running = false; state.step = 0; state.total = 0;
  notify();
}

export interface SimOptions {
  rideId: string;
  /** Road geometry in driving order (origin → … → final stop). */
  path: LatLng[];
  /** Every stop the car must pull over at (pickups/drops, the gate, the organiser's home). */
  stops: { lat: number; lng: number }[];
  /** School dwell rule in seconds — the pause lasts comfortably longer. */
  dwellS: number;
  tickMs?: number;
  /** Cruising speed reported while moving. */
  speedKmh?: number;
  onDone?: (reason: "ended" | "finished" | "error") => void;
  onError?: (message: string) => void;
}

/**
 * Build the ping plan: densified route (≤ 60 m steps → always "moving" for the
 * 30 m stationary rule), with N stationary pings spliced in at each stop.
 */
export function buildPlan(path: LatLng[], stops: { lat: number; lng: number }[], dwellS: number, tickMs: number): { lat: number; lng: number; speed: number; heading: number | null }[] {
  const dense = densify(path, 60);
  const pauseN = Math.ceil((dwellS * 1000) / tickMs) + 4;
  const pauseAt = new Map<number, number>(); // vertex index → pause pings
  for (const s of stops) {
    const { index, km } = nearestIndex(dense, s.lat, s.lng);
    if (index >= 0 && km < 0.3) pauseAt.set(index, pauseN);
  }
  const out: { lat: number; lng: number; speed: number; heading: number | null }[] = [];
  let heading: number | null = null;
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i];
    if (i > 0) heading = bearingDeg(dense[i - 1], p);
    const jitter = ((i * 7) % 5) - 2;
    out.push({ lat: p[0], lng: p[1], speed: 0, heading });
    const n = pauseAt.get(i);
    if (n) {
      // decelerate into the stop: the arriving ping already has speed 0 (above)
      for (let k = 0; k < n; k++) out.push({ lat: p[0], lng: p[1], speed: 0, heading });
    } else out[out.length - 1].speed = 28 + jitter;
  }
  if (out.length) out[out.length - 1].speed = 0;
  return out;
}

export function startSimulation(o: SimOptions): boolean {
  stopSimulation();
  const tickMs = o.tickMs ?? 700;
  const plan = buildPlan(o.path, o.stops, o.dwellS, tickMs);
  if (!plan.length) { o.onError?.("No route to simulate yet."); return false; }
  state.rideId = o.rideId; state.running = true; state.step = 0; state.total = plan.length; notify();
  let i = 0;
  const rideId = o.rideId;
  const finish = (reason: "ended" | "finished" | "error") => { if (state.rideId === rideId) { stopSimulation(); o.onDone?.(reason); } };
  timer = window.setInterval(async () => {
    if (inflight || state.rideId !== rideId) return;
    const p = plan[i];
    if (!p) { finish("finished"); return; }
    inflight = true;
    try {
      const r = await api.postLocation(rideId, p.lat, p.lng, p.speed, p.heading);
      i++; state.step = i; notify();
      if (r.ended) finish("ended");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Simulation stopped";
      // "already ended" is the normal way a simulation finishes after auto-end
      if (/ended/i.test(msg)) finish("ended");
      else { o.onError?.(msg); finish("error"); }
    } finally { inflight = false; }
  }, tickMs);
  return true;
}

/** Stop automatically if the ride we're simulating is the one that ended. */
export function stopIfRide(rideId: string): void { if (state.rideId === rideId) stopSimulation(); }
