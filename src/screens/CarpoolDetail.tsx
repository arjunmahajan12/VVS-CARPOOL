// Carpool detail — two routes, chosen explicitly (never by the clock):
// before 11:00 IST it's the school run, organiser's home first → other homes
// → school; after, school → drops → organiser's home) with numbered stops,
// and a sheet with the live banner, punctuality stats, riders + absences,
// members, chat, and the organiser-household controls (start / delete).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Car, Check, Clock3, MessageCircle, Phone, Play, Radio, ShieldCheck, Trash2, UserRound, Users, X } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { keepFresh } from "../lib/bus";
import { nav } from "../lib/nav";
import { classLabel, directionLabel, fmtTime } from "../lib/format";
import { getRoute } from "../lib/routing";
import { optimalOrder } from "../lib/optimize";
import { startTripSmart } from "../lib/tripStart";
import type { Carpool, Member, Rider, School, TripDriver } from "../lib/types";
import { Avatar, Button, Card, Chip, Divider, EmptyState, ListRow, LiveBadge, Pill, ProgressRail, SectionTitle, SegmentedControl, Skeleton, Sparkline, Stat, StatusBadge, TopBar, useConfirm, useToast, cn, type RailItem } from "../components/ui";
import { BottomSheet, MapView, SheetHeader, VVS, useSheetInset, type MapStop, type MapPin } from "../components/map";

interface Preview { stops: MapStop[]; route: [number, number][]; km: number | null; min: number | null; road: boolean }

/** Group riders into one stop per household, ordered for today's direction. */
function planStops(c: Carpool, school: School, direction: "to_school" | "from_school"): MapStop[] {
  const riders = c.riders ?? [];
  const byParent = new Map<string, Rider[]>();
  riders.forEach((r) => { if (r.home_lat != null && r.home_lng != null) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]); });
  const households = [...byParent.entries()].map(([pid, rs]) => ({
    id: pid, name: rs.map((r) => r.child_name.split(" ")[0]).join(" & "), lat: rs[0].home_lat as number, lng: rs[0].home_lng as number,
    absent: rs.every((r) => r.absent), sub: rs[0].colony ?? rs[0].parent_name,
  }));
  const org = households.find((h) => h.id === c.creator_id) ?? null;
  const orgMember = c.members.find((m) => m.parent_id === c.creator_id);
  const orgHome = org ? { lat: org.lat, lng: org.lng } : orgMember?.home_lat != null && orgMember.home_lng != null ? { lat: orgMember.home_lat, lng: orgMember.home_lng } : null;
  const others = households.filter((h) => h.id !== c.creator_id);
  const active = others.filter((h) => !h.absent), absent = others.filter((h) => h.absent);
  const gate = { lat: school.lat, lng: school.lng };
  const out: MapStop[] = [];
  let seq = 0;
  const push = (kind: MapStop["kind"], lat: number, lng: number, label: string, sub: string | null | undefined, status: MapStop["status"] = "pending") =>
    out.push({ id: `${kind}:${seq + 1}:${label}`, seq: ++seq, kind, lat, lng, label, sub, status });
  if (direction === "to_school") {
    if (org) push("pickup", org.lat, org.lng, org.name, `Organiser · ${org.sub}`, org.absent ? "skipped" : "pending");
    const ordered = optimalOrder(active, orgHome ?? gate, gate, null);
    ordered.forEach((o) => { const h = active.find((x) => x.id === o.id)!; push("pickup", h.lat, h.lng, h.name, h.sub); });
    absent.forEach((h) => push("pickup", h.lat, h.lng, h.name, `${h.sub} · absent today`, "skipped"));
    push("school", gate.lat, gate.lng, school.name, "Everyone reaches school");
  } else {
    push("school", gate.lat, gate.lng, school.name, "Pickup at the gate");
    const ordered = optimalOrder(active, gate, null, null);
    ordered.forEach((o) => { const h = active.find((x) => x.id === o.id)!; push("drop", h.lat, h.lng, h.name, h.sub); });
    absent.forEach((h) => push("drop", h.lat, h.lng, h.name, `${h.sub} · absent today`, "skipped"));
    if (orgHome) push("home_end", orgHome.lat, orgHome.lng, org ? `${org.name} · home` : "Organiser's home", "Trip ends here");
  }
  return out;
}

export default function CarpoolDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const u = user!;
  const toast = useToast();
  const confirm = useConfirm();
  const sheet = useSheetInset();
  const [c, setC] = useState<Carpool | null>(null);
  const [school, setSchool] = useState<School | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [drivers, setDrivers] = useState<TripDriver[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [snap, setSnap] = useState<number | undefined>(undefined);
  const previewKey = useRef("");
  const [direction, setDirection] = useState<"to_school" | "from_school">("to_school");
  const myHousehold = u.parent_owner_id ?? u.id;

  const load = useCallback(async () => {
    try {
      const [cp, sch] = await Promise.all([api.getCarpool(id), api.getSchool()]);
      setC(cp); setSchool(sch); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load this carpool."); }
  }, [id]);
  useEffect(() => keepFresh(load, 12000), [load]);

  // Route preview: recomputed only when the stop set (or direction) changes.
  const planned = useMemo(() => (c && school ? planStops(c, school, direction) : []), [c, school, direction]);
  useEffect(() => {
    if (!school || !planned.length) return;
    const key = planned.map((s) => `${s.kind}@${s.lat.toFixed(4)},${s.lng.toFixed(4)}:${s.status}`).join("|");
    if (key === previewKey.current) return;
    previewKey.current = key;
    let alive = true;
    const drive = planned.filter((s) => s.status !== "skipped");
    const fromSchool = direction === "from_school";
    // getRoute wants the homes (in order) and appends/prepends the gate itself
    const homes = drive.filter((s) => s.kind !== "school").map((s) => ({ id: s.id, name: s.label, lat: s.lat, lng: s.lng }));
    setPreview((p) => (p ? { ...p, stops: planned } : null));
    getRoute(homes, school, true, fromSchool)
      .then((r) => { if (alive) setPreview({ stops: planned, route: r.geometry, km: r.distanceKm, min: r.durationMin, road: r.road }); })
      .catch(() => { if (alive) setPreview({ stops: planned, route: [], km: null, min: null, road: false }); });
    return () => { alive = false; };
  }, [planned, school, direction]);

  const ride = c?.active_ride ?? null;
  const isOrgHousehold = !!c?.is_org_household;
  // Who may start a trip: the organising parent, or their CONFIRMED family driver.
  // Other add-ons (grandparents, helpers) follow the trip but never start one.
  const canStart = isOrgHousehold && (u.role === "parent" || (u.relation === "driver" && u.driver_status === "verified"));
  const riders = c?.riders ?? [];
  const joined = c?.joined ?? [];
  const invited = (c?.members ?? []).filter((m) => m.status === "invited");
  const requested = (c?.members ?? []).filter((m) => m.status === "requested");
  const stats = c?.stats ?? null;

  const pins = useMemo<MapPin[]>(() => (school && !planned.length ? [{ id: "school", kind: "school", lat: school.lat, lng: school.lng, label: school.name }] : []), [school, planned.length]);
  const center: [number, number] = school ? [school.lat, school.lng] : VVS;

  async function openStart() {
    if (!c || !school) return;
    setStarting(true);
    try {
      const list = await api.tripDrivers(id);
      const confirmed = list.filter((d) => d.confirmed);
      // A confirmed driver starting the trip is driving it — no need to ask.
      const self = confirmed.find((d) => d.id === u.id);
      if (self && u.relation === "driver") { await doStart(self.id); return; }
      if (confirmed.length === 1) { await doStart(confirmed[0].id); return; }
      setDrivers(list);
      setChosen((list.find((d) => d.id === u.id && d.confirmed) ?? confirmed[0])?.id ?? "");
      setSnap(2);
    } catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't load drivers."); }
    finally { setStarting(false); }
  }
  async function doStart(driverId: string) {
    if (!c || !school) return;
    setStarting(true);
    try {
      const orgMember = c.members.find((m) => m.parent_id === c.creator_id);
      const creatorHome = orgMember?.home_lat != null && orgMember.home_lng != null ? { lat: orgMember.home_lat, lng: orgMember.home_lng } : null;
      const r = await startTripSmart({ carpoolId: id, driverUserId: driverId, creatorFamilyId: c.creator_id, riders, school, creatorHome, direction });
      setDrivers(null);
      toast.ok(r.direction === "from_school" ? "Home run started — school → homes." : "School run started — homes → school.");
      nav.go({ name: "trip", rideId: r.id });
    } catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't start the trip."); }
    finally { setStarting(false); }
  }
  async function toggleAbsent(r: Rider) {
    setBusy(`abs:${r.child_id}`);
    try { const cp = await api.setAbsence(id, r.child_id, !r.absent); setC(cp); toast(r.absent ? `${r.child_name} is travelling today.` : `${r.child_name} marked absent today — the stop will be skipped.`); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't update."); }
    finally { setBusy(null); }
  }
  async function respondRequest(m: Member, accept: boolean) {
    setBusy(`req:${m.parent_id}`);
    try { const cp = await api.respondJoinRequest(id, m.parent_id, accept); setC(cp); toast[accept ? "ok" : "info"](accept ? `${m.parent_name} joined.` : "Request declined."); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't respond."); }
    finally { setBusy(null); }
  }
  async function respondInvite(accept: boolean) {
    setBusy("invite");
    try { const cp = await api.respondInvite(id, accept); setC(cp); toast[accept ? "ok" : "info"](accept ? `You've joined "${cp.name}".` : "Invite declined."); if (!accept) nav.back(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't respond."); }
    finally { setBusy(null); }
  }
  // Another joined family with a car — the only kind an organiser can hand over to.
  const successor = c?.joined.find((m) => m.parent_id !== c.creator_id && m.can_drive !== false) ?? null;
  async function leave() {
    const msg = c?.is_creator
      ? (successor
          ? `${successor.parent_name}'s household will take over as organiser and drive every trip from now on. You'll stop seeing this carpool's trips and chat.`
          : "No other family here has a car, so the carpool would close for everyone. Delete it instead, or invite a car-owning family first.")
      : "You'll stop seeing its trips and chat. You can request a seat again later.";
    if (!(await confirm({ title: c?.is_creator ? "Hand over and leave?" : "Leave this carpool?", message: msg, confirmLabel: c?.is_creator ? "Hand over & leave" : "Leave" }))) return;
    setBusy("leave");
    try { await api.leaveCarpool(id); toast("You left the carpool."); nav.back(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't leave."); setBusy(null); }
  }
  async function remove() {
    if (!c) return;
    if (!(await confirm({ title: "Delete this carpool?", message: `"${c.name}" will be removed for every member along with its trip plan. Trip history stays with the school. This cannot be undone.`, confirmLabel: "Delete carpool", icon: Trash2 }))) return;
    setBusy("delete");
    try { await api.deleteCarpool(id); toast("Carpool deleted."); nav.tab("carpools"); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't delete."); setBusy(null); }
  }

  const railItems: RailItem[] = (preview?.stops ?? planned).map((s) => ({ id: s.id, seq: s.seq, label: s.label, sub: s.sub ?? undefined, status: s.status }));
  const trend = (stats?.trend ?? []).map((t) => t.duration_min ?? 0).filter((n) => n > 0);

  return (
    <div className="relative h-dvh overflow-hidden bg-bg">
      <div className="absolute inset-0">
        <MapView className="h-full w-full" center={center} zoom={13} pins={pins} stops={preview?.stops ?? planned} route={preview?.route ?? null} padding={{ bottom: sheet.inset, top: 72 }} />
      </div>
      <TopBar variant="map" title={c?.name ?? "Carpool"} sub={c ? `${directionLabel(direction)} preview · ${preview?.km != null ? `${preview.km} km · ~${preview.min} min` : "routing…"}` : undefined} onBack={() => nav.back()} />

      <BottomSheet
        snapPoints={[0.22, 0.5, 0.92]} initial={1} snap={snap} onSnap={() => setSnap(undefined)} {...sheet.bind}
        header={
          <SheetHeader
            title={c ? c.name : "Loading…"}
            sub={c ? `${c.creator_name ? `${c.creator_name} drives` : "Organiser"} · ${c.seats_used ?? riders.length}/${c.seats ?? "—"} seats${c.driver_vehicle ? ` · ${c.driver_vehicle}` : ""}` : undefined}
            right={ride ? <LiveBadge /> : c ? <Pill tone={direction === "to_school" ? "primary" : "info"} dot>{directionLabel(direction)}</Pill> : undefined}
          />
        }
      >
        {error && !c ? (
          <EmptyState icon={Car} title="Couldn't open this carpool" sub={error} action={<Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button>} />
        ) : !c ? (
          <div className="grid gap-3 *:min-w-0"><Skeleton variant="card" /><Skeleton variant="row" lines={3} /></div>
        ) : (
          <div className="grid gap-4 pb-2 *:min-w-0">
            {ride && (
              <Card variant="hero" padding="md" onClick={() => nav.go({ name: "trip", rideId: ride.id })}>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-white/15 text-accent"><Radio size={22} strokeWidth={2.25} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-md font-bold text-white">{directionLabel(ride.direction)} in progress</p>
                    <p className="truncate text-sm text-white/75">{ride.driver_name ?? "Driver"} · started {fmtTime(ride.started_at)} · tap to track live</p>
                  </div>
                  <Button size="sm" variant="accent">Open</Button>
                </div>
              </Card>
            )}

            {c.my_status === "invited" && (
              <Card padding="md" className="grid gap-3 *:min-w-0">
                <p className="text-base font-semibold text-ink-900">{c.creator_name ?? "The organiser"} invited your family</p>
                <p className="text-sm text-ink-500">Accept to see this carpool's trips live and get boarding alerts for your child.</p>
                <div className="grid grid-cols-2 gap-2 *:min-w-0"><Button variant="ghost" icon={X} loading={busy === "invite"} onClick={() => respondInvite(false)}>Decline</Button><Button icon={Check} loading={busy === "invite"} onClick={() => respondInvite(true)}>Accept</Button></div>
              </Card>
            )}

            {/* driver picker */}
            {drivers && (
              <Card padding="md" className="grid gap-3 *:min-w-0">
                <div><p className="font-display text-md font-bold text-ink-950">Who's driving?</p><p className="text-sm text-ink-500">Only the organiser's household drives this carpool.</p></div>
                <div className="grid gap-2 *:min-w-0">
                  {drivers.map((d) => (
                    <button key={d.id} type="button" disabled={!d.confirmed} onClick={() => setChosen(d.id)} aria-pressed={chosen === d.id}
                      className={cn("flex items-center gap-3 rounded-md p-3 text-left transition-colors", chosen === d.id ? "bg-primary-soft ring-2 ring-primary" : "hairline", !d.confirmed && "opacity-50")}>
                      <Avatar name={d.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-semibold text-ink-900">{d.name}</span>
                        <span className="block truncate text-sm text-ink-500">{d.kind === "driver" ? `Family driver${d.vehicle ? ` · ${d.vehicle}` : ""}` : "Parent"}{!d.confirmed && " · not confirmed yet"}</span>
                      </span>
                      {d.confirmed ? <ShieldCheck size={18} className="shrink-0 text-ok" aria-hidden /> : null}
                    </button>
                  ))}
                  {drivers.length === 0 && <EmptyState icon={UserRound} title="No driver set up" sub="Add a car in Profile, or confirm a family driver." />}
                </div>
                <div className="grid grid-cols-2 gap-2 *:min-w-0"><Button variant="ghost" onClick={() => setDrivers(null)}>Cancel</Button><Button icon={Play} disabled={!chosen} loading={starting} onClick={() => doStart(chosen)}>Start trip</Button></div>
              </Card>
            )}

            {/* route picker: two separate routes, chosen explicitly */}
            {!ride && (
              <SegmentedControl
                label="Route"
                full
                value={direction}
                onChange={(v) => setDirection(v)}
                options={[{ value: "to_school" as const, label: "To school" }, { value: "from_school" as const, label: "To home" }]}
              />
            )}

            {/* organiser household: start trip */}
            {!ride && canStart && !drivers && (
              <Card padding="md" className="grid gap-3 *:min-w-0">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-soft-ink"><Clock3 size={20} strokeWidth={2.25} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-ink-900">Start the {directionLabel(direction).toLowerCase()}</p>
                    <p className="text-sm text-ink-500">{direction === "to_school" ? "Collects from your home first, then the others in road order, to school." : "From the school gate, drops in road order, ending at your home."} Children check in by stop-detection.</p>
                    <p className="tnum mt-1 text-xs text-ink-500">Tracking starts automatically from the phone that starts the trip{u.phone ? ` · parents will call ${u.phone}` : " · add your mobile number in Profile so parents can call you"}.</p>
                  </div>
                </div>
                <Button size="lg" variant="accent" icon={Play} loading={starting} onClick={openStart} full>Start {directionLabel(direction).toLowerCase()}</Button>
              </Card>
            )}

            {/* route: two separate plans, organiser picks which to run */}
            <section>
              <SectionTitle variant="eyebrow" action={preview?.road === false && preview.route.length ? <Pill size="sm" tone="warn">straight-line estimate</Pill> : undefined}>Route · {directionLabel(direction)}</SectionTitle>
              {railItems.length ? <ProgressRail items={railItems} dense /> : <p className="text-sm text-ink-500">No homes pinned yet — riders appear once families join.</p>}
            </section>

            {/* stats */}
            {stats && stats.trips > 0 && (
              <section>
                <SectionTitle variant="eyebrow" count={stats.trips}>Punctuality</SectionTitle>
                <div className="grid grid-cols-2 gap-2 *:min-w-0">
                  <Stat size="sm" label="On time" value={stats.on_time_pct != null ? Math.round(stats.on_time_pct) : "—"} unit="%" tone="ok" chart={stats.trend.filter((t) => t.on_time != null).length > 1 ? <Sparkline fluid height={26} values={stats.trend.filter((t) => t.on_time != null).map((t) => (t.on_time ? 1 : 0))} domain={[0, 1]} last={false} /> : undefined} />
                  <Stat size="sm" label="Avg pickup delay" value={stats.avg_pickup_delay_min != null ? (stats.avg_pickup_delay_min > 0 ? "+" : "") + Math.round(stats.avg_pickup_delay_min) : "—"} unit="min" tone={(stats.avg_pickup_delay_min ?? 0) > 5 ? "warn" : "primary"} chart={stats.trend.length > 1 ? <Sparkline fluid height={26} values={stats.trend.map((t) => t.delay_min ?? 0)} /> : undefined} />
                  <Stat size="sm" label="Missed stops" value={stats.missed_rate != null ? Math.round(stats.missed_rate * 100) : "—"} unit="%" tone={(stats.missed_rate ?? 0) > 0 ? "danger" : "neutral"} />
                  <Stat size="sm" label="Avg duration" value={stats.avg_duration_min != null ? Math.round(stats.avg_duration_min) : "—"} unit="min" chart={trend.length > 1 ? <Sparkline fluid height={26} values={trend} /> : undefined} />
                </div>
              </section>
            )}

            {/* riders */}
            <section>
              <SectionTitle variant="eyebrow" count={riders.length}>Riders</SectionTitle>
              {riders.length === 0 ? (
                <p className="text-sm text-ink-500">No children yet.</p>
              ) : (
                <Card padding="none" className="divide-y divide-line px-4">
                  {riders.map((r) => {
                    const mine = r.parent_id === myHousehold;
                    return (
                      <div key={r.child_id} className={cn("flex items-center gap-3 py-3", r.absent && "opacity-70")}>
                        <Avatar name={r.child_name} size="md" src={r.photo_url} tone={mine ? "primary" : "auto"} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold text-ink-900">{r.child_name}</p>
                          <p className="truncate text-sm text-ink-500">{classLabel(r.class_level)} · {r.parent_name}{r.colony ? ` · ${r.colony}` : ""}</p>
                        </div>
                        {ride && !r.absent ? <StatusBadge rider={r.status} /> : r.absent ? <Pill tone="neutral">Absent today</Pill> : null}
                        {mine && (
                          <Chip size="sm" selected={r.absent} disabled={busy === `abs:${r.child_id}`} onClick={() => toggleAbsent(r)} aria-label={r.absent ? `Mark ${r.child_name} travelling` : `Mark ${r.child_name} absent today`}>
                            {r.absent ? "Travelling" : "Absent?"}
                          </Chip>
                        )}
                      </div>
                    );
                  })}
                </Card>
              )}
            </section>

            {/* members */}
            <section>
              <SectionTitle variant="eyebrow" count={joined.length}>Families</SectionTitle>
              <Card padding="none" className="divide-y divide-line px-4">
                {joined.map((m) => (
                  <ListRow key={m.parent_id} leading={<Avatar name={m.parent_name} size="md" />} title={m.parent_name} sub={[m.phone, m.colony].filter(Boolean).join(" · ") || undefined}
                    trailing={<>{m.role === "creator" && <Pill size="sm" tone="primary">Organiser</Pill>}{m.phone && m.parent_id !== u.id && <a href={`tel:${m.phone}`} aria-label={`Call ${m.parent_name}`} className="grid h-9 w-9 place-items-center rounded-sm bg-ink-100 text-ink-700"><Phone size={16} aria-hidden /></a>}</>} chevron={false} />
                ))}
                {c.is_creator && requested.map((m) => (
                  <div key={m.parent_id} className="flex items-center gap-3 py-3">
                    <Avatar name={m.parent_name} size="md" />
                    <div className="min-w-0 flex-1"><p className="truncate text-base font-semibold text-ink-900">{m.parent_name}</p><p className="truncate text-sm text-ink-500">Requested a seat{m.colony ? ` · ${m.colony}` : ""}</p></div>
                    <Button size="sm" variant="ghost" loading={busy === `req:${m.parent_id}`} onClick={() => respondRequest(m, false)}>Decline</Button>
                    <Button size="sm" loading={busy === `req:${m.parent_id}`} onClick={() => respondRequest(m, true)}>Approve</Button>
                  </div>
                ))}
                {invited.map((m) => (
                  <ListRow key={m.parent_id} leading={<Avatar name={m.parent_name} size="md" tone="neutral" />} title={m.parent_name} sub="Invited — not yet accepted" trailing={<Pill size="sm" tone="accent">Invited</Pill>} chevron={false} className="opacity-70" />
                ))}
              </Card>
            </section>

            {(c.is_creator || c.my_status === "joined") && (
              <Card padding="none" className="px-4">
                <ListRow leading={<span className="grid h-10 w-10 place-items-center rounded-md bg-info-soft text-info-ink"><MessageCircle size={20} aria-hidden /></span>} title="Carpool chat" sub="Running late, swaps, quick notes" onClick={() => nav.go({ name: "chat", carpoolId: id })} />
              </Card>
            )}

            {(c.is_creator || c.my_status === "joined") && (
              <>
                <Divider spacing="sm" />
                <div className="grid gap-2 *:min-w-0">
                  {c.is_creator ? (
                    <>
                      <Button variant="ghost" disabled={!!ride || !successor} loading={busy === "leave"} onClick={leave} full>Hand over & leave</Button>
                      {!successor && !ride && <p className="text-center text-xs text-ink-500">To leave, another family with a car must be in the carpool — otherwise delete it.</p>}
                      <Button variant="danger" icon={Trash2} disabled={!!ride} loading={busy === "delete"} onClick={remove} full>Delete carpool</Button>
                      {ride && <p className="text-center text-xs text-ink-500">End the live trip before leaving or deleting.</p>}
                    </>
                  ) : (
                    <Button variant="ghost" disabled={!!ride} loading={busy === "leave"} onClick={leave} full>Leave carpool</Button>
                  )}
                </div>
              </>
            )}
            <p className="flex items-center gap-1.5 text-xs text-ink-500"><Users size={12} aria-hidden /> One carpool, one driving family — {c.creator_name ?? "the organiser"}'s household drives every trip.</p>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
