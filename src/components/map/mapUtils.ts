// Provider-agnostic helpers: Web-Mercator maths, grid clustering, bounds and
// the "should we re-fit?" signature. Pure functions, easy to test.
import { num, type MapPin, type MapProps, type MapStop } from "./mapTypes";

export type LatLng = { lat: number; lng: number };

// ---- Web Mercator (world size 256 * 2^zoom px)
export function projectPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * Math.pow(2, zoom);
  const s = Math.sin((Math.min(85.05, Math.max(-85.05, lat)) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}
export function unprojectPx(x: number, y: number, zoom: number): LatLng {
  const scale = 256 * Math.pow(2, zoom);
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

// ---- bounds
export interface Bounds { south: number; west: number; north: number; east: number }
export function boundsOf(points: LatLng[]): Bounds | null {
  const pts = points.filter((p) => num(p.lat) && num(p.lng));
  if (!pts.length) return null;
  let south = 90, north = -90, west = 180, east = -180;
  for (const p of pts) {
    if (p.lat < south) south = p.lat; if (p.lat > north) north = p.lat;
    if (p.lng < west) west = p.lng; if (p.lng > east) east = p.lng;
  }
  return { south, west, north, east };
}
// Grow a bounds by a radius in km (for the discovery ring).
export function padBoundsKm(b: Bounds, km: number): Bounds {
  const dLat = km / 111, dLng = km / (111 * Math.cos((((b.south + b.north) / 2) * Math.PI) / 180) || 1);
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLng, east: b.east + dLng };
}
// Centre + zoom that shows `b` inside a container, clear of the paddings.
export function fitView(
  b: Bounds, widthPx: number, heightPx: number,
  pad: { top: number; bottom: number; left: number; right: number },
  maxZoom = 16, minZoom = 3,
): { center: LatLng; zoom: number } {
  const availW = Math.max(40, widthPx - pad.left - pad.right);
  const availH = Math.max(40, heightPx - pad.top - pad.bottom);
  const a = projectPx(b.north, b.west, 0), c = projectPx(b.south, b.east, 0);
  const dx = Math.max(1e-9, c.x - a.x), dy = Math.max(1e-9, c.y - a.y);
  let zoom = Math.floor(Math.log2(Math.min(availW / dx, availH / dy)));
  zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
  // centre of the bounds, then shift so it sits in the middle of the *unpadded* area
  const mid = projectPx((b.north + b.south) / 2, (b.west + b.east) / 2, zoom);
  const shiftX = (pad.left - pad.right) / 2, shiftY = (pad.top - pad.bottom) / 2;
  const center = unprojectPx(mid.x - shiftX, mid.y - shiftY, zoom);
  return { center, zoom };
}

// ---- clustering (simple grid; only family pins that aren't selected)
export type PinCell =
  | { type: "pin"; pin: MapPin }
  | { type: "cluster"; id: string; lat: number; lng: number; count: number; ids: string[] };
export const CLUSTER_MAX_ZOOM = 15.5; // above this everything is a plain pin
export function clusterPins(pins: MapPin[], zoom: number, enabled: boolean, cellPx = 64): PinCell[] {
  const out: PinCell[] = [];
  const cells = new Map<string, MapPin[]>();
  for (const p of pins) {
    if (!num(p.lat) || !num(p.lng)) continue;
    if (!enabled || zoom > CLUSTER_MAX_ZOOM || p.kind !== "family" || p.selected) { out.push({ type: "pin", pin: p }); continue; }
    const { x, y } = projectPx(p.lat, p.lng, zoom);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const arr = cells.get(key); if (arr) arr.push(p); else cells.set(key, [p]);
  }
  for (const [key, arr] of cells) {
    if (arr.length === 1) { out.push({ type: "pin", pin: arr[0] }); continue; }
    const lat = arr.reduce((s, p) => s + p.lat, 0) / arr.length, lng = arr.reduce((s, p) => s + p.lng, 0) / arr.length;
    out.push({ type: "cluster", id: `cluster:${key}`, lat, lng, count: arr.length, ids: arr.map((p) => p.id) });
  }
  return out;
}

// ---- what to frame, and when
export function framePoints(p: Pick<MapProps, "stops" | "pins" | "route" | "radius" | "car">): { points: LatLng[]; padKm: number } {
  const points: LatLng[] = [];
  for (const s of p.stops || []) if (num(s.lat) && num(s.lng)) points.push({ lat: s.lat, lng: s.lng });
  for (const s of p.pins || []) if (num(s.lat) && num(s.lng)) points.push({ lat: s.lat, lng: s.lng });
  if (!points.length && p.route) for (const r of p.route) if (Array.isArray(r) && num(r[0]) && num(r[1])) points.push({ lat: r[0], lng: r[1] });
  let padKm = 0;
  if (p.radius && num(p.radius.lat) && num(p.radius.lng) && num(p.radius.km)) {
    if (!points.length) { points.push({ lat: p.radius.lat, lng: p.radius.lng }); padKm = p.radius.km; }
  }
  if (p.car && num(p.car.lat) && num(p.car.lng) && points.length) points.push({ lat: p.car.lat, lng: p.car.lng });
  return { points, padKm };
}
// Signature of the framed SET (ids only, so status flips / selection don't refit).
export function frameSignature(p: Pick<MapProps, "stops" | "pins" | "route" | "radius">): string {
  const s = (p.stops || []).map((x) => x.id).sort().join(",");
  const q = (p.pins || []).map((x) => x.id).sort().join(",");
  const r = p.route && p.route.length > 1 ? `r${p.route.length}` : "";
  const rad = p.radius ? `k${p.radius.km}` : "";
  return `${s}|${q}|${r}|${rad}`;
}

export const safePath = (path?: [number, number][] | null): LatLng[] =>
  (path || []).filter((p) => Array.isArray(p) && num(p[0]) && num(p[1])).map(([lat, lng]) => ({ lat, lng }));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
// Shortest-arc heading interpolation.
export function lerpHeading(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
export const stopById = (stops: MapStop[] | undefined, id: string) => (stops || []).find((s) => s.id === id);
