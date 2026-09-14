// Small display helpers shared by screens (times, IST clock, labels).
import type { Direction } from "./types";

const IST_OFFSET_MIN = 330;

/** Hour-of-day (0–23, fractional) in IST for a given instant. */
export function istHour(d: Date = new Date()): number {
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const ist = (utcMin + IST_OFFSET_MIN) % (24 * 60);
  return ist / 60;
}

/** SPEC §1.1 — before 11:00 IST a trip is a school run, from 11:00 a home run. */
export function directionNow(d: Date = new Date()): Direction {
  return istHour(d) < 11 ? "to_school" : "from_school";
}

export function directionLabel(dir: Direction | null | undefined): string {
  return dir === "from_school" ? "Home run" : "School run";
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { ...opts, timeZone: "Asia/Kolkata" });
}

/** "just now", "4 min ago", "2 h ago", "Yesterday", else a short date. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return fmtDate(iso);
}

/** Calendar-day key in IST (YYYY-MM-DD) for grouping. */
export function istDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or "Mon, 12 Sep". */
export function dayLabel(dayKey: string, now: Date = new Date()): string {
  const today = istDayKey(now.toISOString());
  const yest = istDayKey(new Date(now.getTime() - 86_400_000).toISOString());
  if (dayKey === today) return "Today";
  if (dayKey === yest) return "Yesterday";
  return fmtDate(dayKey + "T12:00:00Z", { weekday: "short", day: "numeric", month: "short" });
}

export function classLabel(n: number): string {
  return n >= 13 ? "Alumni" : `Class ${n}`;
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
}

export function greeting(d: Date = new Date()): string {
  const h = istHour(d);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
