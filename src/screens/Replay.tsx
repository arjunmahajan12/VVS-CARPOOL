// Trip replay — the full ping trail on the map with a scrubber that moves the
// car through time; stops light up as they were reached, and the event list
// highlights as the clock passes each one.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Route, SkipBack } from "lucide-react";
import { api } from "../lib/api";
import { nav } from "../lib/nav";
import { directionLabel, fmtDate, fmtTime } from "../lib/format";
import { bearingDeg, type LatLng } from "../lib/geo";
import type { RideEvent, Stop, StopStatus, TripReplay } from "../lib/types";
import { Button, Card, EmptyState, IconButton, Pill, ProgressRail, SectionTitle, Skeleton, Stat, StatusBadge, TopBar, cn, type RailItem } from "../components/ui";
import { BottomSheet, MapView, SheetHeader, VVS, useSheetInset, type MapStop } from "../components/map";

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Status of a stop as it was at instant t (final missed/skipped stay as they are once reached). */
function statusAt(s: Stop, t: number, events: RideEvent[]): StopStatus {
  if (s.status === "skipped") return "skipped";
  if (s.status === "missed") {
    const ev = events.find((e) => e.type === "missed_pickup" && e.child_id && e.child_id === s.child_id);
    return ev && ms(ev.created_at) <= t ? "missed" : ms(s.arrived_at) <= t ? "arriving" : "pending";
  }
  if (ms(s.done_at) <= t) return "done";
  if (ms(s.stopped_at) <= t) return "stopped";
  if (ms(s.arrived_at) <= t) return "arriving";
  return "pending";
}

export default function Replay({ rideId }: { rideId: string }) {
  const sheet = useSheetInset();
  const [data, setData] = useState<TripReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setI(0); setPlaying(false);
    api.tripReplay(rideId).then((d) => { if (alive) { setData(d); setI(Math.max(0, d.pings.length - 1)); } }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Couldn't load the replay."); });
    return () => { alive = false; };
  }, [rideId]);

  const pings = data?.pings ?? [];
  const n = pings.length;
  const trail = useMemo<LatLng[]>(() => pings.map((p) => [p.lat, p.lng] as LatLng), [pings]);
  const cur = pings[Math.min(i, n - 1)] ?? null;
  const t = cur ? ms(cur.created_at) : NaN;
  const events = data?.events ?? [];
  const stops = data?.stops ?? [];

  // playback: ~1 real second per 40 pings; pauses at the end
  useEffect(() => {
    if (!playing) { if (timer.current != null) window.clearInterval(timer.current); timer.current = null; return; }
    timer.current = window.setInterval(() => setI((x) => { if (x >= n - 1) { setPlaying(false); return x; } return x + 1; }), 120);
    return () => { if (timer.current != null) window.clearInterval(timer.current); timer.current = null; };
  }, [playing, n]);

  const heading = useMemo(() => {
    if (!cur) return null;
    if (cur.heading != null) return cur.heading;
    const prev = pings[Math.max(0, Math.min(i, n - 1) - 1)];
    return prev && (prev.lat !== cur.lat || prev.lng !== cur.lng) ? bearingDeg([prev.lat, prev.lng], [cur.lat, cur.lng]) : null;
  }, [cur, pings, i, n]);
  const mapStops = useMemo<MapStop[]>(() => {
    const live = stops.map((s) => ({ s, st: Number.isFinite(t) ? statusAt(s, t, events) : s.status }));
    const nextId = live.find((x) => x.st === "pending" || x.st === "arriving" || x.st === "stopped")?.s.id;
    return live.map(({ s, st }) => ({ id: s.id, seq: s.seq, lat: s.lat, lng: s.lng, kind: s.kind, status: st, label: s.label, sub: s.sub, etaMin: null, isNext: s.id === nextId && i < n - 1 }));
  }, [stops, t, events, i, n]);
  const rail: RailItem[] = mapStops.map((m) => { const s = stops.find((x) => x.id === m.id)!; return { id: m.id, seq: m.seq, label: m.label, sub: m.status === "done" && s.done_at ? `${s.sub ? s.sub + " · " : ""}${fmtTime(s.done_at)}` : s.sub ?? undefined, status: m.status, delayMin: s.delay_min, isNext: m.isNext }; });
  const travelled = trail.slice(0, Math.min(i, n - 1) + 1);
  const ahead = trail.slice(Math.min(i, n - 1));
  const car = cur ? { lat: cur.lat, lng: cur.lng, heading } : null;
  const center: [number, number] = car ? [car.lat, car.lng] : stops[0] ? [stops[0].lat, stops[0].lng] : VVS;
  const ride = data?.ride ?? null;
  const missed = stops.filter((s) => s.status === "missed").length;
  const startT = ms(ride?.started_at), elapsed = Number.isFinite(t) && Number.isFinite(startT) ? Math.max(0, Math.round((t - startT) / 60000)) : null;

  return (
    <div className="relative h-dvh overflow-hidden bg-bg">
      <div className="absolute inset-0">
        <MapView className="h-full w-full" center={center} zoom={14} stops={mapStops} route={ahead.length > 1 ? ahead : trail} travelled={travelled.length > 1 ? travelled : null} car={car} follow={playing} padding={{ bottom: sheet.inset, top: 72 }} />
      </div>
      <TopBar variant="map" onBack={() => nav.back()} title={ride?.carpool?.name ?? "Trip replay"} sub={ride ? `${directionLabel(ride.direction)} · ${fmtDate(ride.started_at, { weekday: "short", day: "numeric", month: "short" })}` : undefined} />

      <BottomSheet
        snapPoints={[0.3, 0.55, 0.92]} initial={1} {...sheet.bind}
        header={
          <SheetHeader
            title={cur ? <span className="tnum">{fmtTime(cur.created_at)}{elapsed != null ? <span className="ml-2 text-sm font-medium text-ink-500">+{elapsed} min</span> : null}</span> : "Replay"}
            sub={cur ? `${cur.speed_kmh != null ? `${Math.round(cur.speed_kmh)} km/h · ` : ""}ping ${Math.min(i, n - 1) + 1} of ${n}` : undefined}
            right={ride ? (ride.on_time === true ? <Pill tone="ok" dot>On time</Pill> : ride.on_time === false ? <Pill tone="warn" dot>Late</Pill> : <Pill tone={ride.status === "completed" ? "ok" : "neutral"} dot>{ride.status === "completed" ? "Completed" : ride.status}</Pill>) : null}
          />
        }
      >
        {error ? (
          <EmptyState icon={Route} title="Couldn't load this replay" sub={error} action={<Button size="sm" variant="soft" onClick={() => nav.back()}>Back</Button>} />
        ) : !data ? (
          <div className="grid gap-3 *:min-w-0"><Skeleton variant="block" size={56} /><Skeleton variant="row" lines={3} /></div>
        ) : n === 0 ? (
          <EmptyState icon={Route} title="No location trail" sub="This trip has no GPS pings to replay." />
        ) : (
          <div className="grid gap-4 pb-2 *:min-w-0">
            {/* scrubber */}
            <Card padding="sm" className="grid gap-2 *:min-w-0">
              <div className="flex items-center gap-2">
                <IconButton icon={SkipBack} label="Back to start" size="sm" onClick={() => { setPlaying(false); setI(0); }} />
                <IconButton icon={playing ? Pause : Play} label={playing ? "Pause" : "Play"} variant="primary" size="sm" onClick={() => { if (!playing && i >= n - 1) setI(0); setPlaying((p) => !p); }} />
                <input
                  type="range" min={0} max={Math.max(0, n - 1)} value={Math.min(i, n - 1)} aria-label="Scrub through the trip"
                  onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }}
                  className="h-2 min-w-0 flex-1 cursor-pointer accent-[var(--color-primary)]"
                />
              </div>
              <div className="tnum flex justify-between text-xs text-ink-500"><span>{fmtTime(pings[0].created_at)}</span><span>{fmtTime(pings[n - 1].created_at)}</span></div>
            </Card>

            <div className="grid grid-cols-3 gap-2 *:min-w-0">
              <Stat size="sm" label="Duration" value={ride?.actual_duration_min ?? "—"} unit="min" />
              <Stat size="sm" label="Distance" value={ride?.distance_km ?? "—"} unit="km" tone="primary" />
              <Stat size="sm" label="Missed" value={missed} tone={missed ? "danger" : "ok"} />
            </div>

            <section>
              <SectionTitle variant="eyebrow" count={stops.length}>Stops</SectionTitle>
              <ProgressRail items={rail} dense />
            </section>

            <section>
              <SectionTitle variant="eyebrow" count={events.length}>Events</SectionTitle>
              <ol className="m-0 grid list-none gap-1 p-0">
                {events.map((e) => {
                  const passed = Number.isFinite(t) && ms(e.created_at) <= t;
                  const bad = e.type === "missed_pickup" || e.type === "route_alert" || e.type.startsWith("anomaly");
                  return (
                    <li key={e.id} className={cn("flex items-start gap-3 rounded-sm px-2 py-1.5 transition-colors", passed ? "bg-card-2" : "opacity-45")}>
                      <span className="tnum w-16 shrink-0 text-xs text-ink-500 pt-0.5">{fmtTime(e.created_at)}</span>
                      <span className={cn("min-w-0 flex-1 text-sm text-pretty", bad ? "font-semibold text-danger-ink" : "text-ink-900")}>{e.note ?? e.type.replace(/_/g, " ")}</span>
                      {e.type === "boarded" && <StatusBadge status="done" size="sm">Boarded</StatusBadge>}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
