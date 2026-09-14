import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | number;
export type AvatarTone = "auto" | "primary" | "accent" | "ok" | "info" | "rose" | "neutral";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: AvatarSize;
  tone?: AvatarTone;
  /** Ring: `true` = card-coloured (for stacking), or a tone for status. */
  ring?: boolean | "ok" | "accent" | "danger" | "primary";
  src?: string | null;
  /** Small status dot bottom-right. */
  status?: "ok" | "warn" | "danger" | "info";
}

const PX: Record<Exclude<AvatarSize, number>, number> = { xs: 24, sm: 32, md: 40, lg: 48, xl: 64 };
const TONES: Record<Exclude<AvatarTone, "auto">, string> = {
  primary: "bg-primary-soft text-primary-soft-ink",
  accent: "bg-accent-soft text-accent-soft-ink",
  ok: "bg-ok-soft text-ok-ink",
  info: "bg-info-soft text-info-ink",
  rose: "bg-danger-soft text-danger-ink",
  neutral: "bg-ink-100 text-ink-700",
};
const AUTO: Exclude<AvatarTone, "auto">[] = ["primary", "accent", "ok", "info", "rose"];
const RING: Record<string, string> = {
  true: "ring-2 ring-card", ok: "ring-2 ring-ok", accent: "ring-2 ring-accent", danger: "ring-2 ring-danger", primary: "ring-2 ring-primary",
};
const STATUS = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info" };

export function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function hashTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AUTO[Math.abs(h) % AUTO.length];
}

/** Initials avatar; tone is stable per name so the same parent is always the same colour. */
export function Avatar({ name, size = "md", tone = "auto", ring, src, status, className, style, ...rest }: AvatarProps) {
  const px = typeof size === "number" ? size : PX[size];
  const t = tone === "auto" ? hashTone(name) : tone;
  return (
    <span
      role="img" aria-label={name}
      className={cn("relative inline-grid shrink-0 select-none place-items-center overflow-visible rounded-full font-display font-bold leading-none", TONES[t], ring && RING[String(ring)], className)}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.36), ...style }}
      {...rest}
    >
      {src ? <img src={src} alt="" className="h-full w-full rounded-full object-cover" /> : initialsOf(name)}
      {status && <span aria-hidden className={cn("absolute rounded-full ring-2 ring-card", STATUS[status])} style={{ width: Math.max(8, px * 0.26), height: Math.max(8, px * 0.26), right: -1, bottom: -1 }} />}
    </span>
  );
}

/** Overlapping avatars, "+N" overflow. */
export function AvatarStack({ names, size = "sm", max = 4, className }: { names: string[]; size?: AvatarSize; max?: number; className?: string }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  const px = typeof size === "number" ? size : PX[size];
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((n, i) => <Avatar key={n + i} name={n} size={size} ring className={i > 0 ? "-ml-1.5" : ""} />)}
      {extra > 0 && (
        <span className="tnum -ml-1.5 grid place-items-center rounded-full bg-ink-100 font-semibold text-ink-700 ring-2 ring-card" style={{ width: px, height: px, fontSize: Math.round(px * 0.34) }}>+{extra}</span>
      )}
    </span>
  );
}
