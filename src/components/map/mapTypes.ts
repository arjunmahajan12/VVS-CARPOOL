// Map contract v2 — shared by the Mappls (live) and Leaflet (keyless demo)
// implementations so screens are provider-agnostic. See SPEC.md §5.
import type { StopStatus, StopKind } from "../../lib/types";

export interface MapStop {
  id: string; seq: number; lat: number; lng: number;
  kind: StopKind; status: StopStatus;
  label: string; sub?: string | null;
  etaMin?: number | null; isNext?: boolean;
}
export interface MapPin {
  id: string; lat: number; lng: number;
  kind: "school" | "home" | "family" | "carpool";
  label: string; sub?: string | null; selected?: boolean;
}
export interface MapFence { lat: number; lng: number; radiusM: number; tone: "stop" | "near" }

export interface MapProps {
  center: [number, number];
  zoom?: number;
  pins?: MapPin[];
  stops?: MapStop[];
  route?: [number, number][] | null;        // planned road geometry
  travelled?: [number, number][] | null;    // already driven — drawn muted
  car?: { lat: number; lng: number; heading?: number | null } | null;
  carEta?: number | null;                   // chip beside the car ("4 min")
  fences?: MapFence[];
  radius?: { lat: number; lng: number; km: number } | null;   // discovery ring
  corridor?: [number, number][] | null;     // "on your way" highlight
  follow?: boolean;
  traffic?: boolean;
  cluster?: boolean;
  padding?: { bottom?: number; top?: number }; // keep fit-bounds clear of the sheet
  onPinTap?: (id: string) => void;
  onStopTap?: (id: string) => void;
  onMapTap?: (lat: number, lng: number) => void;
  onReady?: () => void;
  className?: string;
}

export const VVS: [number, number] = [28.533246002067454, 77.14409813768475];
export const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Compass bearing (degrees clockwise from north) from a to b.
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toR = (x: number) => (x * Math.PI) / 180, toD = (x: number) => (x * 180) / Math.PI;
  const y = Math.sin(toR(b.lng - a.lng)) * Math.cos(toR(b.lat));
  const x = Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) - Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(toR(b.lng - a.lng));
  return (toD(Math.atan2(y, x)) + 360) % 360;
}
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Status → tone. Stop badges, the stop rail and the sheet all use the same map.
export const STOP_TONE: Record<StopStatus, { fill: string; text: string; ring: string; label: string }> = {
  pending:  { fill: "#64748B", text: "#FFFFFF", ring: "#CBD5E1", label: "Waiting" },
  arriving: { fill: "#F59E0B", text: "#FFFFFF", ring: "#FDE68A", label: "Arriving" },
  stopped:  { fill: "#F2A900", text: "#0B1220", ring: "#FFE08A", label: "Stopped" },
  done:     { fill: "#10B981", text: "#FFFFFF", ring: "#A7F3D0", label: "Done" },
  missed:   { fill: "#E11D48", text: "#FFFFFF", ring: "#FECDD3", label: "Missed" },
  skipped:  { fill: "#94A3B8", text: "#FFFFFF", ring: "#E2E8F0", label: "Absent" },
};
export const PIN_TONE: Record<MapPin["kind"], string> = {
  school: "#7F1D1D", home: "#F2A900", family: "#1F4B99", carpool: "#10B981",
};
