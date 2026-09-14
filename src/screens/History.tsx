// Trip history — every completed trip with on-time badge, duration, distance
// and missed stops; tap → Replay.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, History as HistoryIcon, Route } from "lucide-react";
import { api } from "../lib/api";
import { keepFresh } from "../lib/bus";
import { nav } from "../lib/nav";
import { dayLabel, directionLabel, fmtTime, istDayKey } from "../lib/format";
import type { TripSummary } from "../lib/types";
import { Button, Card, EmptyState, Pill, SectionTitle, Skeleton, TopBar, cn } from "../components/ui";

export default function History() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setTrips(await api.tripHistory()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load trip history."); setTrips((t) => t ?? []); }
  }, []);
  useEffect(() => keepFresh(load, 30000), [load]);

  const groups = new Map<string, TripSummary[]>();
  (trips ?? []).forEach((t) => { const k = istDayKey(t.started_at ?? t.ended_at ?? ""); groups.set(k, [...(groups.get(k) ?? []), t]); });
  const days = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1));
  const onTimePct = trips && trips.length ? Math.round((trips.filter((t) => t.on_time).length / trips.filter((t) => t.on_time != null).length || 0) * 100) : null;

  return (
    <div className="anim-rise min-h-dvh">
      <TopBar title="Trip history" sub={trips ? `${trips.length} trips${onTimePct != null && Number.isFinite(onTimePct) ? ` · ${onTimePct}% on time` : ""}` : undefined} onBack={() => nav.back()} />
      <div className="grid gap-4 px-4 pb-6 pt-3 *:min-w-0">
        {error && <Card variant="outline" padding="sm" className="flex items-center gap-3 text-sm"><span className="min-w-0 flex-1 text-ink-700">{error}</span><Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button></Card>}
        {trips === null ? (
          <Card padding="sm"><Skeleton variant="row" lines={4} /></Card>
        ) : trips.length === 0 ? (
          <Card><EmptyState size="page" icon={HistoryIcon} title="No trips yet" sub="Completed trips land here with a full replay of the drive, every stop and the punctuality record." /></Card>
        ) : days.map((d) => (
          <section key={d}>
            <SectionTitle variant="eyebrow">{dayLabel(d)}</SectionTitle>
            <div className="grid gap-2 *:min-w-0">
              {groups.get(d)!.map((t) => {
                const missed = t.missed_count ?? 0;
                return (
                  <Card key={t.id} padding="md" onClick={() => nav.go({ name: "replay", rideId: t.id })}>
                    <div className="flex items-start gap-3">
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md", t.direction === "from_school" ? "bg-info-soft text-info-ink" : "bg-primary-soft text-primary-soft-ink")}><Route size={20} strokeWidth={2.25} aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-base font-semibold text-ink-900">{t.carpool_name}</span>
                          {t.on_time === true && <Pill size="sm" tone="ok" dot>On time</Pill>}
                          {t.on_time === false && <Pill size="sm" tone="warn" dot>Late</Pill>}
                        </div>
                        <p className="tnum mt-0.5 truncate text-sm text-ink-500">{directionLabel(t.direction)} · {fmtTime(t.started_at)}{t.ended_at ? ` – ${fmtTime(t.ended_at)}` : ""}{t.driver_name ? ` · ${t.driver_name}` : ""}</p>
                        <p className="tnum mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-700">
                          {t.duration_min != null && <span><b>{t.duration_min}</b> min</span>}
                          {t.distance_km != null && <span><b>{t.distance_km}</b> km</span>}
                          {t.stops_total != null && <span><b>{t.stops_done ?? 0}</b>/{t.stops_total} stops</span>}
                          <span className={cn(missed > 0 ? "font-semibold text-danger-ink" : "text-ink-500")}>{missed > 0 ? `${missed} missed` : "none missed"}</span>
                        </p>
                      </div>
                      <ChevronRight size={18} className="mt-1 shrink-0 text-ink-300" aria-hidden />
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
