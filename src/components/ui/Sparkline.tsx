import { useId } from "react";
import { cn } from "./cn";

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Colour token or CSS colour; default currentColor (set `text-*` on the parent). */
  stroke?: string;
  /** Fill the area under the line. */
  area?: boolean;
  /** Highlight the last point. */
  last?: boolean;
  /** Draw a faint reference line at this value (e.g. target on-time %). */
  baseline?: number;
  /** Fix the vertical scale (else min/max of the data). */
  domain?: [number, number];
  strokeWidth?: number;
  /** Stretch to the parent width (height stays fixed). */
  fluid?: boolean;
  className?: string;
  /** Accessible label; defaults to a compact description. */
  label?: string;
}

/** Pure-SVG sparkline. Theme-aware via currentColor; no axes, no library. */
export function Sparkline({ values, width = 96, height = 32, stroke = "currentColor", area = true, last = true, baseline, domain, strokeWidth = 1.75, fluid, className, label }: SparklineProps) {
  const id = useId();
  const n = values.length;
  const pad = 3;
  const lo = domain ? domain[0] : Math.min(...values, baseline ?? Infinity);
  const hi = domain ? domain[1] : Math.max(...values, baseline ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1));
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const d = pts.length ? "M" + pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(" L") : "";
  const areaD = pts.length ? `${d} L${x(n - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z` : "";
  const lastPt = pts[pts.length - 1];
  const desc = label ?? (n ? `Trend of ${n} values, latest ${values[n - 1]}` : "No data");
  return (
    <svg
      role="img" aria-label={desc}
      width={fluid ? "100%" : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={fluid ? "none" : "xMidYMid meet"}
      className={cn("shrink-0 overflow-visible", fluid && "block w-full", className)} style={{ color: stroke === "currentColor" ? undefined : stroke }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {baseline != null && (
        <line x1={pad} x2={width - pad} y1={y(baseline)} y2={y(baseline)} stroke="currentColor" strokeOpacity="0.28" strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      )}
      {n === 0 && <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 3" />}
      {area && n > 1 && <path d={areaD} fill={`url(#${id})`} />}
      {n > 1 && <path d={d} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {last && lastPt && (
        <>
          <circle cx={lastPt[0]} cy={lastPt[1]} r={4} fill="currentColor" opacity="0.2" />
          <circle cx={lastPt[0]} cy={lastPt[1]} r={2.25} fill="currentColor" />
        </>
      )}
    </svg>
  );
}
