import type { ReactNode } from "react";
import { Check, X, Minus } from "lucide-react";
import { STOP_TONE } from "../map/mapTypes";
import type { StopStatus } from "../../lib/types";
import { cn } from "./cn";

export interface RailItem {
  id?: string;
  seq: number;
  label: ReactNode;
  sub?: ReactNode;
  status: StopStatus;
  /** Live ETA in minutes (pending/arriving stops). */
  etaMin?: number | null;
  /** done_at − planned_at, minutes; negative = early. */
  delayMin?: number | null;
  isNext?: boolean;
  /** Extra right-side node (e.g. a "Didn't board?" button). */
  trailing?: ReactNode;
}
export interface ProgressRailProps {
  items: RailItem[];
  onItemTap?: (item: RailItem, index: number) => void;
  /** Compact rows for the sheet's collapsed state. */
  dense?: boolean;
  className?: string;
}

export function formatEta(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  if (min < 1) return "now";
  return `~${Math.round(min)} min`;
}
export function formatDelay(min: number | null | undefined): { text: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  if (min == null || !Number.isFinite(min)) return { text: "", tone: "neutral" };
  const m = Math.round(min);
  if (m <= -1) return { text: `${Math.abs(m)} min early`, tone: "ok" };
  if (m <= 2) return { text: "on time", tone: "ok" };
  if (m <= 8) return { text: `+${m} min`, tone: "warn" };
  return { text: `+${m} min`, tone: "danger" };
}
const DELAY_CLS = { ok: "text-ok-ink", warn: "text-warn-ink", danger: "text-danger-ink", neutral: "text-ink-500" };
const isSettled = (s: StopStatus) => s === "done" || s === "skipped" || s === "missed";

function Marker({ status, seq, isNext }: { status: StopStatus; seq: number; isNext?: boolean }) {
  const t = STOP_TONE[status];
  const glyph =
    status === "done" ? <Check size={14} strokeWidth={3} aria-hidden /> :
    status === "missed" ? <X size={14} strokeWidth={3} aria-hidden /> :
    status === "skipped" ? <Minus size={14} strokeWidth={3} aria-hidden /> :
    <span className="tnum">{seq}</span>;
  const skipped = status === "skipped";
  const live = status === "stopped" || status === "arriving";
  return (
    <span
      aria-hidden
      className={cn("relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold", live && "anim-ring")}
      style={{
        background: skipped ? "transparent" : t.fill,
        color: skipped ? t.fill : t.text,
        border: skipped ? `2px dashed ${t.fill}` : undefined,
        boxShadow: isNext ? `0 0 0 4px ${t.ring}` : undefined,
      }}
    >
      <span className="relative z-[1]">{glyph}</span>
    </span>
  );
}

/**
 * Vertical stop timeline. The connector below a stop is solid emerald once
 * that stop is done, otherwise a dashed slate line; the next stop is
 * highlighted in a soft marigold row with its live ETA.
 */
export function ProgressRail({ items, onItemTap, dense, className }: ProgressRailProps) {
  const Row = onItemTap ? "button" : "div";
  return (
    <ol className={cn("relative m-0 list-none p-0", className)} aria-label="Stops">
      {items.map((it, i) => {
        const settled = isSettled(it.status);
        const delay = it.status === "done" ? formatDelay(it.delayMin) : null;
        const showEta = !settled && it.etaMin != null;
        const lastRow = i === items.length - 1;
        return (
          <li key={it.id ?? it.seq} className="relative flex gap-3">
            <div className={cn("flex w-7 shrink-0 flex-col items-center", dense ? "pt-1" : "pt-2")}>
              <Marker status={it.status} seq={it.seq} isNext={it.isNext} />
              {!lastRow && (
                <span
                  aria-hidden
                  className={cn("my-1 min-h-2 w-0.5 flex-1 rounded-full", it.status !== "done" && "bg-[repeating-linear-gradient(to_bottom,var(--color-ink-300)_0_4px,transparent_4px_8px)]")}
                  style={it.status === "done" ? { background: STOP_TONE.done.fill } : undefined}
                />
              )}
            </div>
            <Row
              type={onItemTap ? "button" : undefined}
              onClick={onItemTap ? () => onItemTap(it, i) : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 rounded-md text-left",
                dense ? "min-h-9 py-1" : "min-h-11 py-2",
                lastRow ? "" : dense ? "mb-2" : "mb-3",
                it.isNext ? "-ml-1 bg-accent-soft px-3 ring-1 ring-accent/30" : "px-1",
                onItemTap && "transition-colors hover:bg-ink-50",
                settled && it.status !== "missed" && "opacity-70",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate font-semibold", dense ? "text-sm" : "text-base", it.isNext ? "text-ink-950" : "text-ink-900")}>{it.label}</span>
                {(it.sub || it.isNext) && (
                  <span className="mt-0.5 block truncate text-sm text-ink-500">
                    {it.isNext && <span className="font-semibold text-accent-soft-ink">Next stop</span>}
                    {it.isNext && it.sub && <span className="mx-1.5 text-ink-300">·</span>}
                    {it.sub}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2 tnum">
                {showEta && <span className={cn("font-semibold", it.isNext ? "text-md text-accent-soft-ink" : "text-sm text-ink-700")}>{formatEta(it.etaMin)}</span>}
                {delay?.text && <span className={cn("text-sm font-semibold", DELAY_CLS[delay.tone])}>{delay.text}</span>}
                {it.status === "missed" && <span className="text-sm font-semibold text-danger-ink">Missed</span>}
                {it.status === "skipped" && <span className="text-sm text-ink-500">Absent</span>}
                {it.trailing}
              </span>
            </Row>
          </li>
        );
      })}
    </ol>
  );
}
