import type { HTMLAttributes, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  leading?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  /** Right chevron (defaults to true when onClick is set). */
  chevron?: boolean;
  onClick?: () => void;
  /** Tighter vertical padding. */
  dense?: boolean;
  /** Hairline under the row (for stacked lists inside a card). */
  divider?: boolean;
  disabled?: boolean;
}

/**
 * One row of a list: leading (avatar/icon) · title + sub · trailing (pill,
 * value) · chevron. Renders a <button> when onClick is given.
 */
export function ListRow({ leading, title, sub, trailing, chevron, onClick, dense, divider, disabled, className, ...rest }: ListRowProps) {
  const showChevron = chevron ?? !!onClick;
  const inner = (
    <>
      {leading && <span className="flex shrink-0 items-center text-ink-500">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-ink-900">{title}</span>
        {sub && <span className="mt-0.5 block truncate text-sm text-ink-500">{sub}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-sm text-ink-500 tnum">{trailing}</span>}
      {showChevron && <ChevronRight size={18} strokeWidth={2.25} className="-mr-1 shrink-0 text-ink-300" aria-hidden />}
    </>
  );
  const cls = cn(
    "flex w-full items-center gap-3 text-left",
    dense ? "min-h-12 py-2" : "min-h-14 py-3",
    divider && "border-b border-line last:border-b-0",
    onClick && !disabled && "transition-colors duration-150 hover:bg-ink-50 active:bg-ink-100",
    disabled && "opacity-50",
    className,
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cls} {...(rest as HTMLAttributes<HTMLButtonElement>)}>
        {inner}
      </button>
    );
  }
  return <div className={cls} {...rest}>{inner}</div>;
}
