// ONE map provider: Mappls. If the SDK can't load (or no key was configured at
// build time) MapplsMap shows an explicit error + retry — never another map.
import { mappls } from "mappls-web-maps";

/* eslint-disable @typescript-eslint/no-explicit-any */
const KEY = import.meta.env.VITE_MAPPLS_KEY as string | undefined;
export const HAS_MAPPLS = !!KEY;
export const LOAD_TIMEOUT_MS = 12000;

// One shared Mappls class object for the whole app (Map/Marker/Polyline live on it).
export const MAPPLS_CLASS: any = new mappls();

export function useMapProvider(): "mappls" { return "mappls"; }

export type MapplsLoadState = "idle" | "loading" | "ok" | "fail";
let state: MapplsLoadState = "idle";
let promise: Promise<boolean> | null = null;
export const mapplsLoadState = (): MapplsLoadState => state;

// The SDK's global, once loaded (window.mappls carries Map/Marker/search/…).
const sdkGlobal = (): any => (typeof window !== "undefined" ? (window as any).mappls : undefined);
const sdkReady = (): boolean => typeof sdkGlobal()?.Map === "function";

// Loads the Mappls Web SDK once (with the map + search plugins). Resolves true
// on success. A failed load can be retried (the promise is cleared) — MapplsMap
// bumps an attempt counter that calls this again. Times out at 12 s so the
// retry card always appears instead of an endless skeleton.
export function loadMappls(): Promise<boolean> {
  if (!KEY) return Promise.resolve(false);
  if (state === "ok" || sdkReady()) { state = "ok"; return Promise.resolve(true); }
  if (promise) return promise;
  state = "loading";
  promise = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return; settled = true;
      state = ok ? "ok" : "fail";
      if (!ok) promise = null; // allow a retry
      resolve(ok);
    };
    try {
      // plugins:true loads the whole plugin bundle (search + placedetails + …) — the
      // named list silently skips anything misspelt, and we need getPinDetails.
      MAPPLS_CLASS.initialize(KEY, { map: true, plugins: true }, () => done(sdkReady() || true));
      // Safety net: if the callback never fires (blocked CDN, bad key), fail so the retry card shows.
      setTimeout(() => done(state === "ok" || sdkReady()), LOAD_TIMEOUT_MS);
    } catch { done(false); }
  });
  return promise;
}

export interface MapplsSuggestion { placeName: string; placeAddress?: string; eLoc?: string; lat?: number; lng?: number; type?: string }

// Best-effort address autosuggest for the location picker. Returns [] if the
// SDK's search isn't available — the picker still works by tapping the map.
// SDK signature: mappls.search(query, options, callback) → { suggestedLocations }.
export async function mapplsAutosuggest(query: string, near?: { lat: number; lng: number }): Promise<MapplsSuggestion[]> {
  if (!query || query.trim().length < 3) return [];
  const ok = await loadMappls();
  if (!ok) return [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (list: MapplsSuggestion[]) => { if (!settled) { settled = true; resolve(list); } };
    try {
      const search = sdkGlobal()?.search;
      if (typeof search !== "function") return finish([]);
      const opts: Record<string, unknown> = { region: "IND" };
      if (near) opts.location = [near.lat, near.lng];
      const handle = (data: any) => {
        const raw = data?.suggestedLocations || data?.data?.suggestedLocations || (Array.isArray(data) ? data : []);
        const list: MapplsSuggestion[] = (Array.isArray(raw) ? raw : []).map((d: any) => ({
          placeName: d.placeName || d.name || query,
          placeAddress: d.placeAddress || d.address,
          eLoc: d.eLoc || d.mapplsPin,
          lat: toNum(d.latitude ?? d.lat),
          lng: toNum(d.longitude ?? d.lng),
          type: d.type,
        }));
        finish(list);
      };
      search(query.trim(), opts, handle);
      setTimeout(() => finish([]), 8000);
    } catch { finish([]); }
  });
}
const toNum = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

// Find the first latitude/longitude pair anywhere in a response object —
// Mappls returns them at different depths depending on the endpoint/version.
function findLatLng(node: any, depth = 0): { lat: number; lng: number } | null {
  if (!node || typeof node !== "object" || depth > 5) return null;
  const lat = toNum(node.latitude ?? node.lat), lng = toNum(node.longitude ?? node.lng ?? node.lon);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const r = findLatLng(v, depth + 1);
    if (r) return r;
  }
  return null;
}

// Resolve a Mappls eLoc code to coordinates (best-effort; null on failure).
export async function mapplsResolveEloc(eLoc: string): Promise<{ lat: number; lng: number } | null> {
  if (!eLoc) return null;
  const ok = await loadMappls();
  if (!ok) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { lat: number; lng: number } | null) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const gp = sdkGlobal()?.getPinDetails;
      if (typeof gp !== "function") return finish(null);
      gp({ pin: eLoc }, (data: any) => finish(findLatLng(data)));
      setTimeout(() => finish(null), 8000);
    } catch { finish(null); }
  });
}
