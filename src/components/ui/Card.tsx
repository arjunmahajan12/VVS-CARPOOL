import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type CardPadding = "none" | "sm" | "md" | "lg";
export type CardVariant = "default" | "inset" | "outline" | "hero";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  padding?: CardPadding;
  variant?: CardVariant;
  /** Hover/press affordance; with `onClick` the card renders as a <button>. */
  interactive?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

const PAD: Record<CardPadding, string> = { none: "", sm: "p-3", md: "p-4", lg: "p-5" };
const VARIANT: Record<CardVariant, string> = {
  default: "bg-card text-ink-900 shadow-card",
  inset: "bg-card-2 text-ink-900",
  outline: "bg-transparent text-ink-900 hairline",
  hero: "hero-card text-white",
};

/**
 * Surface. `default` for content, `inset` for a secondary block inside a
 * card, `outline` for low-emphasis, `hero` for the Home live-trip card.
 */
export function Card({ padding = "md", variant = "default", interactive, onClick, className, children, ...rest }: CardProps) {
  const cls = cn(
    "relative rounded-lg text-left",
    VARIANT[variant], PAD[padding],
    (interactive || onClick) && "transition-[transform,box-shadow,background-color] duration-150 active:scale-[0.99] hover:bg-[color-mix(in_srgb,var(--color-card)_92%,var(--color-ink-900))]",
    variant === "hero" && (interactive || onClick) && "hover:brightness-105",
    className,
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, "block w-full")} {...(rest as HTMLAttributes<HTMLButtonElement>)}>
        {children}
      </button>
    );
  }
  return <div className={cls} {...rest}>{children}</div>;
}
