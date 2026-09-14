import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { IconButton } from "./Button";
import { cn } from "./cn";

export interface TopBarProps {
  title?: ReactNode;
  sub?: ReactNode;
  /** Back arrow; called on tap. */
  onBack?: () => void;
  backLabel?: string;
  /** Right slot — IconButtons, a Pill, a small Button. */
  right?: ReactNode;
  /** Left slot instead of the back button (e.g. an Avatar). */
  left?: ReactNode;
  /**
   * `default` — solid app bar on the page background, sticky.
   * `map` — absolutely positioned over a full-bleed map: no bar surface,
   *          floating glass buttons, a soft scrim so text stays legible.
   * `large` — big display title for top-level tab screens.
   */
  variant?: "default" | "map" | "large";
  /** Visually hide the border under a default bar (e.g. when a segmented control follows). */
  flat?: boolean;
  className?: string;
}

/**
 * Screen header. Use `variant="map"` over maps (Discover, Carpool detail,
 * Live trip) and `variant="large"` on the tab roots (Home, Carpools…).
 */
export function TopBar({ title, sub, onBack, backLabel = "Back", right, left, variant = "default", flat, className }: TopBarProps) {
  const map = variant === "map";
  const large = variant === "large";
  const back = onBack ? (
    <IconButton icon={ArrowLeft} label={backLabel} onClick={onBack} variant={map ? "card" : "ghost"} size="md" className={cn(!map && "-ml-2", map && "glass shadow-card")} />
  ) : null;

  return (
    <header
      className={cn(
        "pt-safe z-20",
        map
          ? "pointer-events-none absolute inset-x-0 top-0 bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--color-bg)_70%,transparent),transparent)]"
          : cn("sticky top-0 bg-bg/92 backdrop-blur-md", !flat && !large && "border-b border-line"),
        className,
      )}
    >
      <div className={cn("flex items-center gap-2 px-4", large ? "min-h-16 pt-2 pb-1" : "min-h-14")}>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1">{left ?? back}</div>
        <div className={cn("min-w-0 flex-1", map && "pointer-events-auto")}>
          {title && (
            large ? (
              <h1 className="truncate text-xl leading-7">{title}</h1>
            ) : map ? (
              <div className="glass inline-flex max-w-full flex-col rounded-md px-3 py-1.5 shadow-card">
                <span className="truncate font-display text-md font-bold leading-5 text-ink-950">{title}</span>
                {sub && <span className="truncate text-xs text-ink-500 tnum">{sub}</span>}
              </div>
            ) : (
              <h1 className="truncate font-display text-md font-bold leading-6">{title}</h1>
            )
          )}
          {sub && !map && <p className={cn("truncate text-ink-500 tnum", large ? "text-base" : "text-xs")}>{sub}</p>}
        </div>
        {right && <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">{right}</div>}
      </div>
    </header>
  );
}
