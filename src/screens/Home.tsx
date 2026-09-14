// Home — the parent's morning glance: live trip hero (if any), today's
// quick actions, my carpools, latest alerts, and a
// one-time push nudge. Pending / rejected families see a friendly holding state.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellRing, Car, ChevronRight, Compass, Hourglass, MapPin, Navigation, ShieldAlert, Users, X } from "lucide-react";
import { useAuth } from "../context/auth";
import { api, MODE } from "../lib/api";
import { isDemoAccount } from "../lib/demoAccounts";
import { keepFresh } from "../lib/bus";
import { nav } from "../lib/nav";
import { directionLabel, firstName, fmtTime, greeting, timeAgo } from "../lib/format";
import { pushPermission, subscribePush } from "../lib/push";
import type { Carpool, Notification, Ride, Stop } from "../lib/types";
import { Avatar, AvatarStack, Button, Card, EmptyState, IconButton, LiveBadge, Pill, SectionTitle, Skeleton, TopBar, useToast, cn } from "../components/ui";
import { MapView, VVS, type MapStop } from "../components/map";

const NUDGE_KEY = "vvs.pushNudge.v1";

function nextStopOf(ride: Ride): Stop | null {
  const stops = ride.stops ?? [];
  return stops.find((s) => s.status === "arriving" || s.status === "stopped") ?? stops.find((s) => s.status === "pending") ?? null;
}

function LiveHero({ ride }: { ride: Ride }) {
  const next = nextStopOf(ride);
  const car = ride.last_lat != null && ride.last_lng != null ? { lat: ride.last_lat, lng: ride.last_lng, heading: ride.last_heading ?? null } : null;
  const stops = ride.stops ?? [];
  const done = stops.filter((s) => s.status === "done").length;
  const mapStops: MapStop[] = useMemo(() => stops.map((s) => ({
    id: s.id, seq: s.seq, lat: s.lat, lng: s.lng, kind: s.kind, status: s.status, label: s.label, sub: s.sub, etaMin: s.eta_min, isNext: next?.id === s.id,
  })), [stops, next?.id]);
  const center: [number, number] = car ? [car.lat, car.lng] : next ? [next.lat, next.lng] : VVS;
  const eta = next?.eta_min ?? null;
  const open = () => nav.go({ name: "trip", rideId: ride.id });

  return (
    <Card variant="hero" padding="none" className="overflow-hidden">
      <div className="relative h-36">
        <MapView center={center} zoom={14} stops={mapStops} car={car} carEta={eta} follow className="h-full w-full" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-[linear-gradient(to_bottom,transparent,rgb(23_59_122/0.85))]" />
        <div className="absolute left-3 top-3"><LiveBadge>{directionLabel(ride.direction)} · live</LiveBadge></div>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white/75">{ride.carpool?.name ?? "Your carpool"}{ride.driver_name ? ` · ${ride.driver_name}` : ""}</p>
            <p className="mt-0.5 truncate font-display text-lg font-bold leading-6 text-white">
              {next ? (next.kind === "school" ? "Heading to the school gate" : next.kind === "home_end" ? "Heading back home" : `Next: ${next.label}`) : "Finishing up"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs uppercase tracking-wider text-white/70">ETA</p>
            <p className="tnum font-display text-2xl font-bold leading-8 text-accent">{eta != null ? `${eta}` : "—"}<span className="ml-0.5 text-sm text-white/80">min</span></p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="tnum text-sm text-white/80">{done}/{stops.length} stops · started {fmtTime(ride.started_at)}</span>
          <Button variant="accent" size="sm" iconRight={ChevronRight} onClick={open}>Open trip</Button>
        </div>
      </div>
    </Card>
  );
}

function PushNudge({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function enable() {
    setBusy(true);
    const r = await subscribePush(api);
    setBusy(false);
    if (r.ok) toast.ok("Push alerts are on for this device.");
    else if (r.reason === "no-key") toast.info("Push isn't configured in this build — you'll still get alerts in the app inbox.");
    else if (r.reason === "denied") toast.warn("Notifications are blocked in your browser settings.");
    else if (r.reason === "unsupported" || r.reason === "insecure") toast.info("This browser can't do push alerts. Add the app to your home screen or use Chrome.");
    else toast.warn("Couldn't turn on push right now — try again from Settings.");
    onDone();
  }
  return (
    <Card padding="md" className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-soft-ink"><BellRing size={20} strokeWidth={2.25} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink-900">Know the moment the car is near</p>
        <p className="mt-0.5 text-sm text-ink-500">Get a buzz when the car is arriving, when your child boards, and if a pickup is missed.</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" loading={busy} onClick={enable}>Turn on alerts</Button>
          <Button size="sm" variant="ghost" onClick={onDone}>Not now</Button>
        </div>
      </div>
      <IconButton icon={X} label="Dismiss" size="sm" onClick={onDone} className="-mr-2 -mt-2" />
    </Card>
  );
}

function QuickAction({ icon: Icon, label, sub, onClick, tone = "bg-primary-soft text-primary-soft-ink" }: { icon: typeof Compass; label: string; sub: string; onClick: () => void; tone?: string }) {
  return (
    <Card padding="sm" onClick={onClick} className="flex items-center gap-3">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md", tone)}><Icon size={20} strokeWidth={2.25} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-ink-900">{label}</span>
        <span className="block truncate text-xs text-ink-500">{sub}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-300" aria-hidden />
    </Card>
  );
}

export default function Home() {
  const { user } = useAuth();
  const u = user!;
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [pools, setPools] = useState<Carpool[] | null>(null);
  const [notifs, setNotifs] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const approved = u.status === "approved";
  const isAddon = u.role === "addon";
  const canSimulate = MODE === "demo" || isDemoAccount(u.email);

  const load = useCallback(async () => {
    try {
      const [r, p, n] = await Promise.all([api.activeRides(), api.myCarpools(), api.notifications()]);
      setRides(r); setPools(p); setNotifs(n); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your home screen.");
      setRides((x) => x ?? []); setPools((x) => x ?? []); setNotifs((x) => x ?? []);
    }
  }, []);

  // Periodic + focus + app-wide refresh, plus immediate refresh on any notification.
  useEffect(() => keepFresh(load, 15000), [load]);
  useEffect(() => api.onNotifications((n) => { setNotifs((s) => (s ? [n, ...s] : [n])); void load(); }), [load]);

  // Push nudge — once per device, only once approved and only if not decided yet.
  useEffect(() => {
    if (!approved) return;
    let seen = false;
    try { seen = localStorage.getItem(NUDGE_KEY) === "1"; } catch { seen = true; }
    const perm = pushPermission();
    setNudge(!seen && perm === "default");
  }, [approved]);
  const dismissNudge = () => { setNudge(false); try { localStorage.setItem(NUDGE_KEY, "1"); } catch { /* ignore */ } };

  const unread = (notifs ?? []).filter((n) => !n.read);
  const recent = (notifs ?? []).slice(0, 3);
  const live = rides ?? [];
  const canDrive = u.role === "parent" && u.can_drive !== false;

  return (
    <div className="anim-rise">
      <TopBar
        variant="large"
        title={<><span className="text-ink-500 font-medium">{greeting()},</span> {firstName(u.name)}</>}
        left={<Avatar name={u.name} src={u.photo_url} size="md" ring />}
        right={<IconButton icon={Bell} label={unread.length ? `${unread.length} unread alerts` : "Alerts"} dot={unread.length > 0} onClick={() => nav.tab("alerts")} />}
      />

      <div className="grid gap-4 px-4 pb-6 pt-1 *:min-w-0">
        {error && (
          <Card variant="outline" padding="sm" className="flex items-center gap-3 text-sm">
            <ShieldAlert size={18} className="shrink-0 text-danger" aria-hidden />
            <span className="min-w-0 flex-1 text-ink-700">{error}</span>
            <Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button>
          </Card>
        )}

        {/* Holding states for unverified families */}
        {!approved && u.status === "pending" && (
          <Card padding="lg" className="grid gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-md bg-warn-soft text-warn-ink"><Hourglass size={24} strokeWidth={2.25} aria-hidden /></span>
            <div>
              <h2 className="text-lg">Awaiting school verification</h2>
              <p className="mt-1 text-sm text-ink-500 text-pretty">The school office checks every family before they can see neighbours. This usually takes a school day. We'll alert you the moment you're approved.</p>
            </div>
            <ul className="m-0 grid list-none gap-1.5 p-0 text-sm text-ink-700">
              <li className="flex items-center gap-2"><Users size={15} className="text-ink-500" aria-hidden /> Meanwhile, add your other children and family logins.</li>
              <li className="flex items-center gap-2"><MapPin size={15} className="text-ink-500" aria-hidden /> Check your home pin is spot-on for a good pickup route.</li>
            </ul>
            <div className="flex gap-2"><Button size="sm" variant="soft" onClick={() => nav.go({ name: "family" })}>Family</Button><Button size="sm" variant="ghost" onClick={() => nav.tab("profile")}>Profile</Button></div>
          </Card>
        )}
        {u.status === "rejected" && (
          <Card padding="lg" className="grid gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-md bg-danger-soft text-danger-ink"><ShieldAlert size={24} strokeWidth={2.25} aria-hidden /></span>
            <div>
              <h2 className="text-lg">We couldn't verify your family</h2>
              <p className="mt-1 text-sm text-ink-500 text-pretty">The school office wasn't able to match these details to a current student. Please contact the office, or check your details and they'll take another look.</p>
            </div>
            <div className="flex gap-2"><Button size="sm" variant="soft" onClick={() => nav.tab("profile")}>Review my details</Button></div>
          </Card>
        )}

        {/* Live trip(s) */}
        {rides === null ? (
          <Skeleton variant="map" size={220} />
        ) : live.length > 0 ? (
          live.map((r) => <LiveHero key={r.id} ride={r} />)
        ) : null}

        {approved && nudge && <PushNudge onDone={dismissNudge} />}

        {/* Quick actions */}
        {approved && !isAddon && (
          <section>
            <SectionTitle variant="eyebrow">Quick actions</SectionTitle>
            <div className="mt-2 grid gap-2">
              <QuickAction icon={Compass} label="Find neighbours" sub={canDrive ? "Families near you, ranked by road distance" : "Carpools near you with a seat free"} onClick={() => nav.tab("discover")} />
              <QuickAction icon={Car} label="My carpools" sub={pools ? `${pools.filter((p) => p.my_status === "joined" || p.is_creator).length} joined` : "Loading…"} onClick={() => nav.tab("carpools")} tone="bg-ok-soft text-ok-ink" />
              <QuickAction icon={Users} label="Family" sub={`${u.children.length} ${u.children.length === 1 ? "child" : "children"} · ${u.addons.length} add-on${u.addons.length === 1 ? "" : "s"}`} onClick={() => nav.go({ name: "family" })} tone="bg-info-soft text-info-ink" />
            </div>
          </section>
        )}

        {/* My carpools */}
        {approved && (
          <section>
            <SectionTitle variant="eyebrow" action={<button type="button" className="text-sm font-semibold text-primary" onClick={() => nav.tab("carpools")}>See all</button>}>My carpools</SectionTitle>
            <div className="mt-2">
              {pools === null ? (
                <Card padding="sm"><Skeleton variant="row" lines={2} /></Card>
              ) : pools.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={Car}
                    title={isAddon ? "No family carpool yet" : canDrive ? "No carpool yet" : "You're not in a carpool yet"}
                    sub={isAddon ? "Once the parent joins or creates a carpool, its trips appear here." : canDrive ? "Invite a few neighbours and you're set — you'll drive, they'll ride along." : "Ask a neighbour with a car for a seat, or request one from Discover."}
                    action={isAddon ? undefined : <Button size="sm" variant="soft" icon={Compass} onClick={() => nav.tab("discover")}>Find neighbours</Button>}
                  />
                </Card>
              ) : (
                <Card padding="none" className="divide-y divide-line px-4">
                  {pools.map((c) => {
                    const names = c.joined.map((m) => m.parent_name);
                    const status = c.my_status;
                    return (
                      <button key={c.id} type="button" onClick={() => nav.go({ name: "carpool", id: c.id })} className="flex min-h-16 w-full items-center gap-3 py-3 text-left transition-colors hover:bg-ink-50">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-ink"><Car size={20} strokeWidth={2.25} aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-base font-semibold text-ink-900">{c.name}</span>
                            {c.active_ride && <LiveBadge />}
                            {status === "invited" && <Pill tone="accent" size="sm">Invited</Pill>}
                            {status === "requested" && <Pill tone="info" size="sm">Requested</Pill>}
                          </span>
                          <span className="tnum block truncate text-xs text-ink-500">{c.creator_name ? `${c.creator_name}'s car · ` : ""}{c.seats_used ?? c.joined.length}/{c.seats ?? "—"} seats</span>
                        </span>
                        <AvatarStack names={names} size="xs" max={3} />
                        <ChevronRight size={18} className="shrink-0 text-ink-300" aria-hidden />
                      </button>
                    );
                  })}
                </Card>
              )}
            </div>
          </section>
        )}

        {/* Recent alerts */}
        <section>
          <SectionTitle variant="eyebrow" count={unread.length || undefined} action={<button type="button" className="text-sm font-semibold text-primary" onClick={() => nav.tab("alerts")}>Inbox</button>}>Alerts</SectionTitle>
          <div className="mt-2">
            {notifs === null ? (
              <Card padding="sm"><Skeleton variant="row" lines={2} /></Card>
            ) : recent.length === 0 ? (
              <Card><EmptyState icon={Bell} title="All quiet" sub="Trip updates, invites and school notices will land here." /></Card>
            ) : (
              <Card padding="none" className="divide-y divide-line px-4">
                {recent.map((n) => (
                  <button key={n.id} type="button" onClick={() => nav.tab("alerts")} className="flex w-full items-start gap-3 py-3 text-left">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-ink-200" : "bg-accent")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm text-ink-900", !n.read && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-ink-500">{n.body}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-ink-500 tnum">{timeAgo(n.created_at)}</span>
                  </button>
                ))}
              </Card>
            )}
          </div>
        </section>

        {canSimulate && approved && !isAddon && (
          <p className="flex items-center gap-1.5 text-xs text-ink-500"><Navigation size={12} aria-hidden /> Demo: open a carpool and start a trip to see the live card here.</p>
        )}
      </div>
    </div>
  );
}
