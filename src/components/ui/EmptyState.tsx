import type { ReactNode } from "react";
import { cn } from "./cn";
import { renderIcon, type IconSlot } from "./icon";

export interface EmptyStateProps {
  icon?: IconSlot;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  /** `compact` for inside a card; `page` for a whole empty screen. */
  size?: "compact" | "page";
  tone?: "neutral" | "danger" | "primary";
  className?: string;
}

/** Empty / error state. Icon sits in a soft tile; copy is left-aligned in compact and centred on a page. */
export function EmptyState({ icon, title, sub, action, size = "compact", tone = "neutral", className }: EmptyStateProps) {
  const page = size === "page";
  const tile = tone === "danger" ? "bg-danger-soft text-danger-ink" : tone === "primary" ? "bg-primary-soft text-primary-soft-ink" : "bg-ink-100 text-ink-500";
  return (
    <div className={cn("flex", page ? "flex-col items-center px-6 py-14 text-center" : "items-start gap-4 py-6", className)}>
      {icon && (
        <span className={cn("grid shrink-0 place-items-center rounded-md", tile, page ? "mb-5 h-16 w-16 rounded-lg" : "h-12 w-12")}>
          {renderIcon(icon, page ? 28 : 22, 2)}
        </span>
      )}
      <div className={cn("min-w-0", page && "max-w-[300px]")}>
        <p className={cn("font-display font-bold text-ink-950", page ? "text-lg" : "text-md")}>{title}</p>
        {sub && <p className={cn("mt-1 text-ink-500 text-pretty", page ? "text-base" : "text-sm")}>{sub}</p>}
        {action && <div className={cn("mt-4", page && "flex justify-center")}>{action}</div>}
      </div>
    </div>
  );
}
