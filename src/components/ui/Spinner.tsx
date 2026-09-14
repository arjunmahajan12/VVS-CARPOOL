import { cn } from "./cn";

export interface SpinnerProps { size?: "xs" | "sm" | "md" | "lg"; className?: string; label?: string }
const SIZE = { xs: "h-3.5 w-3.5 border-[1.5px]", sm: "h-4 w-4 border-2", md: "h-6 w-6 border-2", lg: "h-8 w-8 border-[3px]" };

/** Circular spinner in `currentColor` — drop it in any button or text colour. */
export function Spinner({ size = "md", className, label = "Loading" }: SpinnerProps) {
  return (
    <span
      role="status" aria-label={label}
      className={cn("anim-spin inline-block shrink-0 rounded-full border-current border-t-transparent", SIZE[size], className)}
    />
  );
}
