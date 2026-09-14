import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";
import { cn } from "./cn";

export type ToastTone = "neutral" | "ok" | "warn" | "danger" | "info";
export interface ToastOptions {
  title?: ReactNode;
  message?: ReactNode;
  tone?: ToastTone;
  /** ms; default 3200, 0 = sticky until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Same id replaces an existing toast (e.g. progress updates). */
  id?: string;
}
export interface ToastItem extends Required<Pick<ToastOptions, "id" | "tone" | "duration">> { title?: ReactNode; message?: ReactNode; action?: ToastOptions["action"] }

export interface ToastApi {
  (message: ReactNode, opts?: Omit<ToastOptions, "message">): string;
  (opts: ToastOptions): string;
  ok(message: ReactNode, opts?: Omit<ToastOptions, "message" | "tone">): string;
  warn(message: ReactNode, opts?: Omit<ToastOptions, "message" | "tone">): string;
  danger(message: ReactNode, opts?: Omit<ToastOptions, "message" | "tone">): string;
  info(message: ReactNode, opts?: Omit<ToastOptions, "message" | "tone">): string;
  dismiss(id?: string): void;
}

const noop: ToastApi = Object.assign(() => "", { ok: () => "", warn: () => "", danger: () => "", info: () => "", dismiss: () => {} });
const ToastCtx = createContext<ToastApi>(noop);

/** `const toast = useToast(); toast("Saved"); toast.ok("Trip started"); toast({ title, message, tone, action })` */
export const useToast = () => useContext(ToastCtx);

const ICON: Record<ToastTone, typeof Info | null> = { neutral: null, ok: CheckCircle2, warn: AlertTriangle, danger: XCircle, info: Info };
const ICON_CLS: Record<ToastTone, string> = { neutral: "", ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info" };

function ToastCard({ t, onClose }: { t: ToastItem; onClose: () => void }) {
  const Icon = ICON[t.tone];
  return (
    <div
      role={t.tone === "danger" || t.tone === "warn" ? "alert" : "status"}
      className="anim-rise pointer-events-auto flex w-full items-start gap-3 rounded-md bg-ink-950 px-4 py-3 text-ink-50 shadow-sheet dark:bg-card dark:text-ink-900 dark:hairline"
    >
      {Icon && <Icon size={20} strokeWidth={2.25} className={cn("mt-0.5 shrink-0", ICON_CLS[t.tone])} aria-hidden />}
      <div className="min-w-0 flex-1 text-sm">
        {t.title && <p className="font-semibold">{t.title}</p>}
        {t.message && <p className={cn(t.title ? "mt-0.5 opacity-80" : "font-medium")}>{t.message}</p>}
      </div>
      {t.action && (
        <button type="button" onClick={() => { t.action?.onClick(); onClose(); }} className="shrink-0 rounded-xs px-1 text-sm font-semibold text-accent-strong dark:text-primary">
          {t.action.label}
        </button>
      )}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="-mr-1 -mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Mount once at the app root. Toasts stack bottom-centre above the tab bar. */
export function ToastHost({ children, bottomOffset = 80 }: { children: ReactNode; bottomOffset?: number }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());
  const seq = useRef(0);

  const dismiss = useCallback((id?: string) => {
    setItems((xs) => (id ? xs.filter((x) => x.id !== id) : []));
    if (id) { window.clearTimeout(timers.current.get(id)); timers.current.delete(id); }
    else { timers.current.forEach((t) => window.clearTimeout(t)); timers.current.clear(); }
  }, []);

  const push = useCallback((o: ToastOptions) => {
    const id = o.id ?? `t${++seq.current}`;
    const item: ToastItem = { id, tone: o.tone ?? "neutral", duration: o.duration ?? 3200, title: o.title, message: o.message, action: o.action };
    setItems((xs) => [...xs.filter((x) => x.id !== id), item].slice(-3));
    window.clearTimeout(timers.current.get(id));
    if (item.duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), item.duration));
    return id;
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => {
    const base = ((a: ReactNode | ToastOptions, opts?: Omit<ToastOptions, "message">) =>
      typeof a === "object" && a !== null && !("$$typeof" in (a as object)) && !Array.isArray(a)
        ? push(a as ToastOptions)
        : push({ ...(opts ?? {}), message: a as ReactNode })) as ToastApi;
    base.ok = (m, o) => push({ ...o, message: m, tone: "ok" });
    base.warn = (m, o) => push({ ...o, message: m, tone: "warn" });
    base.danger = (m, o) => push({ ...o, message: m, tone: "danger" });
    base.info = (m, o) => push({ ...o, message: m, tone: "info" });
    base.dismiss = dismiss;
    return base;
  }, [push, dismiss]);

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-[90] mx-auto flex w-full max-w-[420px] flex-col gap-2 px-4"
        style={{ bottom: `calc(${bottomOffset}px + env(safe-area-inset-bottom, 0px))` }}
      >
        {items.map((t) => <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />)}
      </div>
    </ToastCtx.Provider>
  );
}
