import type { LucideIcon } from "lucide-react";
import { Bell, Car, Compass, House, UserRound } from "lucide-react";
import { cn } from "./cn";

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  icon: LucideIcon;
  /** Unread count (number) or a plain dot (true). */
  badge?: number | boolean;
}
export interface TabBarProps<K extends string = string> {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  /** Fixed to the bottom of the viewport (default). Set false to place it inside a layout. */
  fixed?: boolean;
  className?: string;
}

/** The app's five root tabs. Screens may override labels/icons. */
export const APP_TABS: TabItem<"home" | "discover" | "carpools" | "alerts" | "profile">[] = [
  { key: "home", label: "Home", icon: House },
  { key: "discover", label: "Discover", icon: Compass },
  { key: "carpools", label: "Carpools", icon: Car },
  { key: "alerts", label: "Alerts", icon: Bell },
  { key: "profile", label: "Profile", icon: UserRound },
];

/** Height without safe-area; pad scrolling content with `.pb-tabbar`. */
export const TABBAR_HEIGHT = 64;

export function TabBar<K extends string = string>({ tabs, active, onChange, fixed = true, className }: TabBarProps<K>) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "pb-safe z-30 border-t border-line bg-card/95 backdrop-blur-md",
        fixed && "fixed inset-x-0 bottom-0",
        className,
      )}
    >
      <ul className="m-0 grid list-none p-0" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, height: TABBAR_HEIGHT }}>
        {tabs.map((t) => {
          const on = t.key === active;
          const Icon = t.icon;
          return (
            <li key={t.key} className="min-w-0">
              <button
                type="button" onClick={() => onChange(t.key)} aria-current={on ? "page" : undefined}
                aria-label={typeof t.badge === "number" && t.badge > 0 ? `${t.label}, ${t.badge} new` : t.badge === true ? `${t.label}, new` : t.label}
                className={cn("group relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-xs transition-colors", on ? "text-primary" : "text-ink-500 hover:text-ink-700")}
              >
                <span className={cn("relative grid h-8 w-12 place-items-center rounded-full transition-[background-color,transform] duration-200", on && "bg-primary-soft")}>
                  <Icon size={22} strokeWidth={on ? 2.5 : 2} aria-hidden />
                  {t.badge ? (
                    typeof t.badge === "number" ? (
                      <span aria-hidden className="tnum absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-card">{t.badge > 99 ? "99+" : t.badge}</span>
                    ) : (
                      <span className="absolute right-2 top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-card" />
                    )
                  ) : null}
                </span>
                <span className={cn("truncate text-[11px] leading-none", on ? "font-bold" : "font-medium")}>{t.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
