// Loading + failure chrome shared by both providers: a shimmer skeleton that
// covers the container until the map is ready, and an explicit error card with
// Retry when the SDK can't load (never a silent fallback).

export function MapSkeleton({ visible, insetBottom = 0, insetTop = 0 }: { visible: boolean; insetBottom?: number; insetTop?: number }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-[5] transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ background: "var(--color-bg, #F5F7FB)" }}
    >
      <div className="absolute inset-0 animate-pulse bg-[linear-gradient(120deg,#E4E9F2_0%,#F1F4F9_45%,#E4E9F2_100%)] dark:bg-[linear-gradient(120deg,#141D33_0%,#1B2745_45%,#141D33_100%)]" />
      {/* faux roads so the shimmer reads as "a map is coming" */}
      <div className="absolute inset-0 opacity-60">
        <div className="absolute left-[12%] top-0 h-full w-[3px] rounded bg-white/70 dark:bg-white/10" />
        <div className="absolute left-[58%] top-0 h-full w-[5px] rounded bg-white/70 dark:bg-white/10" />
        <div className="absolute left-0 top-[28%] h-[4px] w-full rounded bg-white/70 dark:bg-white/10" />
        <div className="absolute left-0 top-[66%] h-[3px] w-full rounded bg-white/70 dark:bg-white/10" />
        <div className="absolute left-[30%] top-[40%] h-16 w-16 animate-pulse rounded-2xl bg-white/50 dark:bg-white/5" />
        <div className="absolute left-[64%] top-[50%] h-24 w-20 animate-pulse rounded-2xl bg-white/50 dark:bg-white/5" />
      </div>
      <div className="absolute inset-x-0 flex -translate-y-1/2 justify-center" style={{ top: `calc(${insetTop}px + (100% - ${insetTop + insetBottom}px) / 2)` }}>
        <div className="flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm backdrop-blur dark:bg-slate-900/70 dark:text-slate-300">
          <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[#F2A900]" />
          Loading map
        </div>
      </div>
    </div>
  );
}

export function MapError({ onRetry, detail, insetBottom = 0, insetTop = 0 }: { onRetry: () => void; detail?: string; insetBottom?: number; insetTop?: number }) {
  return (
    <div className="absolute inset-0 z-[6] grid place-items-center p-4" style={{ background: "var(--color-bg, #F5F7FB)", paddingBottom: insetBottom + 16, paddingTop: insetTop + 16 }}>
      <div
        role="alert"
        className="w-full max-w-xs rounded-[20px] p-5 text-center shadow-[0_10px_30px_-12px_rgba(17,26,46,0.25)]"
        style={{ background: "var(--color-card, #FFFFFF)", color: "var(--color-ink-900, #111A2E)" }}
      >
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" />
          </svg>
        </div>
        <div className="text-[15px] font-bold">Map couldn't load</div>
        <p className="mt-1 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
          {detail || "Check your connection, or the map key's allowed domains, then try again."}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-10 items-center justify-center rounded-[14px] px-5 text-[13px] font-semibold text-white shadow-sm transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: "var(--color-primary-600, #1F4B99)" }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
