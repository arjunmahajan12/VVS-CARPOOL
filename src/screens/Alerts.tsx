// Alerts — the in-app inbox. Grouped by day, kinds coloured, marked read on open.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Car, CheckCheck, Megaphone, ShieldAlert, ShieldCheck, UserPlus, Info } from "lucide-react";
import { api } from "../lib/api";
import { keepFresh } from "../lib/bus";
import { dayLabel, fmtTime, istDayKey } from "../lib/format";
import type { Notification } from "../lib/types";
import { Button, Card, EmptyState, Skeleton, TopBar, cn } from "../components/ui";

type KindStyle = { icon: typeof Bell; tile: string; label: string };
const KIND: Record<string, KindStyle> = {
  trip: { icon: Car, tile: "bg-primary-soft text-primary-soft-ink", label: "Trip" },
  safety: { icon: ShieldCheck, tile: "bg-ok-soft text-ok-ink", label: "Child safe" },
  sos: { icon: ShieldAlert, tile: "bg-danger-soft text-danger-ink", label: "Route alert" },
  warn: { icon: ShieldAlert, tile: "bg-warn-soft text-warn-ink", label: "Needs attention" },
  invite: { icon: UserPlus, tile: "bg-accent-soft text-accent-soft-ink", label: "Invite" },
  approved: { icon: ShieldCheck, tile: "bg-ok-soft text-ok-ink", label: "Verified" },
  system: { icon: Info, tile: "bg-info-soft text-info-ink", label: "School" },
  broadcast: { icon: Megaphone, tile: "bg-info-soft text-info-ink", label: "Notice" },
  info: { icon: Bell, tile: "bg-ink-100 text-ink-700", label: "Update" },
};
const kindStyle = (n: Notification): KindStyle => {
  if (n.kind === "trip" && /⚠️|missed|skipped|correction|long stop|speeding/i.test(n.title)) return KIND.warn;
  return KIND[n.kind] ?? KIND.info;
};

export default function Alerts({ onRead }: { onRead?: () => void }) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set()); // were unread when opened — keep them highlighted this visit

  const load = useCallback(async () => {
    try {
      const list = await api.notifications();
      setItems(list); setError(null);
      const unread = list.filter((n) => !n.read);
      if (unread.length) {
        setFreshIds((s) => { const n = new Set(s); unread.forEach((x) => n.add(x.id)); return n; });
        await api.markNotificationsRead().catch(() => { /* retry on next load */ });
        onRead?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your alerts.");
      setItems((x) => x ?? []);
    }
  }, [onRead]);

  useEffect(() => keepFresh(load, 20000), [load]);
  useEffect(() => api.onNotifications(() => { void load(); }), [load]);

  const groups = useMemo(() => {
    const m = new Map<string, Notification[]>();
    (items ?? []).forEach((n) => { const k = istDayKey(n.created_at); m.set(k, [...(m.get(k) ?? []), n]); });
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [items]);

  return (
    <div className="anim-rise">
      <TopBar variant="large" title="Alerts" />
      <div className="grid gap-5 px-4 pb-6 pt-1 *:min-w-0">
        {error && (
          <Card variant="outline" padding="sm" className="flex items-center gap-3 text-sm">
            <ShieldAlert size={18} className="shrink-0 text-danger" aria-hidden />
            <span className="min-w-0 flex-1 text-ink-700">{error}</span>
            <Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button>
          </Card>
        )}

        {items === null ? (
          <>
            <Skeleton variant="text" lines={1} className="max-w-[80px]" />
            <Card padding="sm"><Skeleton variant="row" lines={3} /></Card>
            <Skeleton variant="text" lines={1} className="max-w-[80px]" />
            <Card padding="sm"><Skeleton variant="row" lines={2} /></Card>
          </>
        ) : items.length === 0 ? (
          <EmptyState
            size="page" icon={BellOff} title="Nothing here yet"
            sub="When the car is on its way, a child boards, or the school posts a notice, you'll see it here — and on your phone if push alerts are on."
          />
        ) : (
          groups.map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-ink-500">{dayLabel(day)}</h2>
              <Card padding="none" className="divide-y divide-line">
                {list.map((n) => {
                  const ks = kindStyle(n);
                  const Icon = ks.icon;
                  const fresh = freshIds.has(n.id);
                  return (
                    <article key={n.id} className={cn("flex items-start gap-3 px-4 py-3", fresh && "bg-primary-soft/40")}>
                      <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-sm", ks.tile)}><Icon size={18} strokeWidth={2.25} aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className={cn("min-w-0 flex-1 text-base text-ink-900", fresh ? "font-bold" : "font-semibold")}>{n.title}</p>
                          <time className="shrink-0 text-xs text-ink-500 tnum" dateTime={n.created_at}>{fmtTime(n.created_at)}</time>
                        </div>
                        {n.body && <p className="mt-0.5 text-sm text-ink-700 text-pretty">{n.body}</p>}
                        <p className="mt-1 text-xs font-medium text-ink-500">{ks.label}</p>
                      </div>
                    </article>
                  );
                })}
              </Card>
            </section>
          ))
        )}

        {items && items.length > 0 && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500"><CheckCheck size={14} aria-hidden /> Everything above has been marked read.</p>
        )}
      </div>
    </div>
  );
}
