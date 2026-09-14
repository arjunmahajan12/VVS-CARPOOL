import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";
import { renderIcon, type IconSlot } from "./icon";

export type ButtonVariant = "primary" | "soft" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon — a lucide component (`icon={Play}`) or any node. */
  icon?: IconSlot;
  iconRight?: IconSlot;
  full?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  soft: "bg-primary-soft text-primary-soft-ink hover:bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)]",
  ghost: "bg-transparent text-ink-900 hairline hover:bg-ink-100",
  danger: "bg-danger text-white hover:bg-danger-ink",
  accent: "bg-accent text-on-accent hover:bg-accent-strong",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm rounded-sm",
  md: "h-11 px-4.5 text-base rounded-md",
  lg: "h-13 px-6 text-md rounded-md",
};
const GAP: Record<ButtonSize, string> = { sm: "gap-1.5", md: "gap-2", lg: "gap-2.5" };
const ICON: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

export function Button({
  variant = "primary", size = "md", loading = false, icon, iconRight, full, className, children, disabled, type = "button", ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex select-none items-center justify-center whitespace-nowrap font-semibold leading-none",
        "transition-[background-color,transform,opacity] duration-150 active:scale-[0.98] disabled:active:scale-100",
        loading ? "opacity-80" : "disabled:opacity-50",
        BUTTON_VARIANT[variant], SIZE[size], full && "w-full", className,
      )}
      {...rest}
    >
      {loading && (
        <span className="absolute inset-0 grid place-items-center"><Spinner size={size === "lg" ? "md" : "sm"} /></span>
      )}
      <span className={cn("inline-flex items-center", GAP[size], loading && "invisible")}>
        {renderIcon(icon, ICON[size])}
        {children}
        {renderIcon(iconRight, ICON[size])}
      </span>
    </button>
  );
}

export type IconButtonVariant = "soft" | "ghost" | "primary" | "card" | "danger";
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconSlot;
  /** Required — icon-only controls need an accessible name. */
  label: string;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Small accent dot in the corner (e.g. unread). */
  dot?: boolean;
  ref?: Ref<HTMLButtonElement>;
}
const IB_VARIANT: Record<IconButtonVariant, string> = {
  soft: "bg-primary-soft text-primary-soft-ink hover:bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)]",
  ghost: "bg-transparent text-ink-700 hover:bg-ink-100",
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  /** Floating over a map: card surface + shadow. */
  card: "bg-card text-ink-900 shadow-card hairline",
  danger: "bg-danger-soft text-danger-ink hover:bg-[color-mix(in_srgb,var(--color-danger)_24%,transparent)]",
};
const IB_SIZE: Record<ButtonSize, string> = { sm: "h-9 w-9 rounded-sm", md: "h-11 w-11 rounded-md", lg: "h-13 w-13 rounded-md" };

export function IconButton({ icon, label, variant = "ghost", size = "md", loading, dot, className, disabled, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type} aria-label={label} title={label} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cn(
        "relative inline-grid shrink-0 place-items-center transition-[background-color,transform] duration-150 active:scale-95",
        loading ? "opacity-80" : "disabled:opacity-50",
        IB_VARIANT[variant], IB_SIZE[size], className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : renderIcon(icon, ICON[size] + 2)}
      {dot && <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-card" />}
    </button>
  );
}
