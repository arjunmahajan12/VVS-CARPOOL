// Small geometry helpers shared by the map-first screens (route slicing for
// the "travelled" layer, densifying OSRM polylines for the demo driver, …).
export type LatLng = [number, number];

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Compass bearing (° clockwise from north) from a to b. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const y = Math.sin(r(b[1] - a[1])) * Math.cos(r(b[0]));
  const x = Math.cos(r(a[0])) * Math.sin(r(b[0])) - Math.sin(r(a[0])) * Math.cos(r(b[0])) * Math.cos(r(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Index of the polyline vertex nearest to a point (and its distance in km). */
export function nearestIndex(path: LatLng[], lat: number, lng: number): { index: number; km: number } {
  let bi = -1, bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineKm(path[i][0], path[i][1], lat, lng);
    if (d < bd) { bd = d; bi = i; }
  }
  return { index: bi, km: bd };
}

/** Closest point on segment a→b to p (equirectangular, fine at city scale). */
function projectOnSegment(a: LatLng, b: LatLng, p: { lat: number; lng: number }): { pt: LatLng; km: number } {
  const kx = Math.cos((p.lat * Math.PI) / 180);
  const ax = a[1] * kx, ay = a[0], bx = b[1] * kx, by = b[0], px = p.lng * kx, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  const pt: LatLng = [ay + dy * t, (ax + dx * t) / kx];
  return { pt, km: haversineKm(pt[0], pt[1], p.lat, p.lng) };
}

/**
 * Split a planned route at the car: `travelled` is the part behind the car
 * (drawn muted), `ahead` the part still to drive. The car is projected onto
 * the nearest segment, so sparse (straight-line fallback) routes work too.
 * When the car is more than ~250 m off the line we don't guess — everything
 * stays "ahead".
 */
export function splitRouteAtCar(route: LatLng[] | null | undefined, car: { lat: number; lng: number } | null | undefined): { travelled: LatLng[]; ahead: LatLng[] } {
  if (!route || route.length < 2 || !car) return { travelled: [], ahead: route ?? [] };
  let bi = -1, bd = Infinity, bp: LatLng = route[0];
  for (let i = 0; i < route.length - 1; i++) {
    const { pt, km } = projectOnSegment(route[i], route[i + 1], car);
    if (km < bd) { bd = km; bi = i; bp = pt; }
  }
  if (bi < 0 || bd > 0.25) return { travelled: [], ahead: route };
  return { travelled: [...route.slice(0, bi + 1), bp], ahead: [bp, ...route.slice(bi + 1)] };
}

/** Densify a polyline so consecutive points are ≤ `stepM` metres apart. */
export function densify(path: LatLng[], stepM = 60): LatLng[] {
  if (path.length < 2) return [...path];
  const out: LatLng[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const d = haversineKm(a[0], a[1], b[0], b[1]) * 1000;
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let s = 0; s < n; s++) { const t = s / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Length of a polyline in km. */
export function pathKm(path: LatLng[]): number {
  let km = 0;
  for (let i = 0; i < path.length - 1; i++) km += haversineKm(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
  return km;
}

/** Position along a polyline at fraction t ∈ [0,1] (by vertex count — fine for dense paths). */
export function pointAt(path: LatLng[], t: number): LatLng | null {
  if (!path.length) return null;
  const f = Math.min(1, Math.max(0, t)) * (path.length - 1);
  const i = Math.floor(f), frac = f - i;
  const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
}
