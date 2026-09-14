import { useId } from "react";
import { cn } from "./cn";
import { renderIcon, type IconSlot } from "./icon";

export interface SegmentOption<V extends string> { value: V; label: string; icon?: IconSlot; disabled?: boolean }
export interface SegmentedControlProps<V extends string> {
  options: SegmentOption<V>[];
  value: V;
  onChange: (v: V) => void;
  size?: "sm" | "md";
  full?: boolean;
  /** Accessible name. */
  label?: string;
  className?: string;
}

/** iOS-style segmented control with a sliding thumb. */
export function SegmentedControl<V extends string>({ options, value, onChange, size = "md", full, label, className }: SegmentedControlProps<V>) {
  const id = useId();
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const n = options.length;
  return (
    <div
      role="radiogroup" aria-label={label}
      className={cn("relative inline-grid rounded-md bg-ink-100 p-1", full && "w-full", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-sm bg-card shadow-card transition-transform duration-200 ease-[var(--ease-out-quint)]"
        style={{ left: 4, width: `calc((100% - 8px) / ${n})`, transform: `translateX(${idx * 100}%)` }}
      />
      {options.map((o, i) => {
        const on = i === idx;
        return (
          <button
            key={o.value} type="button" role="radio" aria-checked={on} disabled={o.disabled} id={`${id}-${o.value}`}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-[1] inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-semibold transition-colors duration-150 disabled:opacity-40",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-sm",
              on ? "text-ink-950" : "text-ink-500 hover:text-ink-700",
            )}
          >
            {renderIcon(o.icon, size === "sm" ? 14 : 16)}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
