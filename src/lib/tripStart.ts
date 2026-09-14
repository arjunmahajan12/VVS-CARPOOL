// One tap to start a trip — everything else is decided by two simple rules:
//   * DIRECTION is chosen by the organiser when starting: "To school" or
//     "To home" — two separate routes, never inferred from the clock or GPS.
//   * The ROUTE always collects the organising family first. School run:
//     driver's live position → the organiser's home → the other homes in
//     optimal road order → school. Home run: school first, then the drop
//     points in optimal order (the organiser's children simply end at home).
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


// Ordered stop list for a school run: the organiser's children first (their
// home anchors the route), then the other homes optimally from there to school.
// For a home run: drops in optimal order leaving from the school gate.
export async function computeOrder(
  ownStops: Stop[],           // organiser-family children (at the organiser's home)
  otherStops: Stop[],         // everyone else's children
  school: School,
  anchorHome: { lat: number; lng: number } | null,
  direction: "to_school" | "from_school",
): Promise<string[]> {
  if (direction === "to_school") {
    const org = anchorHome ?? { lat: school.lat, lng: school.lng };
    const pts = otherStops.filter((s) => s.lat != null && s.lng != null);
    let rest: string[] = pts.map((s) => s.id);
    if (pts.length > 1) {
      const nodes = [org, ...pts, { lat: school.lat, lng: school.lng }];
      const matrix = await roadMatrix(nodes);
      rest = optimalOrder(pts, org, { lat: school.lat, lng: school.lng }, matrix).map((s) => s.id);
    }
    return [...ownStops.map((s) => s.id), ...rest];
  }
  // home run: school → other drops optimal (organiser's kids end at home — not routed)
  const pts = otherStops.filter((s) => s.lat != null && s.lng != null);
  if (pts.length <= 1) return pts.map((s) => s.id);
  const org = { lat: school.lat, lng: school.lng };
  const nodes = [org, ...pts];
  const matrix = await roadMatrix(nodes);
  return optimalOrder(pts, org, null, matrix).map((s) => s.id);
}

// One call that does everything: the chosen direction, organiser-first optimal
// order, driver's real origin, start.
export async function startTripSmart(opts: {
  carpoolId: string;
  driverUserId: string;
  creatorFamilyId: string;   // the organising household — the anchor of every route
  riders: { child_id: string; parent_id: string; home_lat?: number | null; home_lng?: number | null; absent?: boolean }[];
  school: School;
  creatorHome: { lat: number; lng: number } | null;
  direction: "to_school" | "from_school";
}) {
  const direction = opts.direction;
  const pos = await currentPosition();
  const origin = pos ?? (direction === "to_school" ? opts.creatorHome : { lat: opts.school.lat, lng: opts.school.lng });
  const active = opts.riders.filter((r) => !r.absent && r.home_lat != null);
  const own = active.filter((r) => r.parent_id === opts.creatorFamilyId)
    .map((r) => ({ id: r.child_id, name: "", lat: r.home_lat!, lng: r.home_lng! }));
  const others = active.filter((r) => r.parent_id !== opts.creatorFamilyId)
    .map((r) => ({ id: r.child_id, name: "", lat: r.home_lat!, lng: r.home_lng! }));
  let order: string[] | null = null;
  try { order = await computeOrder(own, others, opts.school, opts.creatorHome, direction); } catch { order = null; }
  return api.startRide(opts.carpoolId, opts.driverUserId, order, direction, origin?.lat ?? null, origin?.lng ?? null);
}
