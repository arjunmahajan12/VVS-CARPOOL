import type { CSSProperties } from "react";
import { cn } from "./cn";

export type SkeletonVariant = "text" | "card" | "circle" | "map" | "row" | "block";
export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** text: number of lines. row: number of rows. */
  lines?: number;
  /** circle: diameter px. block/map: height px. */
  size?: number;
  className?: string;
}

const Bone = ({ className, style, round }: { className?: string; style?: CSSProperties; round?: "full" | "md" }) => (
  <span aria-hidden className={cn("shimmer block bg-ink-200", round === "full" ? "rounded-full" : round === "md" ? "rounded-md" : "rounded-sm", className)} style={style} />
);

/** Loading placeholders. Shimmer stops under prefers-reduced-motion. */
export function Skeleton({ variant = "text", lines = 3, size, className }: SkeletonProps) {
  if (variant === "circle") return <Bone round="full" className={className} style={{ width: size ?? 40, height: size ?? 40 }} />;
  if (variant === "block") return <Bone round="md" className={className} style={{ height: size ?? 96 }} />;
  if (variant === "text") {
    const widths = ["100%", "88%", "62%", "94%", "70%"];
    return (
      <span role="status" aria-label="Loading" className={cn("grid gap-2", className)}>
        {Array.from({ length: lines }).map((_, i) => <Bone key={i} className="h-3.5" style={{ width: widths[i % widths.length] }} />)}
      </span>
    );
  }
  if (variant === "row") {
    return (
      <div role="status" aria-label="Loading" className={cn("grid", className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 py-3">
            <Bone round="full" style={{ width: 40, height: 40 }} />
            <span className="grid flex-1 gap-2"><Bone className="h-3.5 w-[55%]" /><Bone className="h-3 w-[35%]" /></span>
            <Bone round="full" className="h-5 w-14" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === "card") {
    return (
      <div role="status" aria-label="Loading" className={cn("rounded-lg bg-card p-4 shadow-card", className)}>
        <div className="flex items-center gap-3">
          <Bone round="full" style={{ width: 40, height: 40 }} />
          <span className="grid flex-1 gap-2"><Bone className="h-3.5 w-[50%]" /><Bone className="h-3 w-[30%]" /></span>
        </div>
        <span className="mt-4 grid gap-2"><Bone className="h-3.5 w-full" /><Bone className="h-3.5 w-[80%]" /></span>
        <div className="mt-4 flex gap-2"><Bone round="md" className="h-9 w-24" /><Bone round="md" className="h-9 w-20" /></div>
      </div>
    );
  }
  // map: a block with faint "road" strokes so it reads as a map, not a grey box
  return (
    <div role="status" aria-label="Loading map" className={cn("shimmer relative overflow-hidden rounded-lg bg-ink-200", className)} style={{ height: size ?? 220 }}>
      <svg aria-hidden className="absolute inset-0 h-full w-full text-ink-300/60" viewBox="0 0 400 220" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M-10 60 C 80 40, 140 120, 230 90 S 380 60, 420 110" />
        <path d="M60 -10 C 70 80, 40 150, 90 240" strokeWidth="2" />
        <path d="M300 -10 C 280 60, 330 140, 290 240" strokeWidth="2" />
        <path d="M-10 170 C 100 160, 200 200, 420 160" strokeWidth="2" />
      </svg>
      <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-300/70 ring-4 ring-ink-300/25" />
    </div>
  );
}
