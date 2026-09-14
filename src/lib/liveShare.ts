// Driver location sharing that SURVIVES screen changes. The GPS watch (or the
// demo simulation) is owned at app level here, not inside the Track component,
// so the moment the driver opens chat or another tab, sharing keeps running
// until the trip ends, sharing is explicitly stopped, or the user signs out.
import { api } from "./api";

type Mode = "off" | "gps" | "sim";
interface State { rideId: string | null; mode: Mode; }
const state: State = { rideId: null, mode: "off" };

let geoWatch: number | null = null;
let heartbeat: number | null = null;   // re-posts the last fix while the car is stopped
let lastFix: { lat: number; lng: number } | null = null;
let simTimer: number | null = null;
const listeners = new Set<(s: State) => void>();
const notify = () => listeners.forEach((f) => { try { f({ ...state }); } catch { /* ignore */ } });

export function onShareChange(fn: (s: State) => void): () => void {
  listeners.add(fn); fn({ ...state });
  return () => { listeners.delete(fn); };
}
export const shareState = (): State => ({ ...state });

export function stopSharing() {
  if (geoWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(geoWatch);
  geoWatch = null;
  if (heartbeat != null) clearInterval(heartbeat);
  heartbeat = null; lastFix = null;
  if (simTimer != null) clearInterval(simTimer);
  simTimer = null;
  state.rideId = null; state.mode = "off";
  notify();
}

export function startGps(rideId: string, onError?: (msg: string) => void): boolean {
  if (!navigator.geolocation) { onError?.("Geolocation not available on this device"); return false; }
  stopSharing();
  state.rideId = rideId; state.mode = "gps"; notify();
  geoWatch = navigator.geolocation.watchPosition(
    (p) => {
      lastFix = { lat: p.coords.latitude, lng: p.coords.longitude };
      api.postLocation(rideId, p.coords.latitude, p.coords.longitude).catch(() => { /* transient */ });
    },
    (e) => { onError?.("GPS error: " + e.message); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
  );
  // watchPosition goes quiet while the car is parked, but stop-detection (the
  // thing that turns a pull-over into a check-in) needs pings DURING the stop —
  // so re-post the last fix every few seconds as a heartbeat.
  heartbeat = window.setInterval(() => {
    if (lastFix) api.postLocation(rideId, lastFix.lat, lastFix.lng).catch(() => { /* transient */ });
  }, 5000);
  return true;
}

// Demo/simulated drive along a path of [lat,lng] points.
export function startSim(rideId: string, path: [number, number][], onDone?: () => void) {
  stopSharing();
  if (!path.length) return;
  state.rideId = rideId; state.mode = "sim"; notify();
  let i = 0;
  simTimer = window.setInterval(() => {
    const p = path[i];
    if (p) api.postLocation(rideId, p[0], p[1]).catch(() => { /* transient */ });
    i++;
    if (i >= path.length) { stopSharing(); onDone?.(); }
  }, 450);
}

// Stop automatically if the ride we're sharing for is the one that ended.
export function stopIfRide(rideId: string) { if (state.rideId === rideId) stopSharing(); }

// GPS sharing starts AUTOMATICALLY when the trip driver opens their live trip —
// once per ride, so tapping "stop" isn't overridden by a re-render.
let autoStarted: string | null = null;
export function autoStartGps(rideId: string, onError?: (msg: string) => void) {
  if (autoStarted === rideId || state.rideId === rideId) return;
  autoStarted = rideId;
  startGps(rideId, onError);
}
