// One tap to start a trip — everything else is decided by two simple rules:
//   * DIRECTION is chosen by a joined member when starting: "To school" or
//     "To home" — two separate routes, never inferred from the clock or GPS.
//   * School-run pickup order is optimized from the starter's home; live GPS
//     still begins at the driver's current position. Home runs start at school,
//     order the other drops, and finish at the organiser's home.
// Boarding is never assumed: every child checks in by STOP-DETECTION when the
// car genuinely pulls over at their point (see postLocation on the backends).
import { api } from "./api";
import { optimalOrder, type Stop } from "./optimize";
import { roadMatrix } from "./routing";
import type { School } from "./types";

export function currentPosition(timeoutMs = 4000): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => { if (!done) { done = true; clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); } },
      () => { if (!done) { done = true; resolve(null); } },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}


// Order every school-run pickup from the starter's home to the school.
// Home-run drops start at school and include the organiser's home as the end.
export async function computeOrder(
  ownStops: Stop[],           // organiser-family children (at the organiser's home)
  otherStops: Stop[],         // everyone else's children
  school: School,
  anchorHome: { lat: number; lng: number } | null,
  direction: "to_school" | "from_school",
  startPosition: { lat: number; lng: number } | null,
): Promise<string[]> {
  if (direction === "to_school") {
    const pts = [...ownStops, ...otherStops].filter((s) => s.lat != null && s.lng != null);
    if (pts.length <= 1) return pts.map((s) => s.id);
    const origin = startPosition ?? anchorHome ?? { lat: school.lat, lng: school.lng };
    const end = { lat: school.lat, lng: school.lng };
    const matrix = await roadMatrix([origin, ...pts, end]);
    return optimalOrder(pts, origin, end, matrix).map((s) => s.id);
  }
  // The organiser's household is represented by the fixed home_end stop.
  const pts = otherStops.filter((s) => s.lat != null && s.lng != null);
  if (pts.length <= 1) return pts.map((s) => s.id);
  const origin = { lat: school.lat, lng: school.lng };
  const nodes = [origin, ...pts, ...(anchorHome ? [anchorHome] : [])];
  const matrix = await roadMatrix(nodes);
  return optimalOrder(pts, origin, anchorHome, matrix).map((s) => s.id);
}

// One call that does everything: chosen direction, starter-based route order,
// and the correct route origin.
export async function startTripSmart(opts: {
  carpoolId: string;
  driverUserId: string;
  creatorFamilyId: string;   // the organising household — the home-run endpoint
  starterHome: { lat: number; lng: number } | null;
  riders: { child_id: string; parent_id: string; home_lat?: number | null; home_lng?: number | null; absent?: boolean }[];
  school: School;
  creatorHome: { lat: number; lng: number } | null;
  direction: "to_school" | "from_school";
}) {
  const direction = opts.direction;
  const pos = direction === "to_school" ? await currentPosition() : null;
  const schoolGate = { lat: opts.school.lat, lng: opts.school.lng };
  const origin = direction === "to_school" ? pos ?? opts.starterHome ?? opts.creatorHome ?? schoolGate : schoolGate;
  const orderOrigin = direction === "to_school" ? opts.starterHome ?? pos ?? origin : origin;
  const active = opts.riders.filter((r) => !r.absent && r.home_lat != null && r.home_lng != null);
  const own = active.filter((r) => r.parent_id === opts.creatorFamilyId)
    .map((r) => ({ id: r.child_id, name: "", lat: r.home_lat!, lng: r.home_lng! }));
  const others = active.filter((r) => r.parent_id !== opts.creatorFamilyId)
    .map((r) => ({ id: r.child_id, name: "", lat: r.home_lat!, lng: r.home_lng! }));
  const order = await computeOrder(own, others, opts.school, opts.creatorHome, direction, orderOrigin);
  return api.startRide(opts.carpoolId, opts.driverUserId, order, direction, origin?.lat ?? null, origin?.lng ?? null);
}
