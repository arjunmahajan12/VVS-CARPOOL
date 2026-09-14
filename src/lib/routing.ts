// Real road routing so the drawn route and the moving car follow actual streets
// (not straight lines). Order of preference:
//   1) OpenRouteService if VITE_ORS_KEY is set (best quality / production).
//   2) The public OSRM server — keyless, real road geometry (great for a pilot).
//   3) Straight-line great-circle fallback if both are unreachable/offline.
import { optimizeRoute, haversineKm, type Stop } from "./optimize";
import type { School } from "./types";

const ORS_KEY = import.meta.env.VITE_ORS_KEY as string | undefined;

export interface RouteResult {
  geometry: [number, number][]; // [lat,lng] points to draw on the map
  distanceKm: number;
  durationMin: number;
  order: Stop[];                // optimised pickup order
  road: boolean;                // true if it's a real road route
}

// fetch with a timeout so a slow router falls back instead of hanging.
async function fetchT(url: string, opts: any = {}, ms = 9000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// Order the pickups (least-detour), then fetch the real road route through
// origin → ordered stops → school. Falls back to straight lines on any failure.
export async function getRoute(stops: Stop[], school: School, keepOrder = false, schoolFirst = false): Promise<RouteResult> {
  // keepOrder=true trusts the caller's sequence (e.g. a ride's pickup order).
  // schoolFirst=true is for FROM-SCHOOL trips: the drive starts at the gate.
  const order = keepOrder ? [...stops] : optimizeRoute(stops, school).order;
  const homes = order.map((s) => [s.lat, s.lng] as [number, number]);
  const seq: [number, number][] = schoolFirst
    ? [[school.lat, school.lng], ...homes]
    : [...homes, [school.lat, school.lng]];

  if (ORS_KEY && seq.length >= 2) {
    try {
      const body = { coordinates: seq.map(([lat, lng]) => [lng, lat]) }; // ORS uses [lng,lat]
      const res = await fetchT("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
        method: "POST",
        headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        const f = data.features?.[0];
        if (f?.geometry?.coordinates) {
          return {
            geometry: f.geometry.coordinates.map(([lng, lat]: number[]) => [lat, lng] as [number, number]),
            distanceKm: Math.round((f.properties.summary.distance / 1000) * 10) / 10,
            durationMin: Math.max(1, Math.round(f.properties.summary.duration / 60)),
            order, road: true,
          };
        }
      }
    } catch { /* fall through */ }
  }

  // Keyless road routing via the public OSRM server — real street geometry.
  if (seq.length >= 2) {
    try {
      const coords = seq.map(([lat, lng]) => `${lng},${lat}`).join(";");
      const res = await fetchT(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      if (res.ok) {
        const data = await res.json();
        const r = data.routes?.[0];
        if (r?.geometry?.coordinates?.length) {
          return {
            geometry: r.geometry.coordinates.map(([lng, lat]: number[]) => [lat, lng] as [number, number]),
            distanceKm: Math.round((r.distance / 1000) * 10) / 10,
            durationMin: Math.max(1, Math.round(r.duration / 60)),
            order, road: true,
          };
        }
      }
    } catch { /* fall through to straight-line */ }
  }

  // Fallback: straight segments + great-circle distance, ~25 km/h city speed.
  let km = 0;
  for (let i = 0; i < seq.length - 1; i++) km += haversineKm(seq[i][0], seq[i][1], seq[i + 1][0], seq[i + 1][1]);
  return { geometry: seq, distanceKm: Math.round(km * 10) / 10, durationMin: Math.max(1, Math.round((km / 25) * 60)), order, road: false };
}

export const ROUTING_LIVE = !!ORS_KEY;

// Real ROAD-distance matrix between points (km), via the keyless OSRM table
// service. Returns null on any failure — callers fall back to great-circle.
export async function roadMatrix(points: { lat: number; lng: number }[]): Promise<number[][] | null> {
  if (points.length < 2 || points.length > 12) return null;
  try {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const res = await fetchT(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`, {}, 7000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.distances)) return null;
    return data.distances.map((row: number[]) => row.map((m) => (m == null ? 1e9 : m / 1000)));
  } catch { return null; }
}
