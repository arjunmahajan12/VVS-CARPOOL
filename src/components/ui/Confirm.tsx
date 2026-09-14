import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { cn } from "./cn";
import { renderIcon, type IconSlot } from "./icon";

export interface ConfirmOptions {
  title?: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button (default true — most confirms guard a removal). */
  danger?: boolean;
  icon?: IconSlot;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Confirm button shows a spinner and the dialog stays open. */
  busy?: boolean;
}

/** Controlled dialog. Prefer `useConfirm()` for the promise flow. */
export function ConfirmDialog({ open, title = "Are you sure?", message, confirmLabel = "Yes, continue", cancelLabel = "Cancel", danger = true, icon, onConfirm, onCancel, busy }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, onCancel]);
  if (!open) return null;
  const Icon = icon ?? (danger ? AlertTriangle : null);
  return (
    <div className="anim-fade fixed inset-0 z-[100] grid place-items-center bg-scrim p-5 backdrop-blur-[2px]" onClick={busy ? undefined : onCancel}>
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="cfm-title" aria-describedby="cfm-msg"
        className="anim-pop w-full max-w-[360px] rounded-xl bg-card p-5 text-ink-900 shadow-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {Icon && (
          <span className={cn("mb-3 grid h-11 w-11 place-items-center rounded-md", danger ? "bg-danger-soft text-danger-ink" : "bg-primary-soft text-primary-soft-ink")}>
            {renderIcon(Icon, 22, 2.25)}
          </span>
        )}
        <h3 id="cfm-title" className="text-lg">{title}</h3>
        <p id="cfm-msg" className="mt-1.5 text-base text-ink-700 text-pretty">{message}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

type Ask = (o: ConfirmOptions | string) => Promise<boolean>;
const ConfirmCtx = createContext<Ask>(async () => true);
/** `const confirm = useConfirm(); if (await confirm({ message: "Delete this carpool?" })) …` */
export const useConfirm = () => useContext(ConfirmCtx);

/** Mount once at the app root (inside ToastHost is fine). */
export function ConfirmHost({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ask = useCallback<Ask>((o) => new Promise<boolean>((res) => {
    resolver.current?.(false);
    resolver.current = res;
    setOpts(typeof o === "string" ? { message: o } : o);
  }), []);
  const done = useCallback((v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); }, []);
  const onCancel = useCallback(() => done(false), [done]);
  const onConfirm = useCallback(() => done(true), [done]);
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {opts && <ConfirmDialog open {...opts} onConfirm={onConfirm} onCancel={onCancel} />}
    </ConfirmCtx.Provider>
  );
}
