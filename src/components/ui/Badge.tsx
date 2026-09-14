import type { HTMLAttributes, ReactNode } from "react";
import { STOP_TONE } from "../map/mapTypes";
import type { StopStatus, RiderStatus } from "../../lib/types";
import { cn } from "./cn";

export type PillTone = "neutral" | "primary" | "accent" | "ok" | "warn" | "danger" | "info" | "live";

const TONE: Record<PillTone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  primary: "bg-primary-soft text-primary-soft-ink",
  accent: "bg-accent-soft text-accent-soft-ink",
  ok: "bg-ok-soft text-ok-ink",
  warn: "bg-warn-soft text-warn-ink",
  danger: "bg-danger-soft text-danger-ink",
  info: "bg-info-soft text-info-ink",
  live: "bg-accent text-on-accent",
};
const DOT: Record<PillTone, string> = {
  neutral: "bg-ink-500", primary: "bg-primary", accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info", live: "bg-ink-950",
};

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  /** Leading dot; `"pulse"` animates (live things). */
  dot?: boolean | "pulse";
  size?: "sm" | "md";
  /** Explicit dot colour (StatusBadge passes STOP_TONE.fill). */
  dotColor?: string;
  children?: ReactNode;
}

/** Generic label pill. Use `StatusBadge` when the tone comes from a stop/rider status. */
export function Pill({ tone = "neutral", dot, size = "md", dotColor, className, children, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold leading-none tnum",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        TONE[tone], className,
      )}
      {...rest}
    >
      {dot && (
        <span className={cn("relative h-1.5 w-1.5 rounded-full", !dotColor && DOT[tone])} style={dotColor ? { background: dotColor, color: dotColor } : undefined}>
          {dot === "pulse" && <span aria-hidden className="anim-ring absolute inset-0 rounded-full" />}
        </span>
      )}
      {children}
    </span>
  );
}

/** Stop status → pill tone (1:1 with the map's STOP_TONE). */
export const STOP_PILL_TONE: Record<StopStatus, PillTone> = {
  pending: "neutral", arriving: "warn", stopped: "accent", done: "ok", missed: "danger", skipped: "neutral",
};
export const RIDER_LABEL: Record<RiderStatus, string> = { waiting: "Waiting", boarded: "On board", dropped: "Dropped" };
export const RIDER_PILL_TONE: Record<RiderStatus, PillTone> = { waiting: "neutral", boarded: "ok", dropped: "info" };

export interface StatusBadgeProps extends Omit<PillProps, "tone" | "children"> {
  /** Stop status (ride_stops.status). Label + colour from STOP_TONE. */
  status?: StopStatus;
  /** Rider status (waiting / boarded / dropped). */
  rider?: RiderStatus;
  /** Generic tone if neither status is given. */
  tone?: PillTone;
  /** Override the auto label. */
  children?: ReactNode;
}

/**
 * Coloured status pill. Colours match the map badges exactly — the dot is
 * painted with STOP_TONE.fill so a "Stopped" pill and a "Stopped" map badge
 * are the same marigold.
 */
export function StatusBadge({ status, rider, tone, children, dot, ...rest }: StatusBadgeProps) {
  if (status) {
    const t = STOP_TONE[status];
    const pulse = status === "stopped" || status === "arriving";
    return (
      <Pill tone={STOP_PILL_TONE[status]} dot={dot ?? (pulse ? "pulse" : true)} dotColor={t.fill} {...rest}>
        {children ?? t.label}
      </Pill>
    );
  }
  if (rider) {
    return <Pill tone={RIDER_PILL_TONE[rider]} dot={dot ?? true} {...rest}>{children ?? RIDER_LABEL[rider]}</Pill>;
  }
  return <Pill tone={tone ?? "neutral"} dot={dot} {...rest}>{children}</Pill>;
}

/** "LIVE" tag — marigold, pulsing. Use sparingly (one per screen). */
export function LiveBadge({ children = "Live", className, ...rest }: Omit<PillProps, "tone" | "dot">) {
  return <Pill tone="live" dot="pulse" className={cn("uppercase tracking-wide", className)} {...rest}>{children}</Pill>;
}
