import { isValidElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** An icon slot accepts either a lucide component (`icon={Bell}`) or a ready node (`icon={<Bell/>}`). */
export type IconSlot = LucideIcon | ReactNode;

export function renderIcon(icon: IconSlot, size: number, strokeWidth = 2.25): ReactNode {
  if (icon == null || icon === false) return null;
  if (isValidElement(icon) || typeof icon === "string" || typeof icon === "number") return icon;
  const I = icon as LucideIcon;
  return <I size={size} strokeWidth={strokeWidth} aria-hidden />;
}
