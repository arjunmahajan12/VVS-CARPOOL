// Admin — dashboard (stats + punctuality), verify families, carpools (end a
// stuck trip), incidents, school settings (pin, geofence & anomaly rules,
// bell times, promote year), notices + terms.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Car, CalendarArrowUp, Check, FileText, Gauge, LayoutDashboard, MapPin, Megaphone, Radio, Save, ShieldCheck, Square, TriangleAlert, Users, X } from "lucide-react";
import { api } from "../lib/api";
import { keepFresh } from "../lib/bus";
import { nav, type Route } from "../lib/nav";
import { classLabel, directionLabel, fmtDate, fmtTime, timeAgo } from "../lib/format";
import type { AdminAnalytics, AdminStats, Broadcast, Carpool, Incident, Profile, School, Settings } from "../lib/types";
import { Avatar, Button, Card, Chip, EmptyState, Input, LiveBadge, Pill, SectionTitle, Skeleton, Sparkline, Stat, Textarea, TopBar, useConfirm, useToast, cn } from "../components/ui";
import { LocationPicker } from "../components/map";

type AdminTab = Extract<Route, { name: "admin" }>["tab"];
const TABS: { key: AdminTab; label: string; icon: typeof Users }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "verify", label: "Verify", icon: ShieldCheck },
  { key: "carpools", label: "Carpools", icon: Car },
  { key: "incidents", label: "Incidents", icon: TriangleAlert },
  { key: "settings", label: "Settings", icon: Gauge },
  { key: "notices", label: "Notices", icon: Megaphone },
];
const TITLE: Record<AdminTab, string> = { dashboard: "School dashboard", verify: "Verify families", carpools: "Carpools", incidents: "Incidents", settings: "School settings", notices: "Notices & terms" };

const errMsg = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const pct = (v: number | null | undefined) => (v == null ? "—" : Math.round(v));

export default function Admin({ tab }: { tab: AdminTab }) {
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => { chips.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center" }); }, [tab]);
  return (
    <div className="anim-rise min-h-dvh">
      <TopBar variant="large" title={TITLE[tab]} sub="Vasant Valley · admin" />
      <div ref={chips} className="no-scrollbar -mt-1 flex gap-2 overflow-x-auto px-4 py-2">
        {TABS.map((t) => <Chip key={t.key} size="sm" icon={t.icon} selected={t.key === tab} onClick={() => nav.replace({ name: "admin", tab: t.key })}>{t.label}</Chip>)}
      </div>
      <div className="grid gap-4 px-4 pb-6 pt-2 *:min-w-0">
        {tab === "dashboard" && <Dashboard />}
        {tab === "verify" && <Verify />}
        {tab === "carpools" && <AdminCarpools />}
        {tab === "incidents" && <Incidents />}
        {tab === "settings" && <SchoolSettings />}
        {tab === "notices" && <Notices />}
      </div>
    </div>
  );
}

function ErrorRow({ msg, retry }: { msg: string; retry: () => void }) {
  return <Card variant="outline" padding="sm" className="flex items-center gap-3 text-sm"><AlertTriangle size={18} className="shrink-0 text-danger" aria-hidden /><span className="min-w-0 flex-1 text-ink-700">{msg}</span><Button size="sm" variant="soft" onClick={retry}>Retry</Button></Card>;
}

/* ------------------------------------------------------------ dashboard */
function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [an, setAn] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const [s, a] = await Promise.all([api.adminStats(), api.adminAnalytics()]); setStats(s); setAn(a); setError(null); }
    catch (e) { setError(errMsg(e, "Couldn't load the dashboard.")); }
  }, []);
  useEffect(() => keepFresh(load, 20000), [load]);
  const trendOnTime = (an?.trend ?? []).filter((t) => t.on_time != null).map((t) => (t.on_time ? 1 : 0));
  const trendDelay = (an?.trend ?? []).map((t) => t.delay_min ?? 0);
  const trendDur = (an?.trend ?? []).map((t) => t.duration_min ?? 0);
  return (
    <>
      {error && <ErrorRow msg={error} retry={() => void load()} />}
      {!stats ? <div className="grid grid-cols-2 gap-2 *:min-w-0"><Skeleton variant="block" size={92} /><Skeleton variant="block" size={92} /><Skeleton variant="block" size={92} /><Skeleton variant="block" size={92} /></div> : (
        <>
          <p className="text-sm text-ink-500">Academic year <b className="tnum text-ink-700">{stats.academic_year}</b> · {stats.school.name}</p>
          <div className="grid grid-cols-2 gap-2 *:min-w-0">
            <Stat size="sm" label="Awaiting check" value={stats.pending} icon={ShieldCheck} tone={stats.pending ? "warn" : "neutral"} onClick={() => nav.replace({ name: "admin", tab: "verify" })} />
            <Stat size="sm" label="Approved families" value={stats.approved} icon={Users} tone="ok" hint={`${stats.addons} family add-ons`} />
            <Stat size="sm" label="Carpools" value={stats.carpools} icon={Car} tone="primary" hint={an ? `${an.matched} matched · ${an.unmatched} looking` : undefined} onClick={() => nav.replace({ name: "admin", tab: "carpools" })} />
            <Stat size="sm" label="Live trips now" value={stats.live} icon={Radio} tone={stats.live ? "accent" : "neutral"} />
          </div>
        </>
      )}
      <section>
        <SectionTitle variant="eyebrow" count={an?.completed_trips}>Punctuality · all carpools</SectionTitle>
        {!an ? <Skeleton variant="block" size={120} /> : an.trips === 0 ? <Card><EmptyState icon={Gauge} title="No completed trips yet" sub="Punctuality appears after the first school run." /></Card> : (
          <div className="grid grid-cols-2 gap-2 *:min-w-0">
            <Stat size="sm" label="On time" value={pct(an.on_time_pct)} unit="%" tone="ok" chart={trendOnTime.length > 1 ? <Sparkline fluid height={28} values={trendOnTime} domain={[0, 1]} last={false} /> : undefined} hint="school-run gate arrivals" />
            <Stat size="sm" label="Avg pickup delay" value={an.avg_pickup_delay_min != null ? `${an.avg_pickup_delay_min > 0 ? "+" : ""}${Math.round(an.avg_pickup_delay_min)}` : "—"} unit="min" tone={(an.avg_pickup_delay_min ?? 0) > 5 ? "warn" : "primary"} chart={trendDelay.length > 1 ? <Sparkline fluid height={28} values={trendDelay} baseline={0} /> : undefined} hint="vs planned ETA" />
            <Stat size="sm" label="Missed-stop rate" value={an.missed_rate != null ? Math.round(an.missed_rate * 100) : "—"} unit="%" tone={(an.missed_rate ?? 0) > 0 ? "danger" : "neutral"} />
            <Stat size="sm" label="Avg duration" value={pct(an.avg_duration_min)} unit="min" chart={trendDur.length > 1 ? <Sparkline fluid height={28} values={trendDur} /> : undefined} />
          </div>
        )}
      </section>
      {an && an.per_carpool.length > 0 && (
        <section>
          <SectionTitle variant="eyebrow">Per carpool</SectionTitle>
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead><tr className="whitespace-nowrap text-left text-xs uppercase tracking-wider text-ink-500"><th className="px-4 py-2.5 font-semibold">Carpool</th><th className="w-12 px-1 py-2.5 text-right font-semibold">Trips</th><th className="w-16 px-1 py-2.5 text-right font-semibold">On time</th><th className="w-16 px-1 py-2.5 text-right font-semibold">Delay</th><th className="w-16 px-3 py-2.5 text-right font-semibold">Missed</th></tr></thead>
              <tbody className="tnum">
                {an.per_carpool.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="truncate px-4 py-2.5 font-semibold text-ink-900">{c.name}</td>
                    <td className="px-1 py-2.5 text-right text-ink-700">{c.stats.trips}</td>
                    <td className={cn("px-1 py-2.5 text-right font-semibold", (c.stats.on_time_pct ?? 100) >= 80 ? "text-ok-ink" : "text-warn-ink")}>{c.stats.on_time_pct != null ? `${Math.round(c.stats.on_time_pct)}%` : "—"}</td>
                    <td className="whitespace-nowrap px-1 py-2.5 text-right text-ink-700">{c.stats.avg_pickup_delay_min != null ? `${c.stats.avg_pickup_delay_min > 0 ? "+" : ""}${Math.round(c.stats.avg_pickup_delay_min)}m` : "—"}</td>
                    <td className={cn("px-3 py-2.5 text-right", (c.stats.missed_rate ?? 0) > 0 ? "font-semibold text-danger-ink" : "text-ink-700")}>{c.stats.missed_rate != null ? `${Math.round(c.stats.missed_rate * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </>
  );
}

/* --------------------------------------------------------------- verify */
function Verify() {
  const toast = useToast();
  const [list, setList] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList(await api.adminRegistrations("pending")); setError(null); }
    catch (e) { setError(errMsg(e, "Couldn't load registrations.")); setList((l) => l ?? []); }
  }, []);
  useEffect(() => keepFresh(load, 20000), [load]);
  async function decide(p: Profile, d: "approved" | "rejected") {
    setBusy(p.id);
    try { await api.adminDecision(p.id, d, d === "rejected" ? "Details could not be matched to a current student" : undefined); toast[d === "approved" ? "ok" : "info"](`${p.name} ${d}.`); await load(); }
    catch (e) { toast.danger(errMsg(e, "Couldn't record that.")); }
    finally { setBusy(null); }
  }
  return (
    <>
      {error && <ErrorRow msg={error} retry={() => void load()} />}
      {list === null ? <Skeleton variant="card" /> : list.length === 0 ? (
        <Card><EmptyState icon={ShieldCheck} title="Nothing to verify" sub="New family registrations appear here for a quick check against the student roll." /></Card>
      ) : list.map((p) => (
        <Card key={p.id} padding="md" className="grid gap-3 *:min-w-0">
          <div className="flex items-start gap-3">
            <Avatar name={p.name} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-ink-900">{p.name}</p>
              <p className="truncate text-sm text-ink-500">{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
              <p className="truncate text-sm text-ink-500">{[p.colony, p.pincode].filter(Boolean).join(" · ") || "No address"}{p.home_lat != null ? " · home pinned" : " · no home pin"}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {p.children.map((c) => <Pill key={c.id} size="sm" tone="primary">{c.name} · {classLabel(c.class_level)}</Pill>)}
                <Pill size="sm" tone={p.can_drive ? "ok" : "neutral"}>{p.can_drive ? "Has a car" : "No car"}</Pill>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 *:min-w-0">
            <Button variant="ghost" icon={X} loading={busy === p.id} onClick={() => decide(p, "rejected")}>Reject</Button>
            <Button icon={Check} loading={busy === p.id} onClick={() => decide(p, "approved")}>Approve</Button>
          </div>
        </Card>
      ))}
    </>
  );
}

/* ------------------------------------------------------------- carpools */
function AdminCarpools() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Carpool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList(await api.adminCarpools()); setError(null); }
    catch (e) { setError(errMsg(e, "Couldn't load carpools.")); setList((l) => l ?? []); }
  }, []);
  useEffect(() => keepFresh(load, 15000), [load]);
  async function endStuck(c: Carpool) {
    const r = c.active_ride; if (!r) return;
    if (!(await confirm({ title: "End this trip?", message: `"${c.name}" has a trip running since ${fmtTime(r.started_at)}. Ending it closes the trip for every parent — use this for a trip that never finished.`, confirmLabel: "End trip", icon: Square }))) return;
    setBusy(c.id);
    try { await api.endRide(r.id); toast.ok("Trip ended."); await load(); }
    catch (e) { toast.danger(errMsg(e, "Couldn't end the trip.")); }
    finally { setBusy(null); }
  }
  return (
    <>
      {error && <ErrorRow msg={error} retry={() => void load()} />}
      {list === null ? <Skeleton variant="card" /> : list.length === 0 ? <Card><EmptyState icon={Car} title="No carpools yet" sub="Carpools appear as parents create them from Discover." /></Card> : list.map((c) => (
        <Card key={c.id} padding="md" className="grid gap-3 *:min-w-0">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-ink"><Car size={20} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="truncate text-base font-semibold text-ink-900">{c.name}</span>{c.active_ride && <LiveBadge />}</div>
              <p className="tnum truncate text-sm text-ink-500">{c.creator_name ?? "Organiser"} · {c.joined.length} families · {c.seats_used ?? 0}/{c.seats ?? "—"} seats{c.driver_vehicle ? ` · ${c.driver_vehicle}` : ""}</p>
              {c.active_ride && <p className="tnum mt-0.5 text-sm text-ink-700">{directionLabel(c.active_ride.direction)} · {c.active_ride.driver_name} · since {fmtTime(c.active_ride.started_at)} · last ping {timeAgo(c.active_ride.last_update)}</p>}
              {c.stats && c.stats.trips > 0 && <p className="tnum mt-0.5 text-xs text-ink-500">{c.stats.trips} trips · {pct(c.stats.on_time_pct)}% on time · {c.stats.missed_rate != null ? Math.round(c.stats.missed_rate * 100) : 0}% missed</p>}
            </div>
          </div>
          <Button variant={open === c.id ? "soft" : "ghost"} icon={Users} onClick={() => setOpen(open === c.id ? null : c.id)} full>
            {open === c.id ? "Hide families & children" : `Families & children (${c.joined.length} · ${(c.riders ?? []).length})`}
          </Button>
          {open === c.id && <CarpoolRoster c={c} />}
          {c.active_ride && (
            <div className="grid grid-cols-2 gap-2 *:min-w-0">
              <Button variant="soft" onClick={() => nav.go({ name: "trip", rideId: c.active_ride!.id })}>Watch live</Button>
              <Button variant="danger" icon={Square} loading={busy === c.id} onClick={() => endStuck(c)}>End stuck trip</Button>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}

/** Every family in a carpool with their contact details and children — the
 *  school's view for verification and emergencies. */
function CarpoolRoster({ c }: { c: Carpool }) {
  const riders = c.riders ?? [];
  const families = c.members.filter((m) => m.status === "joined" || m.status === "invited" || m.status === "requested");
  return (
    <div className="grid gap-2 rounded-md bg-bg p-3 *:min-w-0">
      {families.map((m) => {
        const kids = riders.filter((r) => r.parent_id === m.parent_id);
        return (
          <div key={m.parent_id} className="flex items-start gap-3">
            <Avatar name={m.parent_name} size="sm" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-ink-900">{m.parent_name}</span>
                {m.role === "creator" && <Pill size="sm" tone="primary">Organiser</Pill>}
                {m.status !== "joined" && <Pill size="sm" tone="neutral">{m.status === "invited" ? "Invited" : "Requested"}</Pill>}
              </div>
              <p className="tnum text-xs text-ink-500">
                {m.phone ? <a href={`tel:${m.phone}`} className="font-medium text-primary">{m.phone}</a> : "no phone"}{m.colony ? ` · ${m.colony}` : ""}
              </p>
              {kids.length > 0 ? (
                <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-xs text-ink-700">
                  {kids.map((k) => (
                    <li key={k.child_id} className="flex flex-wrap items-center gap-x-2">
                      <span>{k.child_name} · {classLabel(k.class_level)}{k.gender ? ` · ${k.gender === "female" ? "girl" : "boy"}` : ""}</span>
                      {k.absent && <Pill size="sm" tone="neutral">Absent today</Pill>}
                      {k.allergies && <span className="text-danger">⚠ {k.allergies}</span>}
                      {k.emergency_phone && <span className="text-ink-500">Emergency: {k.emergency_phone}</span>}
                    </li>
                  ))}
                </ul>
              ) : m.status === "joined" ? <p className="mt-1 text-xs text-ink-500">No children on file</p> : null}
            </div>
          </div>
        );
      })}
      {c.driver_name && <p className="tnum text-xs text-ink-500">Driver on file: {c.driver_name}{c.driver_phone ? ` · ${c.driver_phone}` : ""}{c.driver_vehicle ? ` · ${c.driver_vehicle}` : ""}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ incidents */
const INCIDENT: Record<string, { label: string; tone: "danger" | "warn" | "info" | "neutral"; blurb: string }> = {
  missed_pickup: { label: "Missed pickups", tone: "danger", blurb: "The car left a pickup area without a qualifying stop." },
  route_alert: { label: "Off route", tone: "danger", blurb: "The car strayed beyond the off-route threshold." },
  anomaly_long_stop: { label: "Long stops", tone: "warn", blurb: "Stationary for longer than the long-stop rule, away from any stop." },
  anomaly_speed: { label: "Speeding", tone: "warn", blurb: "Ping-to-ping speed above the school's limit." },
  unboarded: { label: "Parent corrections", tone: "info", blurb: "A parent reverted a wrong check-in." },
};
function Incidents() {
  const [list, setList] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setList(await api.adminIncidents()); setError(null); }
    catch (e) { setError(errMsg(e, "Couldn't load incidents.")); setList((l) => l ?? []); }
  }, []);
  useEffect(() => keepFresh(load, 20000), [load]);
  const groups = useMemo(() => {
    const m = new Map<string, Incident[]>();
    (list ?? []).forEach((i) => m.set(i.type, [...(m.get(i.type) ?? []), i]));
    const order = Object.keys(INCIDENT);
    return [...m.entries()].sort((a, b) => (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0])));
  }, [list]);
  return (
    <>
      {error && <ErrorRow msg={error} retry={() => void load()} />}
      {list === null ? <Skeleton variant="card" /> : list.length === 0 ? <Card><EmptyState icon={ShieldCheck} title="No incidents" sub="Missed pickups, off-route drives, long stops and speeding land here automatically." /></Card> : groups.map(([type, items]) => {
        const meta = INCIDENT[type] ?? { label: type.replace(/_/g, " "), tone: "neutral" as const, blurb: "" };
        return (
          <section key={type}>
            <SectionTitle variant="eyebrow" count={items.length} action={<Pill size="sm" tone={meta.tone}>{meta.tone === "danger" ? "Act now" : meta.tone === "warn" ? "Review" : "FYI"}</Pill>}>{meta.label}</SectionTitle>
            {meta.blurb && <p className="mb-2 text-xs text-ink-500">{meta.blurb}</p>}
            <Card padding="none" className="divide-y divide-line px-4">
              {items.map((i) => (
                <button key={i.id} type="button" onClick={() => nav.go({ name: "replay", rideId: i.ride_id })} className="flex w-full items-start gap-3 py-3 text-left">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", meta.tone === "danger" ? "bg-danger" : meta.tone === "warn" ? "bg-warn" : meta.tone === "info" ? "bg-info" : "bg-ink-300")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-900">{i.carpool}</span>
                    {i.note && <span className="block text-sm text-ink-700 text-pretty">{i.note}</span>}
                  </span>
                  <span className="tnum shrink-0 text-xs text-ink-500">{fmtDate(i.created_at)} {fmtTime(i.created_at)}</span>
                </button>
              ))}
            </Card>
          </section>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------- settings */
type NumKey = Exclude<keyof Settings, "school_name" | "school_lat" | "school_lng" | "school_start_time" | "school_end_time">;
const FIELDS: { key: NumKey; label: string; hint: string; unit: string; min: number; max: number; step?: number }[] = [
  { key: "fence_near_m", label: "Arriving fence", hint: "Parent gets the “arriving” alert inside this.", unit: "m", min: 50, max: 5000 },
  { key: "fence_stop_m", label: "Stop fence", hint: "Car must be stationary inside this to arm the stop clock.", unit: "m", min: 20, max: 2000 },
  { key: "fence_leave_m", label: "Leave fence", hint: "Leaving past this after a qualifying stop = done.", unit: "m", min: 30, max: 3000 },
  { key: "fence_miss_m", label: "Miss fence", hint: "Leaving past this without a stop = missed pickup.", unit: "m", min: 50, max: 5000 },
  { key: "dwell_s", label: "Dwell", hint: "Minimum stationary seconds for a qualifying stop.", unit: "s", min: 1, max: 600 },
  { key: "stationary_m", label: "Stationary threshold", hint: "Ping-to-ping movement under this counts as stationary.", unit: "m", min: 5, max: 500 },
  { key: "school_gate_m", label: "School gate fence", hint: "Arrival fence around the school pin.", unit: "m", min: 50, max: 2000 },
  { key: "offroute_km", label: "Off-route threshold", hint: "Distance from the planned corridor that raises a route alert.", unit: "km", min: 0.2, max: 50, step: 0.1 },
  { key: "long_stop_s", label: "Long-stop rule", hint: "Stationary this long away from any stop = anomaly.", unit: "s", min: 30, max: 7200 },
  { key: "speed_max_kmh", label: "Speed limit", hint: "Ping-to-ping speed above this = speeding anomaly.", unit: "km/h", min: 20, max: 200 },
  { key: "city_speed_kmh", label: "City speed", hint: "ETA fallback speed when the car isn't moving.", unit: "km/h", min: 5, max: 120 },
  { key: "road_factor", label: "Road factor", hint: "Straight-line → road distance multiplier for ETAs.", unit: "×", min: 1, max: 3, step: 0.05 },
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function SchoolSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([api.getSettings(), api.adminStats()]);
      setSaved(s); setYear(st.academic_year); setError(null);
      setPin({ lat: s.school_lat, lng: s.school_lng }); setSchoolName(s.school_name);
      const f: Record<string, string> = {};
      FIELDS.forEach((x) => { f[x.key] = String(s[x.key]); });
      f.school_start_time = s.school_start_time.slice(0, 5); f.school_end_time = s.school_end_time.slice(0, 5);
      setForm(f);
    } catch (e) { setError(errMsg(e, "Couldn't load settings.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const num = (k: string) => Number(form[k]);
    FIELDS.forEach((x) => { const v = num(x.key); if (!Number.isFinite(v)) e[x.key] = "Enter a number"; else if (v < x.min || v > x.max) e[x.key] = `${x.min}–${x.max} ${x.unit}`; else if (!x.step && !Number.isInteger(v)) e[x.key] = "Whole number"; });
    if (!e.fence_stop_m && !e.fence_leave_m && !e.fence_miss_m && !(num("fence_stop_m") < num("fence_leave_m") && num("fence_leave_m") <= num("fence_miss_m"))) e.fence_leave_m = "Must be: stop < leave ≤ miss";
    if (!e.fence_near_m && !e.fence_stop_m && num("fence_near_m") < num("fence_stop_m")) e.fence_near_m = "Arriving fence should be ≥ stop fence";
    ["school_start_time", "school_end_time"].forEach((k) => { if (!TIME_RE.test(form[k] ?? "")) e[k] = "HH:MM (24h)"; });
    if (!e.school_start_time && !e.school_end_time && form.school_start_time >= form.school_end_time) e.school_end_time = "Must be after school start";
    return e;
  }, [form]);
  const dirty = useMemo(() => !!saved && (FIELDS.some((x) => String(saved[x.key]) !== form[x.key]) || saved.school_start_time.slice(0, 5) !== form.school_start_time || saved.school_end_time.slice(0, 5) !== form.school_end_time), [saved, form]);
  const pinDirty = !!saved && !!pin && (pin.lat !== saved.school_lat || pin.lng !== saved.school_lng || schoolName.trim() !== saved.school_name);

  async function saveRules() {
    if (Object.keys(errors).length) { toast.warn("Fix the highlighted fields first."); return; }
    setBusy("rules");
    try {
      const patch: Partial<Settings> = { school_start_time: form.school_start_time, school_end_time: form.school_end_time };
      FIELDS.forEach((x) => { (patch as Record<string, number>)[x.key] = Number(form[x.key]); });
      const s = await api.setSettings(patch); setSaved(s); toast.ok("Rules saved — they apply to the next ping.");
    } catch (e) { toast.danger(errMsg(e, "Couldn't save.")); }
    finally { setBusy(null); }
  }
  async function saveSchool() {
    if (!pin) return;
    if (!schoolName.trim()) { toast.warn("Give the school a name."); return; }
    setBusy("school");
    try { const s: School = await api.setSchool({ name: schoolName.trim(), lat: pin.lat, lng: pin.lng }); setSaved((x) => (x ? { ...x, school_name: s.name, school_lat: s.lat, school_lng: s.lng } : x)); toast.ok("School pin saved."); }
    catch (e) { toast.danger(errMsg(e, "Couldn't save the pin.")); }
    finally { setBusy(null); }
  }
  async function promote() {
    if (!(await confirm({ title: "Promote the academic year?", message: `Every child moves up one class (Class 12 → alumni) and the year becomes ${year != null ? year + 1 : "next"}. Do this once, after results.`, confirmLabel: "Promote everyone", icon: CalendarArrowUp }))) return;
    setBusy("promote");
    try { const r = await api.promoteYear(); setYear(r.academic_year); toast.ok(`Academic year is now ${r.academic_year}.`); }
    catch (e) { toast.danger(errMsg(e, "Couldn't promote.")); }
    finally { setBusy(null); }
  }
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (error && !saved) return <ErrorRow msg={error} retry={() => void load()} />;
  if (!saved) return <><Skeleton variant="map" size={200} /><Skeleton variant="card" /></>;
  return (
    <>
      <section>
        <SectionTitle variant="eyebrow">School pin</SectionTitle>
        <Card padding="md" className="grid gap-3 *:min-w-0">
          <Input label="School name" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
          <LocationPicker value={pin} onChange={(v) => setPin({ lat: v.lat, lng: v.lng })} mapClassName="h-56" pinLabel="School gate" hint="Tap the map to move the gate pin — every geofence is measured from it." />
          <Button icon={MapPin} disabled={!pinDirty} loading={busy === "school"} onClick={saveSchool}>Save school pin</Button>
        </Card>
      </section>

      <section>
        <SectionTitle variant="eyebrow">Geofence & anomaly rules</SectionTitle>
        <Card padding="md" className="grid gap-4 *:min-w-0">
          <p className="text-sm text-ink-500 text-pretty">A child checks in only when the car is genuinely stationary inside the stop fence for at least the dwell, then drives away. Keep <b className="text-ink-700">stop &lt; leave ≤ miss</b>.</p>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((x) => (
              <Input key={x.key} label={x.label} type="number" inputMode="decimal" step={x.step ?? 1} min={x.min} max={x.max} value={form[x.key] ?? ""} onChange={(e) => set(x.key, e.target.value)} rightSlot={<span className="text-xs">{x.unit}</span>} error={errors[x.key]} hint={x.hint} wrapperClassName="content-start" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="School starts" type="time" value={form.school_start_time ?? ""} onChange={(e) => set("school_start_time", e.target.value)} error={errors.school_start_time} hint="On time = gate arrival ≤ this" wrapperClassName="content-start" />
            <Input label="School ends" type="time" value={form.school_end_time ?? ""} onChange={(e) => set("school_end_time", e.target.value)} error={errors.school_end_time} hint="Home runs start after this" wrapperClassName="content-start" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" disabled={!dirty} onClick={() => void load()}>Reset</Button>
            <Button icon={Save} disabled={!dirty || Object.keys(errors).length > 0} loading={busy === "rules"} onClick={saveRules}>Save rules</Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle variant="eyebrow">Academic year</SectionTitle>
        <Card padding="md" className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-soft-ink"><CalendarArrowUp size={20} aria-hidden /></span>
          <div className="min-w-0 flex-1"><p className="tnum text-base font-semibold text-ink-900">{year ?? "—"}</p><p className="text-sm text-ink-500">Promote once a year: every child moves up a class.</p></div>
          <Button size="sm" variant="soft" loading={busy === "promote"} onClick={promote}>Promote</Button>
        </Card>
      </section>
    </>
  );
}

/* -------------------------------------------------------------- notices */
function Notices() {
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tnc, setTnc] = useState("");
  const [list, setList] = useState<Broadcast[] | null>(null);
  const [versions, setVersions] = useState<{ version: number; body: string; published_at: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const [b, v] = await Promise.all([api.getBroadcasts(), api.adminTncList()]); setList(b); setVersions(v); setError(null); }
    catch (e) { setError(errMsg(e, "Couldn't load notices.")); setList((l) => l ?? []); setVersions((v) => v ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function send() {
    if (!title.trim() || !body.trim()) { toast.warn("Add a title and a message."); return; }
    setBusy("bc");
    try { await api.adminBroadcast(title.trim(), body.trim()); toast.ok("Notice sent to every family."); setTitle(""); setBody(""); await load(); }
    catch (e) { toast.danger(errMsg(e, "Couldn't send.")); }
    finally { setBusy(null); }
  }
  async function publish() {
    if (tnc.trim().length < 20) { toast.warn("Terms look too short."); return; }
    if (!(await confirm({ title: "Publish new terms?", message: "Every family will be asked to accept the new version before continuing.", confirmLabel: "Publish", danger: false, icon: FileText }))) return;
    setBusy("tnc");
    try { const r = await api.publishTnc(tnc.trim()); toast.ok(`Terms v${r.version} published.`); setTnc(""); await load(); }
    catch (e) { toast.danger(errMsg(e, "Couldn't publish.")); }
    finally { setBusy(null); }
  }
  return (
    <>
      {error && <ErrorRow msg={error} retry={() => void load()} />}
      <section>
        <SectionTitle variant="eyebrow">Send a notice</SectionTitle>
        <Card padding="md" className="grid gap-3 *:min-w-0">
          <Input label="Title" placeholder="e.g. Early closure on Friday" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea label="Message" rows={3} placeholder="Keep it short — it lands in every family's inbox." value={body} onChange={(e) => setBody(e.target.value)} />
          <Button icon={Megaphone} loading={busy === "bc"} onClick={send}>Send to all families</Button>
        </Card>
      </section>
      <section>
        <SectionTitle variant="eyebrow" count={list?.length}>Sent notices</SectionTitle>
        {list === null ? <Skeleton variant="row" lines={2} /> : list.length === 0 ? <Card><EmptyState icon={Megaphone} title="No notices yet" /></Card> : (
          <Card padding="none" className="divide-y divide-line px-4">
            {list.map((b) => <div key={b.id} className="py-3"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-base font-semibold text-ink-900">{b.title}</p><span className="tnum shrink-0 text-xs text-ink-500">{fmtDate(b.created_at)}</span></div><p className="mt-0.5 text-sm text-ink-700 text-pretty">{b.body}</p></div>)}
          </Card>
        )}
      </section>
      <section>
        <SectionTitle variant="eyebrow">Terms & conditions</SectionTitle>
        <Card padding="md" className="grid gap-3 *:min-w-0">
          {versions && versions.length > 0 && <p className="text-sm text-ink-500">Current: <b className="tnum text-ink-700">v{versions[0].version}</b> · published {fmtDate(versions[0].published_at)}</p>}
          <Textarea label="New version" rows={5} placeholder="Paste the full terms text…" value={tnc} onChange={(e) => setTnc(e.target.value)} hint="Publishing bumps the version; families accept it on next open." />
          <Button variant="soft" icon={FileText} loading={busy === "tnc"} onClick={publish}>Publish terms</Button>
          {versions && versions.length > 1 && <details className="text-sm text-ink-500"><summary className="cursor-pointer font-semibold text-ink-700">Previous versions ({versions.length - 1})</summary><ul className="m-0 mt-2 grid list-none gap-1 p-0">{versions.slice(1).map((v) => <li key={v.version} className="tnum">v{v.version} · {fmtDate(v.published_at)}</li>)}</ul></details>}
        </Card>
      </section>
    </>
  );
}
