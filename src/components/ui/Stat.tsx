import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "./cn";
import { renderIcon, type IconSlot } from "./icon";

export interface StatDelta {
  /** Signed number; rendered with an arrow. */
  value: number;
  /** Unit suffix, e.g. "%" or " min". */
  unit?: string;
  /** Is a positive delta good? (on-time % yes; delay no). Default true. */
  upIsGood?: boolean;
  /** Text after the delta, e.g. "vs last 10". */
  label?: string;
}
export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Small unit next to the value ("%", "min"). */
  unit?: ReactNode;
  delta?: StatDelta;
  icon?: IconSlot;
  /** Bottom slot, typically `<Sparkline fluid />` — it stretches to the tile width. */
  chart?: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "primary" | "accent" | "ok" | "warn" | "danger";
  size?: "sm" | "md";
  className?: string;
  onClick?: () => void;
}

const ICON_TILE = {
  neutral: "bg-ink-100 text-ink-700", primary: "bg-primary-soft text-primary-soft-ink", accent: "bg-accent-soft text-accent-soft-ink",
  ok: "bg-ok-soft text-ok-ink", warn: "bg-warn-soft text-warn-ink", danger: "bg-danger-soft text-danger-ink",
};
const CHART_INK = { neutral: "text-primary", primary: "text-primary", accent: "text-accent", ok: "text-ok", warn: "text-warn", danger: "text-danger" };

/** KPI tile: label · big tabular value · delta · optional icon and sparkline. */
export function Stat({ label, value, unit, delta, icon, chart, hint, tone = "neutral", size = "md", className, onClick }: StatProps) {
  const good = delta ? (delta.value === 0 ? null : (delta.value > 0) === (delta.upIsGood ?? true)) : null;
  const DeltaIcon = delta ? (delta.value > 0 ? ArrowUpRight : delta.value < 0 ? ArrowDownRight : Minus) : null;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined} onClick={onClick}
      className={cn("relative flex min-w-0 flex-col gap-1 rounded-lg bg-card text-left text-ink-900 shadow-card", size === "sm" ? "p-3.5" : "p-4", onClick && "transition-transform active:scale-[0.99]", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-ink-500">{label}</span>
        {icon && <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-sm", ICON_TILE[tone])}>{renderIcon(icon, 16)}</span>}
      </div>
      <div className={cn("font-display font-bold tracking-tight text-ink-950 tnum", size === "sm" ? "text-xl" : "text-2xl")}>
        {value}{unit && <span className="ml-0.5 font-sans text-sm font-semibold text-ink-500">{unit}</span>}
      </div>
      {(delta || hint) && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tnum">
          {delta && DeltaIcon && (
            <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", good === null ? "bg-ink-100 text-ink-700" : good ? "bg-ok-soft text-ok-ink" : "bg-danger-soft text-danger-ink")}>
              <DeltaIcon size={12} strokeWidth={2.5} aria-hidden />{delta.value > 0 ? "+" : ""}{delta.value}{delta.unit}
            </span>
          )}
          {(delta?.label || hint) && <span className="text-ink-500">{delta?.label ?? hint}</span>}
        </div>
      )}
      {chart && <div className={cn("mt-auto pt-2", CHART_INK[tone])}>{chart}</div>}
    </Tag>
  );
}
