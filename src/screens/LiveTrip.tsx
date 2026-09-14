// Live trip — full-bleed map (car with heading, planned route + travelled
// slice, numbered status stops, fences around the next stop) and a sheet with
// the stop rail. Driver mode shares GPS (or, in demo, simulates the drive);
// parent mode shows their child's status with the "Didn't board?" correction.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Car, CheckCircle2, Clapperboard, Flag, Hand, LocateFixed, MapPin, Navigation, Phone, Radio, Satellite, Square, TrafficCone, Undo2, UserRound, XCircle } from "lucide-react";
import { useAuth } from "../context/auth";
import { api, MODE } from "../lib/api";
import { keepFresh } from "../lib/bus";
import { nav } from "../lib/nav";
import { directionLabel, fmtTime, timeAgo } from "../lib/format";
import { getRoute } from "../lib/routing";
import { splitRouteAtCar, type LatLng } from "../lib/geo";
import { onSimChange, startSimulation, stopIfRide, stopSimulation, type SimState } from "../lib/simulate";
import type { Ride, RideEvent, Rider, Settings, Stop } from "../lib/types";
import { Avatar, Button, Card, EmptyState, IconButton, LiveBadge, Pill, ProgressRail, SectionTitle, Skeleton, StatusBadge, TopBar, formatEta, useConfirm, useToast, cn, type RailItem } from "../components/ui";
import { BottomSheet, MapView, SheetHeader, VVS, useSheetInset, type MapFence, type MapStop } from "../components/map";

const TERMINAL = new Set<Stop["status"]>(["done", "missed", "skipped"]);
const nextOf = (stops: Stop[]) => stops.find((s) => !TERMINAL.has(s.status)) ?? null;

const EVENT_ICON: Record<string, { icon: typeof Radio; cls: string }> = {
  started: { icon: Radio, cls: "bg-accent-soft text-accent-soft-ink" },
  ended: { icon: Flag, cls: "bg-ink-100 text-ink-700" },
  arriving: { icon: Navigation, cls: "bg-warn-soft text-warn-ink" },
  stopped: { icon: MapPin, cls: "bg-accent-soft text-accent-soft-ink" },
  boarded: { icon: CheckCircle2, cls: "bg-ok-soft text-ok-ink" },
  unboarded: { icon: Undo2, cls: "bg-danger-soft text-danger-ink" },
  reached_school: { icon: Flag, cls: "bg-ok-soft text-ok-ink" },
  reached_home: { icon: Flag, cls: "bg-ok-soft text-ok-ink" },
  missed_pickup: { icon: XCircle, cls: "bg-danger-soft text-danger-ink" },
  route_alert: { icon: AlertTriangle, cls: "bg-danger-soft text-danger-ink" },
  anomaly_long_stop: { icon: AlertTriangle, cls: "bg-warn-soft text-warn-ink" },
  anomaly_speed: { icon: AlertTriangle, cls: "bg-warn-soft text-warn-ink" },
};

export default function LiveTrip({ rideId }: { rideId: string }) {
  const { user } = useAuth();
  const u = user!;
  const toast = useToast();
  const confirm = useConfirm();
  const sheet = useSheetInset();
  const [ride, setRide] = useState<Ride | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [events, setEvents] = useState<RideEvent[]>([]);
  const [car, setCar] = useState<{ lat: number; lng: number; heading?: number | null } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [route, setRoute] = useState<LatLng[] | null>(null);
  const [follow, setFollow] = useState(true);
  const [traffic, setTraffic] = useState(false);
  const [ended, setEnded] = useState(false);
  const [sim, setSim] = useState<SimState>({ rideId: null, running: false, step: 0, total: 0 });
  const [gps, setGps] = useState<"off" | "on" | "error">("off");
  const [busy, setBusy] = useState<string | null>(null);
  const routeKey = useRef("");
  const gpsWatch = useRef<number | null>(null);
  const gpsBeat = useRef<number | null>(null);
  const lastFix = useRef<{ lat: number; lng: number; speed: number | null; heading: number | null; at: number } | null>(null);
  const myHousehold = u.parent_owner_id ?? u.id;

  const load = useCallback(async () => {
    try {
      const r = await api.getRide(rideId);
      setRide(r); setStops(r.stops ?? []); setEvents(r.events ?? []); setError(null);
      if (r.last_lat != null && r.last_lng != null) setCar((c) => (c ? c : { lat: r.last_lat as number, lng: r.last_lng as number, heading: r.last_heading ?? null }));
      if (r.status !== "active") setEnded(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load this trip."); }
  }, [rideId]);
  useEffect(() => keepFresh(load, 10000), [load]);
  useEffect(() => { api.getSettings().then(setSettings).catch(() => setSettings(null)); }, []);

  // realtime
  useEffect(() => {
    const offLoc = api.onRideLocation(rideId, (p) => setCar({ lat: p.lat, lng: p.lng, heading: p.heading ?? null }));
    const offStops = api.onRideStops(rideId, (s) => setStops(s));
    const offEv = api.onRideEvents(rideId, (e) => { setEvents((xs) => (xs.some((x) => x.id === e.id) ? xs : [...xs, e])); void load(); });
    const offEnd = api.onRideEnded(rideId, () => {
      stopIfRide(rideId);
      setEnded(true);
      toast.ok("Trip completed — opening the replay.");
      window.setTimeout(() => nav.replace({ name: "replay", rideId }), 900);
    });
    return () => { offLoc(); offStops(); offEv(); offEnd(); };
  }, [rideId, load, toast]);
  useEffect(() => onSimChange(setSim), []);
  // stop GPS when leaving the screen
  useEffect(() => () => stopGps(), []);

  const isDriver = !!ride && (ride.driver_user_id === u.id || !!ride.carpool?.is_org_household);
  const toSchool = ride?.direction !== "from_school";
  const school = ride?.school ?? null;

  // planned road route, once per stop-set
  useEffect(() => {
    if (!ride || !school || !stops.length) return;
    const drive = stops.filter((s) => s.status !== "skipped");
    const key = `${ride.id}:${drive.map((s) => s.id).join(",")}`;
    if (key === routeKey.current) return;
    routeKey.current = key;
    const homes = drive.filter((s) => s.kind !== "school").map((s) => ({ id: s.id, name: s.label, lat: s.lat, lng: s.lng }));
    if (toSchool && ride.origin_lat != null && ride.origin_lng != null) homes.unshift({ id: "origin", name: "Start", lat: ride.origin_lat, lng: ride.origin_lng });
    let alive = true;
    getRoute(homes, school, true, !toSchool).then((r) => { if (alive) setRoute(r.geometry); }).catch(() => { if (alive) setRoute(null); });
    return () => { alive = false; };
  }, [ride, school, stops, toSchool]);

  const next = nextOf(stops);
  const mapStops = useMemo<MapStop[]>(() => stops.map((s) => ({ id: s.id, seq: s.seq, lat: s.lat, lng: s.lng, kind: s.kind, status: s.status, label: s.label, sub: s.sub, etaMin: s.eta_min, isNext: next?.id === s.id })), [stops, next?.id]);
  const { travelled, ahead } = useMemo(() => splitRouteAtCar(route, car), [route, car]);
  const fences = useMemo<MapFence[]>(() => {
    if (!next || !settings) return [];
    const stopM = next.kind === "school" ? settings.school_gate_m : settings.fence_stop_m;
    return [{ lat: next.lat, lng: next.lng, radiusM: settings.fence_near_m, tone: "near" }, { lat: next.lat, lng: next.lng, radiusM: stopM, tone: "stop" }];
  }, [next, settings]);
  const center: [number, number] = car ? [car.lat, car.lng] : next ? [next.lat, next.lng] : school ? [school.lat, school.lng] : VVS;
  const riders: Rider[] = ride?.carpool?.riders ?? [];
  const myRiders = riders.filter((r) => r.parent_id === myHousehold);
  const doneCount = stops.filter((s) => s.status === "done").length;

  // ---- driver: GPS sharing (throttled ~3 s + heartbeat while parked)
  function stopGps() {
    if (gpsWatch.current != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatch.current);
    if (gpsBeat.current != null) window.clearInterval(gpsBeat.current);
    gpsWatch.current = null; gpsBeat.current = null; lastFix.current = null;
    setGps("off");
  }
  function startGps() {
    if (!navigator.geolocation) { toast.warn("This device has no GPS access."); setGps("error"); return; }
    stopSimulation();
    const post = (f: NonNullable<typeof lastFix.current>) => api.postLocation(rideId, f.lat, f.lng, f.speed, f.heading).catch(() => { /* transient */ });
    gpsWatch.current = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        const f = { lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed != null ? Math.round(p.coords.speed * 3.6) : null, heading: p.coords.heading ?? null, at: now };
        if (lastFix.current && now - lastFix.current.at < 3000) { lastFix.current = { ...f, at: lastFix.current.at }; return; }
        lastFix.current = f; void post(f);
      },
      (e) => { setGps("error"); toast.warn(`GPS: ${e.message}`); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );
    // watchPosition goes quiet while parked; stop-detection needs pings DURING the stop
    gpsBeat.current = window.setInterval(() => { const f = lastFix.current; if (f && Date.now() - f.at >= 4500) { lastFix.current = { ...f, at: Date.now() }; void post({ ...f, speed: 0 }); } }, 5000);
    setGps("on");
    toast.ok("Sharing your live location — keep the phone in the car.");
  }

  // ---- demo: simulate the drive along the road route
  function simulate() {
    if (!ride) return;
    const path: LatLng[] = route && route.length > 1 ? route : (() => {
      const pts = stops.filter((s) => s.status !== "skipped").map((s) => [s.lat, s.lng] as LatLng);
      if (toSchool && ride.origin_lat != null && ride.origin_lng != null) pts.unshift([ride.origin_lat, ride.origin_lng]);
      return pts;
    })();
    stopGps();
    const ok = startSimulation({
      rideId, path, stops: stops.filter((s) => s.status !== "skipped").map((s) => ({ lat: s.lat, lng: s.lng })), dwellS: settings?.dwell_s ?? 8,
      onDone: (why) => { if (why === "finished") toast.info("Simulation finished."); },
      onError: (m) => toast.danger(m),
    });
    if (ok) toast("Simulating the drive — the car pulls over at every stop.");
  }

  async function endTrip() {
    const aboard = riders.filter((r) => !r.absent && r.status === "boarded").length;
    const waiting = riders.filter((r) => !r.absent && r.status === "waiting").length;
    const parts = [aboard ? `${aboard} still on board` : "", waiting ? `${waiting} not picked up` : ""].filter(Boolean).join(" and ");
    const ok = await confirm({ title: "End this trip?", message: parts ? `${parts}. Trips normally end by themselves once everyone is accounted for — end it anyway?` : "Trips normally end by themselves once everyone is accounted for. End it now?", confirmLabel: "End trip", icon: Square });
    if (!ok) return;
    setBusy("end");
    try { stopSimulation(); stopGps(); await api.endRide(rideId); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't end the trip."); }
    finally { setBusy(null); }
  }
  async function markBoarded(s: Stop) {
    if (!s.child_id) return;
    setBusy(s.id);
    try { await api.rideBoard(rideId, s.child_id); toast.ok(`${s.child_name ?? s.label} marked on board.`); await load(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't update."); }
    finally { setBusy(null); }
  }
  async function markDropped(s: Stop) {
    if (!s.child_id) return;
    setBusy(s.id);
    try { await api.rideDrop(rideId, s.child_id, "home"); toast.ok(`${s.child_name ?? s.label} marked dropped.`); await load(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't update."); }
    finally { setBusy(null); }
  }
  async function markReachedSchool() {
    setBusy("school");
    try { for (const r of riders.filter((r) => !r.absent && r.status === "boarded")) await api.rideDrop(rideId, r.child_id, "school"); toast.ok("Everyone marked reached school."); await load(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't update."); }
    finally { setBusy(null); }
  }
  async function didntBoard(r: Rider) {
    const ok = await confirm({ title: `${r.child_name} didn't board?`, message: "This reverts the check-in, alerts the driver and the carpool right away, and re-arms the stop so it can be detected again.", confirmLabel: "Yes — not on board", icon: Hand });
    if (!ok) return;
    setBusy(`un:${r.child_id}`);
    try { await api.rideUnboard(rideId, r.child_id); toast.warn("Corrected — the driver has been alerted."); await load(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't correct."); }
    finally { setBusy(null); }
  }

  const rail: RailItem[] = stops.map((s) => {
    let trailing: RailItem["trailing"];
    if (isDriver && !ended && !TERMINAL.has(s.status)) {
      const rs = riders.find((r) => r.child_id === s.child_id)?.status;
      if (s.kind === "pickup" && rs === "waiting") trailing = <Button size="sm" variant="soft" loading={busy === s.id} onClick={() => markBoarded(s)}>Boarded</Button>;
      else if (s.kind === "drop" && rs === "boarded") trailing = <Button size="sm" variant="soft" loading={busy === s.id} onClick={() => markDropped(s)}>Dropped</Button>;
      else if (s.kind === "school" && toSchool && riders.some((r) => r.status === "boarded")) trailing = <Button size="sm" variant="soft" loading={busy === "school"} onClick={markReachedSchool}>At school</Button>;
    }
    return { id: s.id, seq: s.seq, label: s.label, sub: s.sub ?? undefined, status: s.status, etaMin: s.eta_min, delayMin: s.delay_min, isNext: next?.id === s.id, trailing };
  });
  const feed = [...events].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 12);
  const simActive = sim.running && sim.rideId === rideId;
  const sharing = gps === "on" || simActive;

  return (
    <div className="relative h-dvh overflow-hidden bg-bg">
      <div className="absolute inset-0">
        <MapView className="h-full w-full" center={center} zoom={15}
        stops={mapStops} route={ahead.length > 1 ? ahead : route} travelled={travelled.length > 1 ? travelled : null}
        car={car} carEta={next?.eta_min ?? null} fences={fences} follow={follow && !!car} traffic={traffic}
        padding={{ bottom: sheet.inset, top: 72 }}
        onStopTap={(id) => { const s = stops.find((x) => x.id === id); if (s) toast({ title: s.label, message: `${s.sub ?? ""}${s.eta_min != null && !TERMINAL.has(s.status) ? ` · ${formatEta(s.eta_min)}` : ""}`.replace(/^ · /, "") }); }}
      />
      </div>
      <TopBar
        variant="map" onBack={() => nav.back()}
        title={ride?.carpool?.name ?? "Live trip"} sub={ride ? `${directionLabel(ride.direction)} · ${ride.driver_name ?? "Driver"}` : undefined}
        right={<>
          <IconButton icon={TrafficCone} label={traffic ? "Hide traffic" : "Show traffic"} variant={traffic ? "primary" : "card"} className={cn(!traffic && "glass")} onClick={() => setTraffic((t) => !t)} />
          <IconButton icon={LocateFixed} label={follow ? "Stop following the car" : "Follow the car"} variant={follow ? "primary" : "card"} className={cn(!follow && "glass")} onClick={() => setFollow((f) => !f)} />
        </>}
      />

      <BottomSheet
        snapPoints={[0.2, 0.5, 0.92]} initial={1} {...sheet.bind}
        header={
          <SheetHeader
            title={ended ? "Trip completed" : next ? (next.kind === "school" ? "Heading to the school gate" : next.kind === "home_end" ? "Heading back home" : `Next: ${next.label}`) : ride ? "Finishing up" : "Loading…"}
            sub={ride ? `${doneCount}/${stops.length} stops · ${ride.driver_name ?? "Driver"}${ride.driver_vehicle ? ` · ${ride.driver_vehicle}` : ""} · started ${fmtTime(ride.started_at)}` : undefined}
            right={ended ? <Pill tone="ok" dot>Done</Pill> : next?.eta_min != null ? <LiveBadge>{formatEta(next.eta_min)}</LiveBadge> : ride ? <LiveBadge /> : null}
          />
        }
      >
        {error && !ride ? (
          <EmptyState icon={Car} title="Couldn't open this trip" sub={error} action={<Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button>} />
        ) : !ride ? (
          <div className="grid gap-3 *:min-w-0"><Skeleton variant="card" /><Skeleton variant="row" lines={3} /></div>
        ) : (
          <div className="grid gap-4 pb-2 *:min-w-0">
            {ended && (
              <Card padding="md" className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ok-soft text-ok-ink"><Flag size={20} aria-hidden /></span>
                <div className="min-w-0 flex-1"><p className="text-base font-semibold text-ink-900">This trip has ended</p><p className="text-sm text-ink-500">{ride.actual_duration_min != null ? `${ride.actual_duration_min} min` : ""}{ride.distance_km != null ? ` · ${ride.distance_km} km` : ""}</p></div>
                <Button size="sm" onClick={() => nav.replace({ name: "replay", rideId })}>Replay</Button>
              </Card>
            )}

            {/* driver mode */}
            {isDriver && !ended && (
              <Card padding="md" className="grid gap-3 *:min-w-0">
                <div className="flex items-start gap-3">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md", sharing ? "bg-accent-soft text-accent-soft-ink" : "bg-ink-100 text-ink-700")}>{simActive ? <Clapperboard size={20} aria-hidden /> : <Satellite size={20} aria-hidden />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-ink-900">{simActive ? "Simulating the drive" : gps === "on" ? "Sharing your location" : "You're driving this trip"}</p>
                    <p className="text-sm text-ink-500">Hands-free: keep the phone in the car. Children check in by themselves when you genuinely stop at their door — driving past never counts.</p>
                  </div>
                </div>
                {simActive && <div className="h-1.5 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${sim.total ? Math.round((sim.step / sim.total) * 100) : 0}%` }} /></div>}
                <div className="grid grid-cols-2 gap-2 *:min-w-0">
                  {gps === "on"
                    ? <Button variant="soft" icon={Square} onClick={stopGps}>Stop sharing</Button>
                    : <Button variant={simActive ? "soft" : "accent"} icon={Satellite} onClick={startGps}>Share GPS</Button>}
                  {MODE === "demo" && (simActive
                    ? <Button variant="ghost" icon={Square} onClick={() => stopSimulation()}>Pause sim</Button>
                    : <Button variant="soft" icon={Clapperboard} onClick={simulate} disabled={!stops.length}>Simulate trip</Button>)}
                </div>
                <Button variant="ghost" icon={Square} loading={busy === "end"} onClick={endTrip} className="text-danger-ink" full>End trip</Button>
              </Card>
            )}

            {/* parent mode: my children */}
            {!isDriver && myRiders.length > 0 && (
              <div className="grid gap-2 *:min-w-0">
                {myRiders.map((r) => {
                  const st = stops.find((s) => s.child_id === r.child_id);
                  const canCorrect = !ended && r.status === "boarded";
                  return (
                    <Card key={r.child_id} padding="md" className="grid gap-3 *:min-w-0">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.child_name} size="lg" src={r.photo_url} tone="primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-md font-bold text-ink-950">{r.child_name}</p>
                          <p className="truncate text-sm text-ink-500">
                            {ended
                              ? (st?.status === "done" ? `${toSchool ? "Reached school" : "Reached home"}${st.done_at ? ` · ${fmtTime(st.done_at)}` : ""}` : st?.status === "missed" ? "Pickup was missed" : st?.status === "skipped" ? "Absent that day" : "Trip ended")
                              : r.absent ? "Absent today" : r.status === "boarded" ? `On board since ${fmtTime(r.boarded_at)}` : r.status === "dropped" ? `Dropped ${fmtTime(r.dropped_at)}` : st && !TERMINAL.has(st.status) && st.eta_min != null ? `Reaches you in ${formatEta(st.eta_min)}` : st?.status === "missed" ? "Pickup missed — call the driver" : "Waiting for pickup"}
                          </p>
                        </div>
                        {ended && st ? <StatusBadge status={st.status} /> : r.absent ? <Pill>Absent</Pill> : st?.status === "missed" ? <StatusBadge status="missed" /> : <StatusBadge rider={r.status} />}
                      </div>
                      <div className="grid grid-cols-2 gap-2 *:min-w-0">
                        {ride.driver_phone ? <Button variant="soft" icon={Phone} onClick={() => { window.location.href = `tel:${ride.driver_phone}`; }}>Call {ride.driver_name?.split(" ")[0] ?? "driver"}</Button> : <Button variant="soft" icon={UserRound} disabled>No driver phone</Button>}
                        <Button variant={canCorrect ? "danger" : "ghost"} icon={Hand} disabled={!canCorrect} loading={busy === `un:${r.child_id}`} onClick={() => didntBoard(r)}>Didn't board?</Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
            {!isDriver && myRiders.length === 0 && ride.driver_phone && (
              <Button variant="soft" icon={Phone} onClick={() => { window.location.href = `tel:${ride.driver_phone}`; }} full>Call {ride.driver_name ?? "the driver"}</Button>
            )}

            {/* stop rail */}
            <section>
              <SectionTitle variant="eyebrow" count={stops.length}>Stops</SectionTitle>
              {stops.length ? <ProgressRail items={rail} /> : <p className="text-sm text-ink-500">No stops on this trip.</p>}
            </section>

            {/* events */}
            <section>
              <SectionTitle variant="eyebrow" count={events.length || undefined}>Timeline</SectionTitle>
              {feed.length === 0 ? <p className="text-sm text-ink-500">Nothing yet.</p> : (
                <ol className="m-0 grid list-none gap-2 p-0">
                  {feed.map((e) => {
                    const m = EVENT_ICON[e.type] ?? { icon: Radio, cls: "bg-ink-100 text-ink-700" };
                    const I = m.icon;
                    return (
                      <li key={e.id} className="flex items-start gap-3">
                        <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm", m.cls)}><I size={15} strokeWidth={2.25} aria-hidden /></span>
                        <span className="min-w-0 flex-1 text-sm text-ink-900 text-pretty">{e.note ?? e.type.replace(/_/g, " ")}</span>
                        <span className="tnum shrink-0 text-xs text-ink-500">{timeAgo(e.created_at)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
