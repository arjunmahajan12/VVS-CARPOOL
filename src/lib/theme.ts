// Theme helper — class-based dark mode.
//
//   initTheme()                    call once on boot (App or main); applies the saved
//                                  preference and keeps "system" in sync with the OS.
//   getTheme()  → 'light' | 'dark' | 'system'
//   setTheme('dark')               persists (localStorage, try/catch) and applies.
//   resolvedTheme() → 'light' | 'dark'   what is actually on screen right now.
//   onThemeChange(fn) → unsubscribe
//
// Storage key is "theme" (values light|dark|system) — main.tsx's pre-paint
// restore reads the same key, so a saved "dark" never flashes light.

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "theme";
const listeners = new Set<(t: ResolvedTheme, pref: ThemePref) => void>();
let mql: MediaQueryList | null = null;
let mqlBound = false;

function readStored(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* storage unavailable */ }
  return "system";
}

function systemPrefersDark(): boolean {
  try {
    if (!mql) mql = window.matchMedia("(prefers-color-scheme: dark)");
    return mql.matches;
  } catch { return false; }
}

export function getTheme(): ThemePref { return readStored(); }

export function resolvedTheme(): ResolvedTheme {
  const p = readStored();
  return p === "system" ? (systemPrefersDark() ? "dark" : "light") : p;
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = dark ? "#0B1220" : "#F5F7FB";
  const resolved: ResolvedTheme = dark ? "dark" : "light";
  listeners.forEach((fn) => fn(resolved, pref));
}

export function setTheme(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  apply(pref);
}

/** Cycle light → dark → system → light. Handy for a single toggle button. */
export function cycleTheme(): ThemePref {
  const order: ThemePref[] = ["light", "dark", "system"];
  const next = order[(order.indexOf(getTheme()) + 1) % order.length];
  setTheme(next);
  return next;
}

export function onThemeChange(fn: (t: ResolvedTheme, pref: ThemePref) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Call once on boot. Safe to call more than once. */
export function initTheme() {
  if (typeof window === "undefined") return;
  apply(readStored());
  if (!mqlBound) {
    mqlBound = true;
    try {
      if (!mql) mql = window.matchMedia("(prefers-color-scheme: dark)");
      mql.addEventListener("change", () => { if (readStored() === "system") apply("system"); });
    } catch { /* no matchMedia */ }
    // Keep tabs in sync.
    window.addEventListener("storage", (e) => { if (e.key === KEY) apply(readStored()); });
  }
}
