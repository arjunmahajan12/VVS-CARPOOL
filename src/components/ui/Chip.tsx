import type { ButtonHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { renderIcon, type IconSlot } from "./icon";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  selected?: boolean;
  icon?: IconSlot;
  /** Small trailing count. */
  count?: number;
  size?: "sm" | "md";
  /** Shows an × and calls this — for active filter chips. */
  onRemove?: () => void;
}

/** Selectable filter chip. Renders a <button aria-pressed>. */
export function Chip({ children, selected, icon, count, size = "md", onRemove, className, type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type} aria-pressed={selected}
      className={cn(
        "inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow] duration-150 active:scale-[0.97]",
        size === "sm" ? "h-8 gap-1.5 px-3 text-sm" : "h-9 gap-2 px-3.5 text-sm",
        selected
          ? "bg-primary text-on-primary"
          : "bg-card text-ink-700 hairline hover:bg-ink-100",
        className,
      )}
      {...rest}
    >
      {renderIcon(icon, 15)}
      <span>{children}</span>
      {count != null && (
        <span className={cn("tnum rounded-full px-1.5 text-xs font-semibold leading-4", selected ? "bg-white/20" : "bg-ink-100 text-ink-500")}>{count}</span>
      )}
      {onRemove && (
        <span role="button" aria-label="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className={cn("-mr-1 grid h-5 w-5 place-items-center rounded-full", selected ? "hover:bg-white/20" : "hover:bg-ink-200")}>
          <X size={13} strokeWidth={2.5} aria-hidden />
        </span>
      )}
    </button>
  );
}
