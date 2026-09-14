import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DividerProps { label?: ReactNode; className?: string; /** vertical space around */ spacing?: "none" | "sm" | "md" }
export function Divider({ label, className, spacing = "md" }: DividerProps) {
  const my = spacing === "none" ? "" : spacing === "sm" ? "my-2" : "my-4";
  if (!label) return <hr aria-hidden className={cn("border-0 border-t border-line", my, className)} />;
  return (
    <div role="separator" className={cn("flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink-500", my, className)}>
      <span className="h-px flex-1 bg-line" /><span>{label}</span><span className="h-px flex-1 bg-line" />
    </div>
  );
}
