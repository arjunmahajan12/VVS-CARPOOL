import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SectionTitleProps {
  children: ReactNode;
  /** Small text under the title. */
  sub?: ReactNode;
  /** Right slot — "See all", a count, a small button. */
  action?: ReactNode;
  /** Count bubble beside the title. */
  count?: number;
  /** `eyebrow`: small caps label for grouping (e.g. "Today", "Pending"). */
  variant?: "title" | "eyebrow";
  className?: string;
  as?: "h2" | "h3" | "div";
}

/** Section heading with an optional right action. Left-aligned, display face. */
export function SectionTitle({ children, sub, action, count, variant = "title", className, as: Tag = "h2" }: SectionTitleProps) {
  if (variant === "eyebrow") {
    return (
      <div className={cn("flex items-center justify-between gap-3 pt-2 pb-1.5", className)}>
        <Tag className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-500 tnum">{children}{count != null && <span className="ml-1.5 text-ink-300">{count}</span>}</Tag>
        {action && <span className="text-sm font-semibold text-primary">{action}</span>}
      </div>
    );
  }
  return (
    <div className={cn("flex items-start justify-between gap-3 pt-3 pb-2", className)}>
      <div className="min-w-0">
        <Tag className="flex items-center gap-2 text-md leading-6 text-ink-950">
          <span className="truncate">{children}</span>
          {count != null && <span className="tnum rounded-full bg-ink-100 px-2 py-0.5 font-sans text-xs font-semibold text-ink-500">{count}</span>}
        </Tag>
        {sub && <p className="mt-0.5 text-sm text-ink-500">{sub}</p>}
      </div>
      {action && <span className="shrink-0 pt-0.5 text-sm font-semibold leading-6 text-primary">{action}</span>}
    </div>
  );
}
