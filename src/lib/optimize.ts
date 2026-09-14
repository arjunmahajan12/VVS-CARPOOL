// Distance optimisation + pooling-efficiency math.
// Pure functions, backend-agnostic — used to power the app's USPs.
import type { School } from "./types";

export interface Stop { id: string; name: string; lat: number; lng: number; }

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// OPTIMAL stop ordering (exact, not greedy): brute-force over every permutation,
// minimising total distance with a FIXED origin (the driver's home) and a fixed
// end (the school gate for pickups; open-ended for drops, since the driver
// finishes at their own home anyway). n ≤ 8 stops → at most 40,320 permutations,
// instant. A distance matrix can be supplied (real road distances); falls back
// to great-circle.
export function optimalOrder(
  stops: Stop[],
  origin: { lat: number; lng: number },
  end: { lat: number; lng: number } | null,
  matrix?: number[][] | null, // [i][j] over [origin, ...stops, end?]
): Stop[] {
  const pts = stops.filter((s) => s.lat != null && s.lng != null);
  if (pts.length <= 1) return pts;
  const nodes = [origin, ...pts, ...(end ? [end] : [])];
  const D = (i: number, j: number) =>
    matrix?.[i]?.[j] ?? haversineKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);
  const n = pts.length;
  const idx = pts.map((_, i) => i + 1); // node indices of the stops
  let best: number[] = idx, bestCost = Infinity;
  if (n <= 8) {
    const perm = (arr: number[], cur: number[]) => {
      if (!arr.length) {
        let cost = 0, prev = 0;
        for (const k of cur) { cost += D(prev, k); prev = k; }
        if (end) cost += D(prev, nodes.length - 1);
        if (cost < bestCost) { bestCost = cost; best = [...cur]; }
        return;
      }
      for (let i = 0; i < arr.length; i++) perm(arr.slice(0, i).concat(arr.slice(i + 1)), [...cur, arr[i]]);
    };
    perm(idx, []);
  } else {
    // large pools: greedy from the origin, then keep it simple
    const rem = [...idx]; const ord: number[] = []; let prev = 0;
    while (rem.length) {
      let bi = 0, bd = Infinity;
      rem.forEach((k, i) => { const d = D(prev, k); if (d < bd) { bd = d; bi = i; } });
      prev = rem[bi]; ord.push(prev); rem.splice(bi, 1);
    }
    best = ord;
  }
  return best.map((k) => pts[k - 1]);
}

// Greedy nearest-neighbour pickup ordering that ends at the school.
// Starts from the stop farthest from school (so we sweep inward), then always
// hops to the nearest unvisited home, finishing at the school gate.
export function optimizeRoute(stops: Stop[], school: School): { order: Stop[]; legs: number[]; totalKm: number } {
  const pts = stops.filter((s) => s.lat != null && s.lng != null);
  if (pts.length === 0) return { order: [], legs: [], totalKm: 0 };
  const remaining = [...pts];
  remaining.sort((a, b) => haversineKm(b.lat, b.lng, school.lat, school.lng) - haversineKm(a.lat, a.lng, school.lat, school.lng));
  const order: Stop[] = [remaining.shift()!];
  while (remaining.length) {
    const cur = order[order.length - 1];
    let bi = 0, bd = Infinity;
    remaining.forEach((s, i) => { const d = haversineKm(cur.lat, cur.lng, s.lat, s.lng); if (d < bd) { bd = d; bi = i; } });
    order.push(remaining.splice(bi, 1)[0]);
  }
  const legs: number[] = [];
  for (let i = 0; i < order.length - 1; i++) legs.push(haversineKm(order[i].lat, order[i].lng, order[i + 1].lat, order[i + 1].lng));
  legs.push(haversineKm(order[order.length - 1].lat, order[order.length - 1].lng, school.lat, school.lng));
  const totalKm = legs.reduce((a, b) => a + b, 0);
  return { order, legs, totalKm };
}

// Approximate factors (typical values — treat as estimates, not exact).
export const CO2_KG_PER_KM = 0.14;   // ~140 g CO2 per km, average petrol car
export const COST_PER_KM = 12;       // ~₹12 per km (fuel + wear), India, approximate
export const SCHOOL_DAYS_PER_MONTH = 22;

export interface PoolStats {
  families: number; pooledKm: number; soloKm: number; savedKm: number; savedPct: number;
  carsOffRoad: number; co2SavedKg: number; costSaved: number;
  monthlyKmSaved: number; monthlyCo2Kg: number; monthlyCost: number;
}

// One optimised shared trip vs. everyone driving solo (one-way to school).
export function poolStats(stops: Stop[], school: School): PoolStats {
  const families = stops.length;
  const { totalKm: pooledKm } = optimizeRoute(stops, school);
  const soloKm = stops.reduce((sum, s) => sum + haversineKm(s.lat, s.lng, school.lat, school.lng), 0);
  const savedKm = Math.max(0, soloKm - pooledKm);
  const savedPct = soloKm > 0 ? Math.round((savedKm / soloKm) * 100) : 0;
  const daily = savedKm * 2;
  return {
    families, pooledKm, soloKm, savedKm, savedPct,
    carsOffRoad: Math.max(0, families - 1),
    co2SavedKg: savedKm * 2 * CO2_KG_PER_KM,
    costSaved: savedKm * 2 * COST_PER_KM,
    monthlyKmSaved: daily * SCHOOL_DAYS_PER_MONTH,
    monthlyCo2Kg: daily * CO2_KG_PER_KM * SCHOOL_DAYS_PER_MONTH,
    monthlyCost: daily * COST_PER_KM * SCHOOL_DAYS_PER_MONTH,
  };
}

export const km = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
