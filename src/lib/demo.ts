// In-memory DEMO backend (v8). Zero setup: powers the keyless preview build and
// the logic tests. It implements the `Backend` contract with EXACTLY the same
// semantics as the Supabase backend (supabase/schema.sql — app_start_ride,
// app_post_location, _end_ride, app_trip_replay, _carpool_stats, …): the stop
// state machine, live/planned ETAs, anomalies, punctuality and auto-end are
// transcribed from the SQL so both backends behave identically.
//
// Test hooks (globalThis):
//   __VVS_DWELL_MS   — qualifying-stop dwell in ms (default: settings.dwell_s)
//   __VVS_NOW        — clock override in ms (default: Date.now())
//   __VVS_LATENCY_MS — simulated network latency (default 60 ms)
import type { Backend, Unsub } from "./backend";
import type {
  Profile, SignInResult, RegisterData, Child, DriverDoc, TrustedPickup, Vehicle, Role, Status,
  Discovery, Filters, ParentPin, NearbyCarpool, Carpool, Member, Rider, TripDriver, Ride, LocationResult, Stop,
  StopKind, StopStatus, RideEvent, TripSummary, TripReplay, CarpoolStats, ChatMessage, Notification, School, Settings,
  Broadcast, AttendanceRow, Incident, AdminStats, AdminAnalytics, PushSubscriptionJSON, Direction, Addon,
} from "./types";
import { emit, on } from "./bus";
import { optimalOrder } from "./optimize";
import { SCHOOL, FAMILIES, ADDONS, ADMIN, CARPOOL, TNC_V1, SEED_CHAT, SEED_TRIPS, type SeedTrip } from "./demoSeed";

// ---------------------------------------------------------------------------
// clock, ids, geo
// ---------------------------------------------------------------------------
interface DemoGlobals { __VVS_DWELL_MS?: number; __VVS_NOW?: number; __VVS_LATENCY_MS?: number; }
const G = globalThis as unknown as DemoGlobals;
let clockOverride: number | null = null;              // used only while seeding history
function nowMs(): number {
  if (clockOverride != null) return clockOverride;
  return typeof G.__VVS_NOW === "number" ? G.__VVS_NOW : Date.now();
}
const iso = (ms: number) => new Date(ms).toISOString();
const nowISO = () => iso(nowMs());
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function istDate(ms: number): string { return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10); }
function istHour(ms: number): number { return new Date(ms + IST_OFFSET_MS).getUTCHours(); }
function istSecondsOfDay(ms: number): number { const d = new Date(ms + IST_OFFSET_MS); return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(); }
function timeToSeconds(t: string): number { const [h, m, s] = t.split(":").map((x) => Number(x) || 0); return h * 3600 + m * 60 + (s || 0); }
const today = () => istDate(nowMs());
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

let idc = 1000;
const uid = () => "d" + ++idc;
let pingSeq = 0;

function distKm(a?: number | null, b?: number | null, c?: number | null, d?: number | null): number | null {
  if (a == null || b == null || c == null || d == null || [a, b, c, d].some((v) => Number.isNaN(v))) return null;
  const R = 6371, r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(c - a), dLng = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
// point → segment distance (km, equirectangular) — same as SQL _dist_route_km
function distRouteKm(pLat: number, pLng: number, aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, r = (x: number) => (x * Math.PI) / 180;
  const lat0 = r((aLat + bLat) / 2);
  const pr = (lat: number, lng: number): [number, number] => [R * r(lng) * Math.cos(lat0), R * r(lat)];
  const [px, py] = pr(pLat, pLng), [ax, ay] = pr(aLat, aLng), [bx, by] = pr(bLat, bLng);
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const round = (n: number, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const roundN = (n: number | null | undefined, dp = 0): number | null => (n == null || Number.isNaN(n) ? null : round(n, dp));

// ---------------------------------------------------------------------------
// store (mirrors the SQL tables)
// ---------------------------------------------------------------------------
interface UserRow {
  id: string; role: Role; name: string; email: string;
  phone: string | null; address: string | null; colony: string | null; pincode: string | null;
  home_lat: number | null; home_lng: number | null; existing_carpool: boolean; status: Status;
  tnc_version: number; parent_owner_id: string | null; relation: string | null; can_drive: boolean;
  photo_url: string | null; vehicle: Vehicle | null; driver_status: Profile["driver_status"];
  children: Child[]; documents: DriverDoc[]; trusted: TrustedPickup[]; created_at: string;
}
interface InviteRow { id: string; parent_id: string; name: string; email: string; relation: string | null; }
interface CarpoolRow { id: string; name: string; creator_id: string; driver_name: string | null; driver_phone: string | null; driver_vehicle: string | null; seats: number; created_at: string; }
interface MemberRow { carpool_id: string; parent_id: string; role: "creator" | "member"; status: Member["status"]; }
interface RideRow {
  id: string; carpool_id: string; driver_user_id: string | null; driver_name: string | null; driver_phone: string | null; driver_vehicle: string | null;
  order: string[]; direction: Direction; origin_lat: number | null; origin_lng: number | null;
  status: "active" | "completed" | "cancelled"; started_at: string; ended_at: string | null;
  last_lat: number | null; last_lng: number | null; last_heading: number | null; last_update: string | null;
  planned_duration_min: number | null; actual_duration_min: number | null; on_time: boolean | null; distance_km: number | null;
}
interface StopRow {
  id: string; ride_id: string; child_id: string | null; seq: number; kind: StopKind; lat: number; lng: number; label: string;
  status: StopStatus; planned_eta_min: number | null; planned_at: string | null; eta_min: number | null; eta_at: string | null;
  arrived_at: string | null; stopped_at: string | null; done_at: string | null; dwell_s: number | null; delay_min: number | null;
}
interface PingRow { id: number; ride_id: string; lat: number; lng: number; eta_min: number | null; distance_km: number | null; speed_kmh: number | null; heading: number | null; created_at: string; }
interface EventRow { id: string; ride_id: string; type: string; child_id: string | null; note: string | null; created_at: string; }
interface NotifRow extends Notification { user_id: string; }
interface PushRow { endpoint: string; user_id: string; p256dh: string; auth: string; ua: string | null; created_at: string; }
interface TncRow { version: number; body: string; published_at: string; }

const users: UserRow[] = [];
const invites: InviteRow[] = [];
const carpools: CarpoolRow[] = [];
const members: MemberRow[] = [];
const rides: RideRow[] = [];
const stops: StopRow[] = [];
const pings: PingRow[] = [];
const events: EventRow[] = [];
const notifs: NotifRow[] = [];
const chats: ChatMessage[] = [];
const broadcasts: Broadcast[] = [];
const absences = new Set<string>();                   // "carpool:child:YYYY-MM-DD"
const pushSubs = new Map<string, PushRow>();
const tnc: TncRow[] = [];
const settings: Settings = {
  school_name: SCHOOL.name, school_lat: SCHOOL.lat, school_lng: SCHOOL.lng,
  fence_near_m: 400, fence_stop_m: 150, fence_leave_m: 300, fence_miss_m: 600,
  dwell_s: 8, stationary_m: 30, school_gate_m: 300, offroute_km: 2.0,
  long_stop_s: 300, speed_max_kmh: 80, school_start_time: "07:50", school_end_time: "14:10",
  city_speed_kmh: 22, road_factor: 1.3,
};
let currentId: string | null = null;
let pendingEmail: string | null = null;               // an unknown email that just signed up

// ---------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------
const byId = (id: string | null | undefined): UserRow | null => (id ? users.find((u) => u.id === id) ?? null : null);
const byEmail = (email: string): UserRow | null => users.find((u) => u.email === email.trim().toLowerCase()) ?? null;
function findChild(childId: string | null | undefined): { child: Child; parent: UserRow } | null {
  if (!childId) return null;
  for (const u of users) { const c = u.children.find((x) => x.id === childId); if (c) return { child: c, parent: u }; }
  return null;
}
const carpoolById = (id: string): CarpoolRow | null => carpools.find((c) => c.id === id) ?? null;
const rideById = (id: string): RideRow | null => rides.find((r) => r.id === id) ?? null;
const activeRideOf = (cid: string): RideRow | null => rides.find((r) => r.carpool_id === cid && r.status === "active") ?? null;
const stopsOf = (rid: string): StopRow[] => stops.filter((s) => s.ride_id === rid).sort((a, b) => a.seq - b.seq);
const eventsOf = (rid: string): EventRow[] => events.filter((e) => e.ride_id === rid);
const pingsOf = (rid: string): PingRow[] => pings.filter((p) => p.ride_id === rid);
const latestTncVersion = () => Math.max(0, ...tnc.map((t) => t.version));
const school = (): School => ({ name: settings.school_name, lat: settings.school_lat, lng: settings.school_lng });

function me(): UserRow { const u = byId(currentId); if (!u) throw new Error("Sign in first"); return u; }
// Chat is private to the carpool: joined households (incl. their add-ons) and the school admin.
function requireChatMember(carpoolId: string, what: string) {
  const m = me(); const a = anchorOf(m);
  const isMember = members.some((x) => x.carpool_id === carpoolId && x.status === "joined" && x.parent_id === a);
  if (!isMember && m.role !== "admin") throw new Error(`Only members of this carpool can ${what}.`);
}
function anchorOf(u: UserRow): string { return u.role === "addon" && u.parent_owner_id ? u.parent_owner_id : u.id; }
function anchor(): string { return anchorOf(me()); }
const isAdmin = () => byId(currentId)?.role === "admin";
function requireAdmin() { if (!isAdmin()) throw new Error("admin only"); }
function requireApproved() { if (me().status !== "approved") throw new Error("Your family is awaiting school verification — this unlocks once the school approves you."); }
const joinedCarpoolIds = (parentId: string) => members.filter((m) => m.parent_id === parentId && m.status === "joined").map((m) => m.carpool_id);
function canActOnRide(r: RideRow): boolean {
  const u = byId(currentId); if (!u) return false;
  return r.driver_user_id === u.id || joinedCarpoolIds(anchorOf(u)).includes(r.carpool_id);
}
const isAbsent = (cid: string, childId: string) => absences.has(`${cid}:${childId}:${today()}`);

function mkUser(u: Partial<UserRow> & { name: string; email: string }): UserRow {
  const row: UserRow = {
    id: u.id ?? uid(), role: u.role ?? "parent", name: u.name, email: u.email.trim().toLowerCase(),
    phone: u.phone ?? null, address: u.address ?? null, colony: u.colony ?? null, pincode: u.pincode ?? null,
    home_lat: u.home_lat ?? null, home_lng: u.home_lng ?? null, existing_carpool: !!u.existing_carpool,
    status: u.status ?? "pending", tnc_version: u.tnc_version ?? 0, parent_owner_id: u.parent_owner_id ?? null,
    relation: u.relation ?? null, can_drive: u.can_drive ?? true, photo_url: u.photo_url ?? null, vehicle: u.vehicle ?? null,
    driver_status: u.driver_status ?? null, children: u.children ?? [], documents: u.documents ?? [], trusted: u.trusted ?? [],
    created_at: nowISO(),
  };
  users.push(row); return row;
}

// ---------------------------------------------------------------------------
// notifications / events
// ---------------------------------------------------------------------------
function notify(userId: string | null | undefined, title: string, body: string, kind = "info"): void {
  if (!userId || !byId(userId)) return;
  const n: NotifRow = { id: uid(), user_id: userId, title, body, kind, read: false, created_at: nowISO() };
  notifs.push(n); emit("notif:" + userId, n as Notification);
}
function audience(cid: string): string[] {
  const parents = members.filter((m) => m.carpool_id === cid && m.status === "joined").map((m) => m.parent_id);
  const addons = users.filter((u) => u.role === "addon" && u.parent_owner_id && parents.includes(u.parent_owner_id)).map((u) => u.id);
  return [...new Set([...parents, ...addons])];
}
function eventOut(e: EventRow): RideEvent {
  return { id: e.id, type: e.type, note: e.note, child_id: e.child_id, child_name: findChild(e.child_id)?.child.name ?? null, created_at: e.created_at };
}
function addEvent(rid: string, type: string, note: string | null, childId: string | null = null): EventRow {
  const e: EventRow = { id: uid(), ride_id: rid, type, child_id: childId, note, created_at: nowISO() };
  events.push(e); emit("rideev:" + rid, eventOut(e));
  return e;
}
function emitStops(rid: string) { emit("stops:" + rid, stopsOut(rid)); }

// custody: latest boarded/unboarded wins; any reached_* on the active ride = dropped
function riderStatus(cid: string, childId: string): Rider["status"] {
  const r = activeRideOf(cid); if (!r) return "waiting";
  const evs = eventsOf(r.id).filter((e) => e.child_id === childId);
  if (evs.some((e) => e.type === "reached_school" || e.type === "reached_home")) return "dropped";
  let last: string | null = null;
  for (const e of evs) if (e.type === "boarded" || e.type === "unboarded") last = e.type;
  return last === "boarded" ? "boarded" : "waiting";
}
function evBoard(r: RideRow, childId: string, auto: boolean) {
  const f = findChild(childId); if (!f) return;
  addEvent(r.id, "boarded", `${f.child.name} boarded${auto ? " (auto check-in)" : ""}`, childId);
  notify(f.parent.id, "Boarded safely ✅", `${f.child.name} is on board${auto ? " — checked in automatically by location" : ""}.`, "safety");
}
function evDrop(r: RideRow, childId: string, place: "school" | "home", auto: boolean) {
  const f = findChild(childId); if (!f) return;
  addEvent(r.id, place === "home" ? "reached_home" : "reached_school", `${f.child.name} reached ${place}${auto ? " (auto)" : ""}`, childId);
  notify(f.parent.id, place === "home" ? "Reached home 🏡" : "Reached school 🏫", `${f.child.name} has arrived safely.`, "safety");
}

// ---------------------------------------------------------------------------
// output shapes (mirror _profile_json / _carpool_json / _stops_json / _ride_json)
// ---------------------------------------------------------------------------
function profileOut(u: UserRow): Profile {
  const addons: Addon[] = invites.filter((i) => i.parent_id === u.id).map((i) => {
    const pr = users.find((x) => x.email === i.email && x.parent_owner_id === u.id) ?? null;
    return { id: pr?.id ?? i.id, name: i.name, email: i.email, relation: i.relation, driver_status: pr?.driver_status ?? null, vehicle: pr?.vehicle ?? null, signed_up: !!pr };
  });
  return {
    id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, address: u.address, colony: u.colony, pincode: u.pincode,
    home_lat: u.home_lat, home_lng: u.home_lng, existing_carpool: u.existing_carpool, status: u.status, tnc_version: u.tnc_version,
    latest_tnc: latestTncVersion(), needs_tnc: u.role !== "addon" && u.tnc_version < latestTncVersion(),
    parent_owner_id: u.parent_owner_id, relation: u.relation, can_drive: u.can_drive,
    children: u.children.map((c) => ({ ...c })), addons,
    photo_url: u.photo_url, vehicle: u.vehicle ? { ...u.vehicle } : null, documents: u.documents.map((d) => ({ ...d })),
    driver_status: u.driver_status, trusted: u.trusted.map((t) => ({ ...t })),
    push_enabled: [...pushSubs.values()].some((p) => p.user_id === u.id),
  };
}
function memberOut(m: MemberRow): Member {
  const p = byId(m.parent_id);
  return { parent_id: m.parent_id, parent_name: p?.name ?? "", phone: p?.phone ?? null, colony: p?.colony ?? null, can_drive: p?.can_drive !== false,
    existing_carpool: !!p?.existing_carpool, role: m.role, status: m.status, home_lat: p?.home_lat ?? null, home_lng: p?.home_lng ?? null,
    child_id: p?.children[0]?.id, child_name: p?.children[0]?.name };
}
function ridersFor(cid: string): Rider[] {
  const out: Rider[] = [];
  const r = activeRideOf(cid);
  members.filter((m) => m.carpool_id === cid && m.status === "joined").forEach((m) => {
    const p = byId(m.parent_id); if (!p) return;
    p.children.forEach((child) => {
      const evs = r ? eventsOf(r.id).filter((e) => e.child_id === child.id) : [];
      const boarded = [...evs].reverse().find((e) => e.type === "boarded");
      const dropped = evs.find((e) => e.type === "reached_school" || e.type === "reached_home");
      out.push({
        child_id: child.id, child_name: child.name, class_level: child.class_level, gender: child.gender ?? null,
        parent_id: p.id, parent_name: p.name, home_lat: p.home_lat, home_lng: p.home_lng, colony: p.colony,
        absent: isAbsent(cid, child.id), status: riderStatus(cid, child.id),
        boarded_at: boarded?.created_at ?? null, dropped_at: dropped?.created_at ?? null,
        allergies: child.allergies ?? null, emergency_phone: child.emergency_phone ?? null, photo_url: child.photo_url ?? null,
      });
    });
  });
  return out;
}
const childCount = (cid: string) => members.filter((m) => m.carpool_id === cid && m.status === "joined").reduce((n, m) => n + (byId(m.parent_id)?.children.length ?? 0), 0);

function carpoolOut(cp: CarpoolRow, withRide = true): Carpool {
  const ms = members.filter((m) => m.carpool_id === cp.id).map(memberOut);
  const viewer = byId(currentId);
  // membership is per household: an add-on shares their parent's status
  const mine = ms.find((m) => m.parent_id === (viewer ? anchorOf(viewer) : currentId));
  const active = withRide ? activeRideOf(cp.id) : null;
  return {
    id: cp.id, name: cp.name, creator_id: cp.creator_id, creator_name: byId(cp.creator_id)?.name,
    driver_name: cp.driver_name, driver_phone: cp.driver_phone, driver_vehicle: cp.driver_vehicle,
    seats: cp.seats, seats_used: childCount(cp.id),
    members: ms, joined: ms.filter((m) => m.status === "joined"), riders: ridersFor(cp.id),
    my_status: mine?.status ?? null, is_creator: cp.creator_id === currentId,
    is_org_household: !!viewer && anchorOf(viewer) === cp.creator_id,
    active_ride: active ? rideOut(active) : null,
  };
}
function stopOut(s: StopRow): Stop {
  const f = findChild(s.child_id);
  const cp = carpoolById(rideById(s.ride_id)?.carpool_id ?? "");
  const sub = s.kind === "pickup" || s.kind === "drop"
    ? `${f?.parent.name ?? ""}${f?.parent.colony ? " · " + f.parent.colony : ""}`
    : s.kind === "school" ? "School gate" : "Organiser's home";
  return {
    id: s.id, ride_id: s.ride_id, child_id: s.child_id, seq: s.seq, kind: s.kind, lat: s.lat, lng: s.lng, label: s.label, sub,
    status: s.status, planned_eta_min: s.planned_eta_min, planned_at: s.planned_at, eta_min: s.eta_min, eta_at: s.eta_at,
    arrived_at: s.arrived_at, stopped_at: s.stopped_at, done_at: s.done_at, dwell_s: s.dwell_s, delay_min: s.delay_min,
    parent_id: f?.parent.id ?? (s.kind === "home_end" ? cp?.creator_id ?? null : null), child_name: f?.child.name ?? null,
  };
}
const stopsOut = (rid: string): Stop[] => stopsOf(rid).map(stopOut);
function rideOut(r: RideRow): Ride {
  const cp = carpoolById(r.carpool_id);
  return {
    id: r.id, carpool_id: r.carpool_id, driver_name: r.driver_name, driver_user_id: r.driver_user_id,
    driver_phone: (r.driver_user_id && byId(r.driver_user_id)?.phone) || r.driver_phone, driver_vehicle: r.driver_vehicle, order: [...r.order], status: r.status,
    direction: r.direction, origin_lat: r.origin_lat, origin_lng: r.origin_lng,
    started_at: r.started_at, ended_at: r.ended_at, last_lat: r.last_lat, last_lng: r.last_lng,
    last_heading: r.last_heading, last_update: r.last_update,
    planned_duration_min: r.planned_duration_min, actual_duration_min: r.actual_duration_min, on_time: r.on_time, distance_km: r.distance_km,
    carpool: cp ? carpoolOut(cp, false) : undefined, school: school(),
    stops: stopsOut(r.id), events: eventsOf(r.id).map(eventOut),
  };
}

// ---------------------------------------------------------------------------
// ETA model (SPEC §3) — mirrors _recent_speed_kmh / _eta_pass
// ---------------------------------------------------------------------------
function recentSpeedKmh(rid: string): number | null {
  const last5 = pingsOf(rid).slice(-5);
  let dk = 0, dt = 0;
  for (let i = 1; i < last5.length; i++) {
    const a = last5[i - 1], b = last5[i];
    const d = distKm(a.lat, a.lng, b.lat, b.lng) ?? 0;
    const sec = (ms(b.created_at) - ms(a.created_at)) / 1000;
    if (sec > 0 && d * 1000 >= settings.stationary_m) { dk += d; dt += sec; }
  }
  if (dt < 1 || dk <= 0) return null;
  const v = dk / (dt / 3600);
  if (v < 5) return null;
  return Math.min(v, 120);
}
const REMAINING: StopStatus[] = ["pending", "arriving", "stopped"];
function etaPass(rid: string, flat: number, flng: number, speed: number | null, baseMs: number, planned: boolean): number | null {
  const spd = speed == null || speed <= 0 ? settings.city_speed_kmh : speed;
  let cum = 0, plat = flat, plng = flng, last: number | null = null;
  for (const s of stopsOf(rid)) {
    if (!REMAINING.includes(s.status)) { if (!planned) { s.eta_min = null; s.eta_at = null; } continue; }
    cum += (((distKm(plat, plng, s.lat, s.lng) ?? 0) * settings.road_factor) / spd) * 60;
    const m = Math.max(0, Math.round(cum)); last = m;
    const at = iso(baseMs + cum * 60000);
    if (planned) { s.planned_eta_min = m; s.planned_at = at; } else { s.eta_min = m; s.eta_at = at; }
    cum += settings.dwell_s / 60;
    plat = s.lat; plng = s.lng;
  }
  return last;
}
const delayMin = (s: StopRow, tsMs: number): number | null => (s.planned_at ? Math.round((tsMs - ms(s.planned_at)) / 60000) : null);

// ---------------------------------------------------------------------------
// trip lifecycle
// ---------------------------------------------------------------------------
function tripDriverList(cid: string): TripDriver[] {
  const cp = carpoolById(cid); if (!cp) return [];
  const org = byId(cp.creator_id); if (!org) return [];
  const out: TripDriver[] = [];
  if (org.can_drive) out.push({ id: org.id, name: org.name, kind: "parent", phone: org.phone, vehicle: null, owner_name: null, confirmed: true });
  users.filter((u) => u.parent_owner_id === org.id && u.role === "addon" && u.relation === "driver")
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((d) => out.push({ id: d.id, name: d.name, kind: "driver", phone: d.phone, vehicle: d.vehicle?.plate ?? null, owner_name: org.name, confirmed: d.driver_status === "verified" }));
  return out;
}

// emitBus=false when the caller (postLocation) publishes loc → stops → ended itself,
// so watchers see exactly one `ended:<rideId>` per trip (same as the broadcast channel).
function endRideInternal(r: RideRow, note: string, emitBus = true) {
  if (r.status !== "active") return;
  const cp = carpoolById(r.carpool_id);
  const endedMs = nowMs();
  let onTime: boolean | null = null;
  if (r.direction === "from_school") {
    // the organiser's own children finish the run at the organiser's home
    if (cp) byId(cp.creator_id)?.children.filter((c) => riderStatus(cp.id, c.id) === "boarded").forEach((c) => evDrop(r, c.id, "home", true));
  } else {
    const gateDone = stopsOf(r.id).find((s) => s.kind === "school" && s.status === "done")?.done_at
      ?? eventsOf(r.id).find((e) => e.type === "reached_school")?.created_at ?? null;
    onTime = gateDone == null ? null : istSecondsOfDay(ms(gateDone)) <= timeToSeconds(settings.school_start_time);
  }
  const trail = pingsOf(r.id);
  let dist = 0;
  for (let i = 1; i < trail.length; i++) { const d = distKm(trail[i - 1].lat, trail[i - 1].lng, trail[i].lat, trail[i].lng) ?? 0; if (d < 5) dist += d; }
  r.status = "completed"; r.ended_at = iso(endedMs); r.on_time = onTime;
  r.actual_duration_min = Math.max(0, Math.round((endedMs - ms(r.started_at)) / 60000));
  r.distance_km = round(dist, 1);
  stopsOf(r.id).forEach((s) => { s.eta_min = null; s.eta_at = null; });
  addEvent(r.id, "ended", note || "Trip completed");
  if (emitBus) { emitStops(r.id); emit("ended:" + r.id, { ride_id: r.id }); }
  audience(r.carpool_id).forEach((u) => notify(u, "Trip completed", `"${cp?.name ?? "Carpool"}" has arrived. Thanks!`, "info"));
}
function sweepStale() {
  rides.filter((r) => r.status === "active" && istDate(ms(r.started_at)) < today())
    .forEach((r) => endRideInternal(r, "Trip auto-closed — the day ended"));
}

function startRideInternal(cid: string, driverUserId: string | null | undefined, order: string[] | null | undefined,
  direction: Direction | null | undefined, originLat: number | null | undefined, originLng: number | null | undefined): RideRow {
  sweepStale();
  const cp = carpoolById(cid); if (!cp) throw new Error("Carpool not found");
  const fam = cp.creator_id;
  if (anchor() !== fam) throw new Error("Only the organising family (or their driver) starts this carpool's trips — create your own carpool to drive.");
  const existing = activeRideOf(cid); if (existing) return existing;
  const cands = tripDriverList(cid);
  const chosen = (driverUserId ? cands.find((c) => c.id === driverUserId) : undefined)
    ?? cands.find((c) => c.id === currentId) ?? cands.find((c) => c.confirmed);
  if (!chosen) throw new Error("No one is set to drive this trip yet — pick a driver first.");
  if (!chosen.confirmed) throw new Error(`${chosen.name} is not confirmed to drive yet — the family must confirm their licence and vehicle first.`);
  const du = byId(chosen.id);
  let dv: string | null;
  if (chosen.kind === "driver") {
    const t = today();
    if ((du?.documents ?? []).some((d) => (d.type === "licence" || d.type === "insurance") && d.expiry && d.expiry < t))
      throw new Error(`${chosen.name} licence or insurance has expired — update it before starting.`);
    dv = du?.vehicle?.plate ?? null;
  } else dv = cp.driver_vehicle;
  const dn = chosen.name, dp = chosen.phone ?? du?.phone ?? null;
  const dir: Direction = direction === "from_school" || direction === "to_school" ? direction : (istHour(nowMs()) < 11 ? "to_school" : "from_school");
  const toSchool = dir !== "from_school";
  const family = byId(fam);
  const sch = school();
  let olat = originLat ?? null, olng = originLng ?? null;
  if (olat == null || olng == null) {
    if (toSchool && family?.home_lat != null && family.home_lng != null) { olat = family.home_lat; olng = family.home_lng; }
    else { olat = sch.lat; olng = sch.lng; }
  }
  // organiser's children FIRST (their home anchors the route), then the others in optimal order
  const famJoined = members.some((m) => m.carpool_id === cid && m.parent_id === fam && m.status === "joined");
  const own = toSchool && famJoined && family ? family.children.filter((c) => !isAbsent(cid, c.id)).map((c) => c.id) : [];
  const others = members.filter((m) => m.carpool_id === cid && m.status === "joined" && m.parent_id !== fam)
    .flatMap((m) => { const p = byId(m.parent_id); return p && p.home_lat != null && p.home_lng != null ? p.children.filter((c) => !isAbsent(cid, c.id)).map((c) => ({ id: c.id, name: c.name, lat: p.home_lat as number, lng: p.home_lng as number })) : []; });
  let rest: string[];
  if (order && order.length) {
    const valid = new Set(others.map((o) => o.id));
    rest = order.filter((id) => valid.has(id));
    others.forEach((o) => { if (!rest.includes(o.id)) rest.push(o.id); });
  } else {
    const anchorPt = toSchool && family?.home_lat != null && family.home_lng != null ? { lat: family.home_lat, lng: family.home_lng } : { lat: sch.lat, lng: sch.lng };
    rest = toSchool ? optimalOrder(others, anchorPt, { lat: sch.lat, lng: sch.lng }, null).map((o) => o.id)
                    : optimalOrder(others, { lat: sch.lat, lng: sch.lng }, null, null).map((o) => o.id);
  }
  const ord = [...own, ...rest];
  const startMs = nowMs();
  const r: RideRow = {
    id: uid(), carpool_id: cid, driver_user_id: chosen.id, driver_name: dn, driver_phone: dp, driver_vehicle: dv,
    order: ord, direction: dir, origin_lat: olat, origin_lng: olng, status: "active", started_at: iso(startMs), ended_at: null,
    last_lat: olat, last_lng: olng, last_heading: null, last_update: iso(startMs),
    planned_duration_min: null, actual_duration_min: null, on_time: null, distance_km: null,
  };
  rides.push(r);
  // ride_stops: school run = pickups (organiser first) then the gate; home run = gate, drops, home_end
  let seq = 0;
  const mkStop = (kind: StopKind, lat: number, lng: number, label: string, childId: string | null = null) => {
    stops.push({ id: uid(), ride_id: r.id, child_id: childId, seq: ++seq, kind, lat, lng, label, status: "pending",
      planned_eta_min: null, planned_at: null, eta_min: null, eta_at: null, arrived_at: null, stopped_at: null, done_at: null, dwell_s: null, delay_min: null });
  };
  if (!toSchool) mkStop("school", sch.lat, sch.lng, sch.name);
  ord.forEach((cidKid) => {
    const f = findChild(cidKid);
    if (f && f.parent.home_lat != null && f.parent.home_lng != null) mkStop(toSchool ? "pickup" : "drop", f.parent.home_lat, f.parent.home_lng, f.child.name, cidKid);
  });
  // Absent children still get a stop row, marked "skipped", so the rail shows "Absent"
  // (SPEC §3) — never routed, never ETA'd, never counted as missed. Mirrors the SQL.
  members.filter((m) => m.carpool_id === cid && m.status === "joined").forEach((m) => {
    const parent = byId(m.parent_id); if (!parent || parent.home_lat == null || parent.home_lng == null) return;
    if (!toSchool && parent.id === fam) return;
    parent.children.filter((c) => isAbsent(cid, c.id)).forEach((c) => {
      mkStop(toSchool ? "pickup" : "drop", parent.home_lat as number, parent.home_lng as number, c.name, c.id);
      stops[stops.length - 1].status = "skipped";
    });
  });
  if (toSchool) mkStop("school", sch.lat, sch.lng, sch.name);
  else if (family?.home_lat != null && family.home_lng != null) mkStop("home_end", family.home_lat, family.home_lng, `${family.name}'s home`);
  // planned ETAs: same formula from the origin at city speed, fixed for the trip
  r.planned_duration_min = etaPass(r.id, olat, olng, null, startMs, true);
  etaPass(r.id, olat, olng, null, startMs, false);
  addEvent(r.id, "started", `Trip started — ${dn} driving (${toSchool ? "pickup run" : "drop-home run"})`);
  audience(cid).forEach((u) => notify(u, "Trip started", `"${cp.name}" is on the way with ${dn}. Track it live.`, "trip"));
  if (toSchool) {
    const firstKid = ord.map(findChild).find((f) => f && f.parent.id !== fam);
    const st = firstKid ? stopsOf(r.id).find((s) => s.child_id === firstKid.child.id) : null;
    if (firstKid && st?.planned_eta_min != null)
      notify(firstKid.parent.id, "You're first after the organiser 🚗", `${dn} is about ${Math.max(1, Math.round(st.planned_eta_min))} min away — please have ${firstKid.child.name} ready.`, "trip");
  }
  emitStops(r.id);
  return r;
}

// STOP-DETECTION state machine + live ETAs + anomalies + auto-end — a line-for-line
// transcription of app_post_location (schema.sql).
function postLocationInternal(rid: string, clat: number, clng: number, speedKmh: number | null, heading: number | null): LocationResult {
  const r = rideById(rid);
  if (!r || r.status !== "active") throw new Error("This trip has already ended.");
  if (!canActOnRide(r)) throw new Error("Only the trip driver or a member can share location");
  const st = settings;
  const tsMs = nowMs(), ts = iso(tsMs);
  const km = distKm(clat, clng, st.school_lat, st.school_lng);
  const cid = r.carpool_id, drv = r.driver_user_id, toSchool = r.direction !== "from_school";
  const cp = carpoolById(cid); const fam = cp?.creator_id ?? ""; const nm = cp?.name ?? "Carpool";
  const dwellReq = typeof G.__VVS_DWELL_MS === "number" ? G.__VVS_DWELL_MS / 1000 : st.dwell_s;
  const near_m = st.fence_near_m, stop_m = st.fence_stop_m, leave_m = st.fence_leave_m, miss_m = st.fence_miss_m;
  const gate_m = st.school_gate_m, gate_leave_m = st.school_gate_m + Math.max(0, st.fence_leave_m - st.fence_stop_m);
  const anomalies: string[] = []; let ended = false;

  // previous ping → stationary flag + ping-to-ping speed
  const trail = pingsOf(rid); const prev = trail[trail.length - 1] ?? null;
  const pmove = prev ? (distKm(prev.lat, prev.lng, clat, clng) ?? 0) * 1000 : null;   // metres
  const pdt = prev ? (tsMs - ms(prev.created_at)) / 1000 : null;                         // seconds
  const stationary = pmove != null && pmove < st.stationary_m;
  const p2p = pmove != null && pdt != null && pdt >= 3 ? (pmove / 1000) / (pdt / 3600) : null;
  const spd = speedKmh ?? p2p;
  const notAbsentJoinedChildren = () => members.filter((m) => m.carpool_id === cid && m.status === "joined")
    .flatMap((m) => { const p = byId(m.parent_id); return p ? p.children.filter((c) => !isAbsent(cid, c.id)).map((c) => ({ child: c, parent: p })) : []; });

  // ---- child stops (pickup on a school run / drop on a home run) ----
  for (const s of stopsOf(rid)) {
    if (!(s.kind === "pickup" || s.kind === "drop") || !REMAINING.includes(s.status) || !s.child_id) continue;
    const f = findChild(s.child_id); if (!f) continue;
    const rs = riderStatus(cid, s.child_id);
    if (!((toSchool && rs === "waiting") || (!toSchool && rs === "boarded"))) continue;
    const d = (distKm(clat, clng, s.lat, s.lng) ?? NaN) * 1000; if (Number.isNaN(d)) continue;
    let cur: StopStatus = s.status;
    if (cur === "pending" && d < near_m) {
      s.status = "arriving"; s.arrived_at = ts; cur = "arriving";
      addEvent(rid, "arriving", `Arriving at ${f.child.name}'s stop`, s.child_id);
      const etaTxt = Math.max(1, s.eta_min ?? 1);
      notify(f.parent.id, toSchool ? "Driver arriving 🚗" : "Reaching your home 🏡",
        toSchool ? `Please have ${f.child.name} ready — the carpool reaches you in ~${etaTxt} min.`
                 : `${f.child.name} is ~${etaTxt} min from home — please be ready to receive them.`, "trip");
    }
    if (cur === "arriving" && d < stop_m && stationary) {
      s.status = "stopped"; s.stopped_at = ts; s.dwell_s = 0; cur = "stopped";
      addEvent(rid, "stopped", `Stopped at ${f.child.name}'s stop`, s.child_id);
    } else if (cur === "stopped") {
      const dwell = Math.max(0, Math.floor((tsMs - ms(s.stopped_at)) / 1000));
      if (d > leave_m) {
        if (dwell >= dwellReq) {
          s.status = "done"; s.done_at = ts; s.dwell_s = dwell; s.delay_min = delayMin(s, tsMs); cur = "done";
          if (toSchool) evBoard(r, s.child_id, true); else evDrop(r, s.child_id, "home", true);
        } else { s.status = "arriving"; s.stopped_at = null; s.dwell_s = null; cur = "arriving"; }   // rolling stop
      } else s.dwell_s = dwell;
    }
    if (cur === "arriving" && d > miss_m) {
      s.status = "missed"; s.stopped_at = null; s.dwell_s = null;
      if (toSchool) {
        addEvent(rid, "missed_pickup", `Possible missed pickup — the car left ${f.child.name} at the stop without stopping`, s.child_id);
        notify(f.parent.id, "Missed pickup? ⚠️", `The carpool left your area without stopping — ${f.child.name} is NOT marked on board. Call the driver if this is unexpected.`, "trip");
        notify(drv, "Missed a pickup? ⚠️", `It looks like ${f.child.name} was not picked up. Turn back, or their parent will make other arrangements.`, "trip");
      } else {
        addEvent(rid, "missed_pickup", `Possible missed drop-off — the car passed ${f.child.name}'s home without stopping`, s.child_id);
        notify(f.parent.id, "Drop-off skipped? ⚠️", `The carpool passed your home without stopping — ${f.child.name} is still on board. Call the driver.`, "trip");
        notify(drv, "Missed a drop-off? ⚠️", `It looks like ${f.child.name} was not dropped at home. Please turn back.`, "trip");
      }
    }
  }

  // ---- the school gate ----
  const gate = stopsOf(rid).find((s) => s.kind === "school");
  if (gate && REMAINING.includes(gate.status) && km != null) {
    const d = km * 1000; let cur: StopStatus = gate.status;
    if (cur === "pending" && d < near_m) {
      gate.status = "arriving"; gate.arrived_at = ts; cur = "arriving";
      addEvent(rid, "arriving", "Arriving at the school gate");
      if (toSchool) audience(cid).forEach((u) => notify(u, "Arriving at school 🏫", "The carpool is reaching the school gate.", "trip"));
    }
    if (toSchool) {
      if (cur === "arriving" && d < gate_m) { gate.status = "done"; gate.done_at = ts; gate.delay_min = delayMin(gate, tsMs); }
    } else if (cur === "arriving" && d < gate_m && stationary) {
      gate.status = "stopped"; gate.stopped_at = ts; gate.dwell_s = 0;
      addEvent(rid, "stopped", "Stopped at the school gate");
    } else if (cur === "stopped") {
      const dwell = Math.max(0, Math.floor((tsMs - ms(gate.stopped_at)) / 1000));
      if (d > gate_leave_m) {
        if (dwell >= dwellReq) {
          gate.status = "done"; gate.done_at = ts; gate.dwell_s = dwell; gate.delay_min = delayMin(gate, tsMs);
          notAbsentJoinedChildren().filter((x) => riderStatus(cid, x.child.id) === "waiting").forEach((x) => evBoard(r, x.child.id, true));
        } else { gate.status = "arriving"; gate.stopped_at = null; gate.dwell_s = null; }
      } else gate.dwell_s = dwell;
    }
  }
  // school run: anyone still on board inside the gate fence has reached school
  if (toSchool && km != null && km * 1000 < gate_m) {
    members.filter((m) => m.carpool_id === cid && m.status === "joined").forEach((m) => {
      byId(m.parent_id)?.children.filter((c) => riderStatus(cid, c.id) === "boarded").forEach((c) => evDrop(r, c.id, "school", true));
    });
  }
  // ---- home_end (home run): arriving alert only; completion is the auto-end below ----
  const homeEnd = stopsOf(rid).find((s) => s.kind === "home_end");
  if (homeEnd && homeEnd.status === "pending" && (distKm(clat, clng, homeEnd.lat, homeEnd.lng) ?? Infinity) * 1000 < near_m) {
    homeEnd.status = "arriving"; homeEnd.arrived_at = ts;
    addEvent(rid, "arriving", "Arriving at the organiser's home");
  }

  // ---- live ETAs for the remaining stops (ETA of the final remaining stop) ----
  const e = etaPass(rid, clat, clng, recentSpeedKmh(rid), tsMs, false);

  // ---- anomalies ----
  // off-route (> offroute_km from the planned corridor), once per trip
  const corridor: [number, number][] = r.order.map(findChild).filter((f) => f && f.parent.home_lat != null && f.parent.home_lng != null)
    .map((f) => [f!.parent.home_lat as number, f!.parent.home_lng as number]);
  corridor.push([st.school_lat, st.school_lng]);
  let off: number | null = null;
  if (corridor.length < 2) off = distKm(clat, clng, corridor[0][0], corridor[0][1]);
  else for (let i = 0; i < corridor.length - 1; i++) {
    const dd = distRouteKm(clat, clng, corridor[i][0], corridor[i][1], corridor[i + 1][0], corridor[i + 1][1]);
    if (off == null || dd < off) off = dd;
  }
  if (off != null && off > st.offroute_km && !eventsOf(rid).some((ev) => ev.type === "route_alert")) {
    const kmOff = round(off, 1);
    addEvent(rid, "route_alert", `Route alert — the car is ~${kmOff} km off the planned route`);
    audience(cid).forEach((u) => notify(u, "Route alert 🚨", `The carpool is about ${kmOff} km off its planned route. Open Track and call the driver if this is unexpected.`, "sos"));
    anomalies.push("route_alert");
  }
  // long stop: stationary ≥ long_stop_s away from every stop / the gate, once per stationary episode
  if (stationary) {
    const nearAny = stopsOf(rid).some((s) => (distKm(clat, clng, s.lat, s.lng) ?? Infinity) * 1000 < (s.kind === "school" || s.kind === "home_end" ? Math.max(stop_m, gate_m) : stop_m));
    if (!nearAny) {
      const recent = trail.slice(-200);
      let episodeStart: number | null = null;
      for (let i = 1; i < recent.length; i++) {
        if ((distKm(recent[i - 1].lat, recent[i - 1].lng, recent[i].lat, recent[i].lng) ?? 0) * 1000 >= st.stationary_m) episodeStart = ms(recent[i].created_at);
      }
      if (episodeStart == null) episodeStart = trail.length ? ms(trail[0].created_at) : ms(r.started_at);
      const secs = (tsMs - episodeStart) / 1000;
      if (secs >= st.long_stop_s && !eventsOf(rid).some((ev) => ev.type === "anomaly_long_stop" && ms(ev.created_at) >= episodeStart!)) {
        const mins = Math.round(secs / 60);
        addEvent(rid, "anomaly_long_stop", `Long stop — the car has been stationary for ~${mins} min away from any stop`);
        audience(cid).forEach((u) => notify(u, "Long stop ⚠️", `"${nm}" has been stationary for ~${mins} min away from any stop. Check in with the driver.`, "trip"));
        anomalies.push("long_stop");
      }
    }
  }
  // speeding: ping-to-ping speed over the limit, interval ≥ 5 s, plausible distance, max once per 5 min
  if (p2p != null && pdt != null && pmove != null && pdt >= 5 && pmove >= st.stationary_m && p2p > st.speed_max_kmh && p2p <= 250
      && !eventsOf(rid).some((ev) => ev.type === "anomaly_speed" && ms(ev.created_at) > tsMs - 5 * 60000)) {
    addEvent(rid, "anomaly_speed", `Speeding — ~${Math.round(p2p)} km/h between fixes (limit ${st.speed_max_kmh} km/h)`);
    audience(cid).forEach((u) => notify(u, "Speeding ⚠️", `"${nm}" was doing ~${Math.round(p2p)} km/h (limit ${st.speed_max_kmh}).`, "trip"));
    anomalies.push("speed");
  }

  // ---- trail + car position ----
  r.last_lat = clat; r.last_lng = clng; r.last_heading = heading ?? r.last_heading; r.last_update = ts;
  pings.push({ id: ++pingSeq, ride_id: rid, lat: clat, lng: clng, eta_min: e, distance_km: roundN(km, 1),
    speed_kmh: roundN(spd, 1), heading: roundN(heading, 1), created_at: ts });

  // ---- AUTO END: every travelling child accounted for (dropped, or flagged missed) ----
  const fin = notAbsentJoinedChildren();
  const settled = (childId: string) => riderStatus(cid, childId) === "dropped" || stopsOf(rid).some((s) => s.child_id === childId && s.status === "missed");
  const others = fin.filter((x) => x.parent.id !== fam), own = fin.filter((x) => x.parent.id === fam);
  const allDone = fin.every((x) => settled(x.child.id));
  const schoolDone = stopsOf(rid).some((s) => s.kind === "school" && s.status === "done") || eventsOf(rid).some((ev) => ev.type === "reached_school");
  if (fin.length > 0) {
    if (toSchool && allDone && schoolDone) {
      endRideInternal(r, "Trip completed — everyone reached school", false); ended = true;
    } else if (!toSchool && others.every((x) => settled(x.child.id))) {
      const family = byId(fam);
      if (own.length === 0 && eventsOf(rid).some((ev) => ev.type === "reached_home")) {
        stopsOf(rid).filter((s) => s.kind === "home_end" && (s.status === "pending" || s.status === "arriving")).forEach((s) => { s.status = "skipped"; });
        endRideInternal(r, "Trip completed — everyone reached home", false); ended = true;
      } else if (own.length > 0 && family?.home_lat != null && family.home_lng != null
                 && (distKm(clat, clng, family.home_lat, family.home_lng) ?? Infinity) * 1000 < leave_m) {
        stopsOf(rid).filter((s) => s.kind === "home_end" && (s.status === "pending" || s.status === "arriving"))
          .forEach((s) => { s.status = "done"; s.done_at = ts; s.delay_min = delayMin(s, tsMs); });
        endRideInternal(r, "Trip completed — everyone reached home", false); ended = true;
      }
    }
  }

  const result: LocationResult = { ride_id: rid, lat: clat, lng: clng, eta_min: e, distance_km: roundN(km, 1), stops: stopsOut(rid), ended, anomalies };
  emit("loc:" + rid, { ride_id: rid, lat: clat, lng: clng, heading: heading ?? null, eta_min: e, distance_km: result.distance_km });
  emit("stops:" + rid, result.stops);
  if (ended) emit("ended:" + rid, { ride_id: rid });
  return result;
}

// ---------------------------------------------------------------------------
// analytics (mirrors _carpool_stats)
// ---------------------------------------------------------------------------
function carpoolStatsFor(cid: string | null): CarpoolStats {
  const done = rides.filter((r) => r.status === "completed" && (cid == null || r.carpool_id === cid));
  const withOT = done.filter((r) => r.on_time != null);
  const durs = done.filter((r) => r.actual_duration_min != null).map((r) => r.actual_duration_min as number);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const childStops = done.flatMap((r) => stopsOf(r.id).filter((s) => s.kind === "pickup" || s.kind === "drop"));
  const delays = childStops.filter((s) => s.status === "done" && s.delay_min != null).map((s) => s.delay_min as number);
  const counted = childStops.filter((s) => s.status !== "skipped").length;
  const trend = [...done].sort((a, b) => ms(b.started_at) - ms(a.started_at)).slice(0, 10).sort((a, b) => ms(a.started_at) - ms(b.started_at))
    .map((r) => {
      const dl = stopsOf(r.id).filter((s) => (s.kind === "pickup" || s.kind === "drop") && s.status === "done" && s.delay_min != null).map((s) => s.delay_min as number);
      return { date: istDate(ms(r.started_at)), on_time: r.on_time, duration_min: r.actual_duration_min, delay_min: roundN(avg(dl)) };
    });
  return {
    trips: done.length,
    on_time_pct: withOT.length ? round((100 * withOT.filter((r) => r.on_time).length) / withOT.length) : null,
    avg_pickup_delay_min: roundN(avg(delays), 1),
    missed_rate: counted ? round(childStops.filter((s) => s.status === "missed").length / counted, 3) : null,
    avg_duration_min: roundN(avg(durs), 1),
    trend,
  };
}
function tripSummary(r: RideRow): TripSummary {
  const ss = stopsOf(r.id);
  return { id: r.id, carpool_id: r.carpool_id, carpool_name: carpoolById(r.carpool_id)?.name ?? "—", direction: r.direction,
    driver_name: r.driver_name, started_at: r.started_at, ended_at: r.ended_at, on_time: r.on_time, duration_min: r.actual_duration_min,
    distance_km: r.distance_km, missed_count: ss.filter((s) => s.status === "missed").length, stops_done: ss.filter((s) => s.status === "done").length,
    stops_total: ss.filter((s) => s.status !== "skipped").length, events: eventsOf(r.id).map(eventOut) };
}
function canSeeRide(r: RideRow): boolean {
  const u = byId(currentId); if (!u) return false;
  return u.role === "admin" || r.driver_user_id === u.id || joinedCarpoolIds(anchorOf(u)).includes(r.carpool_id);
}

// ---------------------------------------------------------------------------
// settings validation (mirrors app_set_settings)
// ---------------------------------------------------------------------------
function patchInt(patch: Partial<Settings>, k: keyof Settings, cur: number, lo: number, hi: number): number {
  const raw = patch[k]; if (raw == null) return cur;
  const v = Math.round(Number(raw)); if (Number.isNaN(v)) throw new Error(`${k} must be a number`);
  if (v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
  return v;
}
function patchNum(patch: Partial<Settings>, k: keyof Settings, cur: number, lo: number, hi: number): number {
  const raw = patch[k]; if (raw == null) return cur;
  const v = Number(raw); if (Number.isNaN(v)) throw new Error(`${k} must be a number`);
  if (v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
  return v;
}
function patchTime(patch: Partial<Settings>, k: "school_start_time" | "school_end_time", cur: string): string {
  const raw = patch[k]; if (raw == null) return cur;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw).trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`${k} must be a time like 07:50`);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------
function seed() {
  tnc.push({ version: 1, body: TNC_V1, published_at: nowISO() });
  mkUser({ id: ADMIN.id, role: "admin", name: ADMIN.name, email: ADMIN.email, status: "approved", tnc_version: 1 });
  FAMILIES.forEach((f) => {
    const u = mkUser({ id: f.id, name: f.name, email: f.email, phone: f.phone, colony: f.colony, pincode: f.pincode, address: f.address,
      home_lat: SCHOOL.lat + f.dLat, home_lng: SCHOOL.lng + f.dLng, existing_carpool: f.existing_carpool, can_drive: f.can_drive,
      status: f.status, tnc_version: 1, vehicle: f.vehicle ?? null });
    f.kids.forEach((k) => u.children.push({ id: uid(), name: k.name, class_level: k.class_level, gender: k.gender,
      allergies: k.allergies ?? null, emergency_name: k.emergency_name ?? null, emergency_phone: k.emergency_phone ?? null, photo_url: null }));
  });
  ADDONS.forEach((a) => {
    invites.push({ id: uid(), parent_id: a.owner, name: a.name, email: a.email, relation: a.relation });
    mkUser({ id: a.id, role: "addon", name: a.name, email: a.email, relation: a.relation, parent_owner_id: a.owner, status: "approved", tnc_version: 1,
      phone: a.phone ?? null, vehicle: a.vehicle ?? null, documents: a.documents?.map((d) => ({ ...d })) ?? [], driver_status: a.driver_status ?? null });
  });
  carpools.push({ id: CARPOOL.id, name: CARPOOL.name, creator_id: CARPOOL.creator_id, driver_name: CARPOOL.driver_name, driver_phone: CARPOOL.driver_phone,
    driver_vehicle: CARPOOL.driver_vehicle, seats: CARPOOL.seats, created_at: iso(nowMs() - 14 * 86400e3) });
  CARPOOL.members.forEach((m) => members.push({ carpool_id: CARPOOL.id, parent_id: m.parent_id, role: m.role, status: m.status }));
  SEED_CHAT.forEach((c) => { const u = byId(c.sender)!; chats.push({ id: uid(), carpool_id: CARPOOL.id, sender_id: u.id, sender_name: u.name, body: c.body, created_at: iso(nowMs() - c.minutesAgo * 60000) }); });
  seedHistory();
}

// Drive the seeded carpool through a few REAL trips (past days, IST times) so
// history, replay, per-stop delays, punctuality and incidents exist on first open.
function seedHistory() {
  const real = Date.now();
  const [ty, tm, td] = istDate(real).split("-").map(Number);
  const istAt = (daysAgo: number, hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return Date.UTC(ty, tm - 1, td - daysAgo, h, m, 0) - IST_OFFSET_MS; };
  const tick = (s: number) => { clockOverride = (clockOverride ?? real) + s * 1000; };
  const bearing = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const r = (x: number) => (x * Math.PI) / 180, y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
    const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  const post = (r: RideRow, p: { lat: number; lng: number }, spd: number | null, hd: number | null) => {
    if (r.status !== "active") return;
    postLocationInternal(r.id, p.lat, p.lng, spd, hd);
  };
  const drive = (r: RideRow, from: { lat: number; lng: number }, to: { lat: number; lng: number }, kmh: number) => {
    const d = (distKm(from.lat, from.lng, to.lat, to.lng) ?? 0) * 1000;
    const n = Math.max(1, Math.ceil(d / 160)); const hd = bearing(from, to);
    for (let i = 1; i <= n; i++) {
      const f = i / n; const jitter = ((i * 7) % 5) - 2;
      tick((d / n) / (kmh / 3.6));
      post(r, { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f }, kmh + jitter, hd);
    }
  };
  const halt = (r: RideRow, p: { lat: number; lng: number }, seconds: number) => { tick(4); post(r, p, 0, null); tick(seconds); post(r, p, 0, null); };
  const asha = byId("asha")!, neha = byId("neha")!;
  const ashaHome = { lat: asha.home_lat as number, lng: asha.home_lng as number };
  const nehaHome = { lat: neha.home_lat as number, lng: neha.home_lng as number };
  const gate = { lat: SCHOOL.lat, lng: SCHOOL.lng };
  const kabirName = neha.children[0].name;

  const run = (t: SeedTrip) => {
    clockOverride = istAt(t.daysAgo, t.startIst);
    currentId = t.driver;
    const toSchool = t.direction === "to_school";
    const r = startRideInternal(CARPOOL.id, t.driver, null, t.direction, toSchool ? ashaHome.lat : gate.lat, toSchool ? ashaHome.lng : gate.lng);
    if (toSchool) {
      halt(r, ashaHome, t.stopDwellS);                       // Riya boards at the organiser's home
      if (t.skipStopFor === kabirName) {
        const passBy = { lat: nehaHome.lat + 0.0022, lng: nehaHome.lng };
        drive(r, ashaHome, passBy, t.speedKmh); drive(r, passBy, gate, t.speedKmh);   // drives past Kabir → missed
      } else {
        drive(r, ashaHome, nehaHome, t.speedKmh); halt(r, nehaHome, t.stopDwellS); drive(r, nehaHome, gate, t.speedKmh);
      }
      if (r.status === "active") { tick(20); post(r, gate, 0, null); }
    } else {
      tick(3); post(r, gate, 0, null); halt(r, gate, t.stopDwellS);   // stop at the gate → everyone boards
      drive(r, gate, nehaHome, t.speedKmh); halt(r, nehaHome, t.stopDwellS);
      drive(r, nehaHome, ashaHome, t.speedKmh);
      if (r.status === "active") { tick(15); post(r, ashaHome, 0, null); }
    }
    if (r.status === "active") endRideInternal(r, "Trip completed");
  };
  SEED_TRIPS.forEach(run);
  notifs.forEach((n) => { n.read = true; });
  clockOverride = null; currentId = null;
}
seed();

// ---------------------------------------------------------------------------
// public backend
// ---------------------------------------------------------------------------
const latency = () => (typeof G.__VVS_LATENCY_MS === "number" ? G.__VVS_LATENCY_MS : 60);
const wait = <T>(v: T): Promise<T> => new Promise((res) => setTimeout(() => res(v), latency()));
const OK = { ok: true } as const;

function resolveSignIn(email: string): SignInResult {
  const em = email.trim().toLowerCase();
  let u = byEmail(em);
  if (!u) {
    // a signed-up email that matches a family add-on invite links itself to that family
    const inv = invites.find((i) => i.email === em);
    if (inv) u = mkUser({ role: "addon", name: inv.name, email: em, parent_owner_id: inv.parent_id, relation: inv.relation, status: "approved", tnc_version: latestTncVersion() });
  }
  if (!u) { currentId = null; pendingEmail = em; return { status: "new", email: em }; }
  currentId = u.id; pendingEmail = null;
  const profile = profileOut(u);
  if (u.status === "pending" || u.status === "rejected") return { status: u.status, profile };
  return { status: "in", profile };
}

export const demoBackend: Backend = {
  // ---- pre-login ----
  publicConfig: async () => ({ demo_logins: true, school_name: SCHOOL.name }),

  // ---- auth / profile ----
  signIn: async (email) => wait(resolveSignIn(email)),
  signUp: async (email) => wait(resolveSignIn(email)),
  signOut: async () => { currentId = null; pendingEmail = null; await wait(undefined); },
  getProfile: async () => wait(currentId ? profileOut(me()) : null),
  register: async (email, data: RegisterData) => {
    const em = (email || pendingEmail || "").trim().toLowerCase();
    if (!em) throw new Error("Sign in first");
    let u = byEmail(em);
    if (u) { u.name = data.name || u.name; }
    else {
      u = mkUser({ name: data.name, email: em, phone: data.phone ?? null, address: data.address ?? null, colony: data.colony ?? null, pincode: data.pincode ?? null,
        home_lat: data.home_lat ?? null, home_lng: data.home_lng ?? null, existing_carpool: !!data.existing_carpool, can_drive: data.can_drive !== false,
        status: "pending", tnc_version: data.accept_tnc ? latestTncVersion() : 0 });
      if (data.child_name && data.child_name.trim())
        u.children.push({ id: uid(), name: data.child_name, class_level: Number(data.child_class) || 1, gender: data.child_gender ?? null });
    }
    currentId = u.id; pendingEmail = null;
    users.filter((x) => x.role === "admin").forEach((a) => notify(a.id, "New registration to verify", `${data.name} registered and needs verification.`, "system"));
    notify(u.id, "Registration received", "Your details were sent to the school for verification.", "system");
    return wait(profileOut(u));
  },
  pendingInvite: async () => {
    if (currentId || !pendingEmail) return wait(null);
    const inv = invites.find((i) => i.email === pendingEmail);
    return wait(inv ? { name: inv.name, relation: inv.relation ?? "", parent_name: byId(inv.parent_id)?.name ?? "" } : null);
  },
  updateProfile: async (patch) => {
    const u = me();
    if (patch.name != null) u.name = patch.name;
    if (patch.phone != null) u.phone = patch.phone;
    if (patch.address != null) u.address = patch.address;
    if (patch.colony != null) u.colony = patch.colony;
    if (patch.pincode != null) u.pincode = patch.pincode;
    if (patch.home_lat != null) u.home_lat = patch.home_lat;
    if (patch.home_lng != null) u.home_lng = patch.home_lng;
    if (patch.existing_carpool != null) u.existing_carpool = patch.existing_carpool;
    if (patch.can_drive != null) u.can_drive = patch.can_drive;
    if (patch.photo_url !== undefined) u.photo_url = patch.photo_url ?? null;
    return wait(profileOut(u));
  },
  addChild: async (c) => {
    const u = me();
    u.children.push({ id: uid(), name: c.name, class_level: Number(c.class_level) || 1, gender: c.gender ?? null, allergies: c.allergies ?? null,
      emergency_name: c.emergency_name ?? null, emergency_phone: c.emergency_phone ?? null, photo_url: c.photo_url ?? null });
    return wait(profileOut(u));
  },
  updateChild: async (childId, patch) => {
    const u = me(); const c = u.children.find((x) => x.id === childId);
    if (c) {
      if (patch.name != null) c.name = patch.name;
      if (patch.class_level != null) c.class_level = Number(patch.class_level) || c.class_level;
      if (patch.gender != null) c.gender = patch.gender;
      if (patch.allergies != null) c.allergies = patch.allergies;
      if (patch.emergency_name != null) c.emergency_name = patch.emergency_name;
      if (patch.emergency_phone != null) c.emergency_phone = patch.emergency_phone;
      if (patch.photo_url !== undefined) c.photo_url = patch.photo_url ?? null;
    }
    return wait(profileOut(u));
  },
  removeChild: async (childId) => { const u = me(); u.children = u.children.filter((c) => c.id !== childId); return wait(profileOut(u)); },
  addAddon: async (a) => {
    const u = me();
    invites.push({ id: uid(), parent_id: u.id, name: a.name, email: a.email.trim().toLowerCase(), relation: a.relation });
    return wait(profileOut(u));
  },
  removeAddon: async (addonId) => {
    const u = me();
    const au = byId(addonId);
    for (let i = invites.length - 1; i >= 0; i--) if (invites[i].parent_id === u.id && (invites[i].id === addonId || (au && invites[i].email === au.email))) invites.splice(i, 1);
    const ix = users.findIndex((x) => x.id === addonId && x.parent_owner_id === u.id); if (ix >= 0) users.splice(ix, 1);
    return wait(profileOut(u));
  },
  confirmDriver: async (addonId, confirmed, plate) => {
    const u = me(); const au = byId(addonId);
    if (au && au.parent_owner_id === u.id && au.relation === "driver") {
      au.driver_status = confirmed ? "verified" : "incomplete";
      if (plate != null) au.vehicle = { ...(au.vehicle ?? {}), plate };
    }
    notify(addonId, confirmed ? "You're confirmed to drive ✅" : "Driving not confirmed",
      confirmed ? "Your family confirmed you can drive their carpool trips." : "Your family hasn't confirmed you to drive yet.", confirmed ? "approved" : "info");
    return wait(profileOut(u));
  },
  acceptTnc: async () => { const u = me(); u.tnc_version = latestTncVersion(); return wait(profileOut(u)); },
  latestTnc: async () => { const t = [...tnc].sort((a, b) => b.version - a.version)[0]; return wait(t ? { version: t.version, body: t.body } : null); },
  addTrusted: async (t) => { const u = me(); u.trusted.push({ id: uid(), name: t.name, phone: t.phone }); return wait(profileOut(u)); },
  removeTrusted: async (id) => { const u = me(); u.trusted = u.trusted.filter((t) => t.id !== id); return wait(profileOut(u)); },

  // ---- driver ----
  getDriverProfile: async () => wait(profileOut(me())),
  updateDriverProfile: async (patch) => {
    const u = me();
    if (patch.vehicle) u.vehicle = { ...(u.vehicle ?? {}), ...patch.vehicle };
    if (patch.photo_url != null) u.photo_url = patch.photo_url;
    return wait(profileOut(u));
  },
  addDriverDoc: async (doc) => {
    const u = me();
    u.documents.push({ id: uid(), type: doc.type as DriverDoc["type"], number: doc.number, expiry: doc.expiry, status: "verified" });
    recomputeDriver(u);
    return wait(profileOut(u));
  },
  removeDriverDoc: async (docId) => { const u = me(); u.documents = u.documents.filter((d) => d.id !== docId); recomputeDriver(u); return wait(profileOut(u)); },
  myDriverCarpools: async () => wait(joinedCarpoolIds(anchor()).map(carpoolById).filter((c): c is CarpoolRow => !!c).map((c) => carpoolOut(c))),

  // ---- discovery ----
  searchParents: async (f: Filters): Promise<Discovery> => {
    const m = me(); const sch = school();
    const radius = f.radius_km && f.radius_km !== "all" ? Number(f.radius_km) : null;
    const jit = (n: number | null) => roundN(n, 3);
    let parents: ParentPin[] = users.filter((p) => p.role === "parent" && p.status === "approved" && p.id !== m.id).map((p) => {
      const hkm = distKm(m.home_lat, m.home_lng, p.home_lat, p.home_lng);
      const rkm = p.home_lat != null && p.home_lng != null && m.home_lat != null && m.home_lng != null
        ? distRouteKm(p.home_lat, p.home_lng, m.home_lat, m.home_lng, sch.lat, sch.lng) : null;
      return { id: p.id, name: p.name, colony: p.colony, pincode: p.pincode, phone: p.phone, home_lat: jit(p.home_lat), home_lng: jit(p.home_lng),
        existing_carpool: p.existing_carpool, children: p.children.map((c) => ({ name: c.name, class_level: c.class_level, gender: c.gender ?? null })),
        distance_km: roundN(hkm, 2), distance_from_route_km: roundN(rkm, 2) };
    });
    if (f.pincode) parents = parents.filter((p) => String(p.pincode ?? "") === String(f.pincode));
    if (radius != null) parents = parents.filter((p) => p.distance_km != null && p.distance_km <= radius);
    if (f.class_min) parents = parents.filter((p) => p.children.some((k) => k.class_level >= Number(f.class_min)));
    if (f.class_max) parents = parents.filter((p) => p.children.some((k) => k.class_level <= Number(f.class_max)));
    if (f.gender) parents = parents.filter((p) => p.children.some((k) => (k.gender ?? "") === f.gender));
    parents.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));

    const nearby: NearbyCarpool[] = [];
    carpools.forEach((cp) => {
      const mine = members.find((x) => x.carpool_id === cp.id && x.parent_id === m.id);
      if (cp.creator_id === m.id || mine?.status === "joined") return;
      const homes = members.filter((x) => x.carpool_id === cp.id && x.status === "joined").map((x) => byId(x.parent_id))
        .filter((p): p is UserRow => !!p && p.home_lat != null)
        .map((p) => ({ p, dkm: distKm(m.home_lat, m.home_lng, p.home_lat, p.home_lng) }))
        .sort((a, b) => (a.dkm ?? 1e9) - (b.dkm ?? 1e9));
      const nd = homes[0]; if (!nd) return;
      if (radius != null && !(nd.dkm != null && nd.dkm <= radius)) return;
      nearby.push({ id: cp.id, name: cp.name, creator_name: byId(cp.creator_id)?.name ?? null,
        members_count: members.filter((x) => x.carpool_id === cp.id && x.status === "joined").length,
        seats: cp.seats, seats_used: childCount(cp.id), full: childCount(cp.id) >= cp.seats,
        distance_km: roundN(nd.dkm, 2), lat: jit(nd.p.home_lat), lng: jit(nd.p.home_lng), my_status: mine?.status ?? null });
    });
    nearby.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
    return wait({ school: sch, me: { home_lat: m.home_lat, home_lng: m.home_lng }, parents, carpools: nearby });
  },

  // ---- carpools ----
  myCarpools: async () => {
    const m = me(); const a = anchorOf(m); const ids = new Set<string>();
    carpools.filter((c) => c.creator_id === a).forEach((c) => ids.add(c.id));
    members.filter((x) => x.parent_id === a).forEach((x) => ids.add(x.carpool_id));
    return wait([...ids].map(carpoolById).filter((c): c is CarpoolRow => !!c).map((c) => carpoolOut(c)));
  },
  getCarpool: async (carpoolId) => {
    const m = me(); const cp = carpoolById(carpoolId); if (!cp) throw new Error("Carpool not found");
    const a = anchorOf(m);
    const allowed = m.role === "admin" || cp.creator_id === m.id
      || members.some((x) => x.carpool_id === carpoolId && x.parent_id === a && (x.status === "joined" || x.status === "invited" || x.status === "requested"));
    if (!allowed) throw new Error("You are not part of this carpool");
    return wait({ ...carpoolOut(cp), stats: carpoolStatsFor(carpoolId) });
  },
  createCarpool: async (data) => {
    const m = me(); requireApproved();
    if (m.role !== "parent") throw new Error("Only a parent can create a carpool.");
    if (m.can_drive === false) throw new Error("Only a parent with a car can create a carpool — you can join one instead from the Find tab.");
    if (!data.name || !data.name.trim()) throw new Error("Give the carpool a name.");
    const cp: CarpoolRow = { id: uid(), name: data.name.trim(), creator_id: m.id, driver_name: null, driver_phone: null, driver_vehicle: null,
      seats: data.seats ? Number(data.seats) : 4, created_at: nowISO() };
    carpools.push(cp);
    members.push({ carpool_id: cp.id, parent_id: m.id, role: "creator", status: "joined" });
    (data.invite_ids ?? []).forEach((id) => {
      const u = byId(id);
      if (u && u.role === "parent" && u.status === "approved" && u.id !== m.id && !members.some((x) => x.carpool_id === cp.id && x.parent_id === u.id)) {
        members.push({ carpool_id: cp.id, parent_id: u.id, role: "member", status: "invited" });
        notify(u.id, "Carpool invitation", `${m.name} invited you to "${cp.name}".`, "invite");
      }
    });
    return wait(carpoolOut(cp));
  },
  respondInvite: async (carpoolId, accept) => {
    const m = me(); const cp = carpoolById(carpoolId); if (!cp) throw new Error("Carpool not found");
    if (accept) requireApproved();
    if (accept && childCount(carpoolId) + m.children.length > cp.seats) throw new Error("This carpool is full — no seats left.");
    const mem = members.find((x) => x.carpool_id === carpoolId && x.parent_id === m.id);
    if (mem) mem.status = accept ? "joined" : "rejected";
    notify(cp.creator_id, accept ? "Invitation accepted" : "Invitation declined", `${m.name} ${accept ? "joined" : "declined"} "${cp.name}".`, "info");
    return wait(carpoolOut(cp));
  },
  requestJoinCarpool: async (carpoolId) => {
    const m = me(); const cp = carpoolById(carpoolId); if (!cp) throw new Error("Carpool not found");
    requireApproved();
    const mem = members.find((x) => x.carpool_id === carpoolId && x.parent_id === m.id);
    if (mem) { mem.status = "requested"; mem.role = "member"; }
    else members.push({ carpool_id: carpoolId, parent_id: m.id, role: "member", status: "requested" });
    notify(cp.creator_id, "Seat request 🙋", `${m.name} asked to join "${cp.name}".`, "invite");
    return wait(OK);
  },
  respondJoinRequest: async (carpoolId, parentId, accept) => {
    me(); const cp = carpoolById(carpoolId); if (!cp) throw new Error("Carpool not found");
    if (accept && childCount(carpoolId) + (byId(parentId)?.children.length ?? 0) > cp.seats) throw new Error("This carpool is full — no seats left.");
    const mem = members.find((x) => x.carpool_id === carpoolId && x.parent_id === parentId && x.status === "requested");
    if (mem) mem.status = accept ? "joined" : "rejected";
    notify(parentId, accept ? "Request approved ✅" : "Request not approved",
      accept ? `You've joined "${cp.name}".` : `Your request to join "${cp.name}" wasn't approved.`, accept ? "approved" : "info");
    return wait(carpoolOut(cp));
  },
  setDriver: async (carpoolId, name, phone, vehicle) => {
    me(); const cp = carpoolById(carpoolId); if (!cp) throw new Error("Carpool not found");
    cp.driver_name = name || null; cp.driver_phone = phone || null;
    if (vehicle != null) cp.driver_vehicle = vehicle;
    audience(carpoolId).forEach((u) => notify(u, "Driver updated", `Driver for "${cp.name}" is now ${name || "unassigned"}.`, "info"));
    return wait(carpoolOut(cp));
  },
  leaveCarpool: async (carpoolId) => {
    const m = me(); const cp = carpoolById(carpoolId);
    if (activeRideOf(carpoolId)) throw new Error("End the live trip before leaving this carpool.");
    const mem = members.find((x) => x.carpool_id === carpoolId && x.parent_id === m.id); if (mem) mem.status = "left";
    if (cp && cp.creator_id === m.id) {
      // ONE carpool = ONE driving family: hand over only to a family that has a car.
      const next = members.find((x) => x.carpool_id === carpoolId && x.status === "joined" && x.parent_id !== m.id && byId(x.parent_id)?.can_drive !== false);
      if (next) {
        cp.creator_id = next.parent_id; next.role = "creator"; if (mem) mem.role = "member";
        cp.driver_name = null; cp.driver_phone = null; cp.driver_vehicle = null;
        notify(next.parent_id, `You now organise "${cp.name}"`, `${m.name} left — your household drives its trips from now on.`, "info");
        audience(carpoolId).filter((u) => u !== next.parent_id && u !== m.id).forEach((u) => notify(u, "New organiser", `${m.name} left "${cp.name}"; ${byId(next.parent_id)?.name} now organises it.`, "info"));
      } else {
        audience(carpoolId).filter((u) => u !== m.id).forEach((u) => notify(u, "Carpool closed", `"${cp.name}" closed — the organiser left and no other family has a car to drive it.`, "info"));
        deleteCarpoolRows(carpoolId);
      }
    } else if (cp) {
      audience(carpoolId).filter((u) => u !== m.id).forEach((u) => notify(u, "A family left", `${m.name} left "${cp.name}".`, "info"));
    }
    return wait(OK);
  },
  deleteCarpool: async (carpoolId) => {
    const m = me(); const cp = carpoolById(carpoolId); if (!cp) return wait(OK);
    if (cp.creator_id !== m.id && m.role !== "admin") throw new Error("Only the organiser or the school admin can delete a carpool.");
    if (activeRideOf(carpoolId)) throw new Error("End the live trip before deleting this carpool.");
    audience(carpoolId).filter((u) => u !== m.id).forEach((u) => notify(u, "Carpool deleted", `"${cp.name}" was deleted by ${m.name}.`, "info"));
    deleteCarpoolRows(carpoolId);
    return wait(OK);
  },
  tripDrivers: async (carpoolId) => wait(tripDriverList(carpoolId)),
  setAbsence: async (carpoolId, childId, absent) => {
    const m = me(); const cp = carpoolById(carpoolId); if (!cp) throw new Error("Carpool not found");
    const f = findChild(childId);
    if (!f || f.parent.id !== anchorOf(m)) throw new Error("You can only mark your own child absent.");
    const key = `${carpoolId}:${childId}:${today()}`;
    const r = activeRideOf(carpoolId);
    if (absent) {
      absences.add(key);
      if (r) stopsOf(r.id).filter((s) => s.child_id === childId && REMAINING.includes(s.status)).forEach((s) => { s.status = "skipped"; });
    } else {
      absences.delete(key);
      if (r) stopsOf(r.id).filter((s) => s.child_id === childId && s.status === "skipped").forEach((s) => { s.status = "pending"; });
    }
    if (r) emitStops(r.id);
    return wait(carpoolOut(cp));
  },
  carpoolStats: async (carpoolId) => {
    const m = me(); const cp = carpoolById(carpoolId); if (!cp) throw new Error("Carpool not found");
    if (!(m.role === "admin" || cp.creator_id === m.id || joinedCarpoolIds(anchorOf(m)).includes(carpoolId))) throw new Error("You are not part of this carpool");
    return wait(carpoolStatsFor(carpoolId));
  },

  // ---- trips ----
  startRide: async (carpoolId, driverUserId, order, direction, originLat, originLng) =>
    wait(rideOut(startRideInternal(carpoolId, driverUserId, order, direction, originLat, originLng))),
  activeRides: async () => {
    sweepStale();
    const ids = joinedCarpoolIds(anchor());
    return wait(rides.filter((r) => r.status === "active" && ids.includes(r.carpool_id)).map(rideOut));
  },
  getRide: async (rideId) => { sweepStale(); const r = rideById(rideId); if (!r) throw new Error("Trip not found"); return wait(rideOut(r)); },
  postLocation: async (rideId, lat, lng, speedKmh, heading) => wait(postLocationInternal(rideId, lat, lng, speedKmh ?? null, heading ?? null)),
  rideEvent: async (rideId, type, note, childId) => {
    const r = rideById(rideId);
    if (!r || r.status !== "active") throw new Error("This trip has already ended.");
    if (!canActOnRide(r)) throw new Error("Only people on this carpool can report trip events");
    if (type === "sos") throw new Error("SOS has been removed — call the driver or the school office directly.");
    addEvent(rideId, type, note || null, childId ?? null);
    return wait(OK);
  },
  // Manual board (driver/parent tap): the child's pickup stop is done.
  rideBoard: async (rideId, childId) => {
    const r = rideById(rideId);
    if (!r || r.status !== "active") throw new Error("This trip has already ended.");
    if (!canActOnRide(r)) throw new Error("Only the trip driver or a carpool member can board children");
    const tsMs = nowMs(), ts = iso(tsMs);
    evBoard(r, childId, false);
    stopsOf(rideId).filter((s) => s.child_id === childId && s.kind === "pickup" && s.status !== "done").forEach((s) => {
      s.status = "done"; s.done_at = ts; s.stopped_at = s.stopped_at ?? ts; s.arrived_at = s.arrived_at ?? ts; s.delay_min = delayMin(s, tsMs);
    });
    emitStops(rideId);
    return wait(OK);
  },
  // Parent correction ("Didn't board?"): revert the check-in, alert the carpool, RE-ARM the stop.
  rideUnboard: async (rideId, childId) => {
    const r = rideById(rideId);
    if (!r || r.status !== "active") throw new Error("This trip has already ended.");
    if (!canActOnRide(r)) throw new Error("Only people on this carpool can correct a check-in");
    const name = findChild(childId)?.child.name ?? "Child";
    addEvent(rideId, "unboarded", `${name} — NOT on board (corrected by parent)`, childId);
    stopsOf(rideId).filter((s) => s.child_id === childId && (s.kind === "pickup" || s.kind === "drop")).forEach((s) => {
      s.status = "pending"; s.arrived_at = null; s.stopped_at = null; s.done_at = null; s.dwell_s = null; s.delay_min = null;
    });
    audience(r.carpool_id).forEach((u) => notify(u, "Correction ⚠️", `${name} is NOT on board — their parent corrected the check-in. Driver, please check.`, "trip"));
    emitStops(rideId);
    return wait(OK);
  },
  rideDrop: async (rideId, childId, place = "school") => {
    const r = rideById(rideId);
    if (!r || r.status !== "active") throw new Error("This trip has already ended.");
    if (!canActOnRide(r)) throw new Error("Only the trip driver or a carpool member can record a drop");
    const tsMs = nowMs(), ts = iso(tsMs);
    evDrop(r, childId, place, false);
    if (place === "home") stopsOf(rideId).filter((s) => s.child_id === childId && s.kind === "drop" && s.status !== "done").forEach((s) => {
      s.status = "done"; s.done_at = ts; s.stopped_at = s.stopped_at ?? ts; s.arrived_at = s.arrived_at ?? ts; s.delay_min = delayMin(s, tsMs);
    });
    emitStops(rideId);
    return wait(OK);
  },
  endRide: async (rideId) => {
    const m = me(); const r = rideById(rideId); if (!r) return wait(OK);
    if (!(m.role === "admin" || r.driver_user_id === m.id || joinedCarpoolIds(anchorOf(m)).includes(r.carpool_id)))
      throw new Error("Only the trip driver, a member, or the school admin can end the ride");
    endRideInternal(r, "Trip completed");
    return wait(OK);
  },
  tripHistory: async () => {
    me(); sweepStale();
    return wait(rides.filter((r) => r.status !== "active" && canSeeRide(r))
      .sort((a, b) => ms(b.started_at) - ms(a.started_at)).slice(0, 30).map(tripSummary));
  },
  tripReplay: async (rideId): Promise<TripReplay> => {
    me(); const r = rideById(rideId); if (!r) throw new Error("Trip not found");
    if (!canSeeRide(r)) throw new Error("You are not part of this trip");
    return wait({ ride: rideOut(r), stops: stopsOut(rideId),
      pings: pingsOf(rideId).map((p) => ({ lat: p.lat, lng: p.lng, speed_kmh: p.speed_kmh, heading: p.heading, eta_min: p.eta_min, distance_km: p.distance_km, created_at: p.created_at })),
      events: eventsOf(rideId).map(eventOut) });
  },

  // ---- chat / notifications / push ----
  getChat: async (carpoolId) => { requireChatMember(carpoolId, "read its chat"); return wait(chats.filter((c) => c.carpool_id === carpoolId).map((c) => ({ ...c }))); },
  sendChat: async (carpoolId, body) => {
    const m = me(); requireChatMember(carpoolId, "post in its chat");
    if (!body || !body.trim()) throw new Error("Message is empty.");
    body = body.slice(0, 1000);
    const msg: ChatMessage = { id: uid(), carpool_id: carpoolId, sender_id: m.id, sender_name: m.name, body, created_at: nowISO() };
    chats.push(msg); emit("chat:" + carpoolId, msg);
    audience(carpoolId).filter((u) => u !== m.id).forEach((u) => notify(u, "New message", `${m.name}: ${body.slice(0, 40)}`, "chat"));
    return wait({ ...msg });
  },
  notifications: async () => {
    const m = me();
    return wait(notifs.filter((n) => n.user_id === m.id).slice().reverse().map(({ id, title, body, kind, read, created_at }) => ({ id, title, body, kind, read, created_at })));
  },
  markNotificationsRead: async () => { const m = me(); notifs.filter((n) => n.user_id === m.id).forEach((n) => { n.read = true; }); return wait(OK); },
  pushPublicKey: async () => wait(null),
  savePushSubscription: async (sub: PushSubscriptionJSON, ua) => {
    const m = me();
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Invalid push subscription");
    pushSubs.set(sub.endpoint, { endpoint: sub.endpoint, user_id: m.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, ua: ua ? ua.slice(0, 300) : null, created_at: nowISO() });
    return wait(OK);
  },
  removePushSubscription: async (endpoint) => {
    const m = me(); const row = pushSubs.get(endpoint);
    if (row && row.user_id === m.id) pushSubs.delete(endpoint);
    return wait(OK);
  },

  // ---- school settings / admin ----
  getSchool: async () => wait(school()),
  setSchool: async (s) => { requireAdmin(); settings.school_name = s.name; settings.school_lat = s.lat; settings.school_lng = s.lng; return wait(school()); },
  getSettings: async () => { me(); return wait({ ...settings }); },
  setSettings: async (patch) => {
    requireAdmin();
    const st = settings;
    const n_near = patchInt(patch, "fence_near_m", st.fence_near_m, 50, 5000);
    const n_stop = patchInt(patch, "fence_stop_m", st.fence_stop_m, 20, 2000);
    const n_leave = patchInt(patch, "fence_leave_m", st.fence_leave_m, 30, 3000);
    const n_miss = patchInt(patch, "fence_miss_m", st.fence_miss_m, 50, 5000);
    if (!(n_stop < n_leave && n_leave <= n_miss)) throw new Error("Fences must satisfy stop < leave ≤ miss");
    const next: Settings = {
      school_name: patch.school_name && patch.school_name.trim() ? patch.school_name.trim() : st.school_name,
      school_lat: patch.school_lat != null ? patchNum(patch, "school_lat", st.school_lat, -90, 90) : st.school_lat,
      school_lng: patch.school_lng != null ? patchNum(patch, "school_lng", st.school_lng, -180, 180) : st.school_lng,
      fence_near_m: n_near, fence_stop_m: n_stop, fence_leave_m: n_leave, fence_miss_m: n_miss,
      dwell_s: patchInt(patch, "dwell_s", st.dwell_s, 1, 600),
      stationary_m: patchInt(patch, "stationary_m", st.stationary_m, 5, 500),
      school_gate_m: patchInt(patch, "school_gate_m", st.school_gate_m, 50, 2000),
      offroute_km: patchNum(patch, "offroute_km", st.offroute_km, 0.2, 50),
      long_stop_s: patchInt(patch, "long_stop_s", st.long_stop_s, 30, 7200),
      speed_max_kmh: patchInt(patch, "speed_max_kmh", st.speed_max_kmh, 20, 200),
      school_start_time: patchTime(patch, "school_start_time", st.school_start_time),
      school_end_time: patchTime(patch, "school_end_time", st.school_end_time),
      city_speed_kmh: patchInt(patch, "city_speed_kmh", st.city_speed_kmh, 5, 120),
      road_factor: patchNum(patch, "road_factor", st.road_factor, 1, 3),
    };
    Object.assign(settings, next);
    return wait({ ...settings });
  },
  adminRegistrations: async (status) => { requireAdmin(); return wait(users.filter((u) => u.role === "parent" && u.status === status).map(profileOut)); },
  adminDecision: async (userId, decision, reason) => {
    requireAdmin(); const u = byId(userId);
    if (u) {
      u.status = decision;
      notify(userId, decision === "approved" ? "Registration approved ✅" : "Registration not approved",
        decision === "approved" ? "You can now find families and create carpools." : (reason || "Please contact the school office."),
        decision === "approved" ? "approved" : "info");
    }
    return wait(OK);
  },
  adminStats: async (): Promise<AdminStats> => {
    requireAdmin();
    return wait({
      pending: users.filter((u) => u.role === "parent" && u.status === "pending").length,
      approved: users.filter((u) => u.role === "parent" && u.status === "approved").length,
      rejected: users.filter((u) => u.role === "parent" && u.status === "rejected").length,
      carpools: carpools.length, live: rides.filter((r) => r.status === "active").length,
      addons: users.filter((u) => u.role === "addon").length, academic_year: 2026, school: school(),
    });
  },
  adminCarpools: async () => { requireAdmin(); return wait(carpools.map((c) => carpoolOut(c))); },
  adminAnalytics: async (): Promise<AdminAnalytics> => {
    requireAdmin();
    const approved = users.filter((u) => u.role === "parent" && u.status === "approved");
    const joined = new Set(members.filter((m) => m.status === "joined").map((m) => m.parent_id));
    const matched = approved.filter((p) => joined.has(p.id)).length;
    return wait({
      ...carpoolStatsFor(null),
      approved: approved.length, matched, unmatched: approved.length - matched,
      completed_trips: rides.filter((r) => r.status === "completed").length,
      per_carpool: [...carpools].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name, stats: carpoolStatsFor(c.id) })),
    });
  },
  adminIncidents: async (): Promise<Incident[]> => {
    requireAdmin();
    const kinds = new Set(["route_alert", "missed_pickup", "anomaly_long_stop", "anomaly_speed"]);
    const rows = events.filter((e) => kinds.has(e.type)).slice().reverse().slice(0, 300).map((e) => {
      const r = rideById(e.ride_id);
      const row: Incident & { child_name: string | null } = { id: e.id, ride_id: e.ride_id, carpool: carpoolById(r?.carpool_id ?? "")?.name ?? "—",
        type: e.type, note: e.note ?? e.type, child_name: findChild(e.child_id)?.child.name ?? null, created_at: e.created_at };
      return row;
    });
    return wait(rows);
  },
  adminAttendance: async (): Promise<AttendanceRow[]> => {
    requireAdmin();
    return wait(events.filter((e) => e.type === "reached_school" || e.type === "reached_home").slice().reverse().map((e) => {
      const f = findChild(e.child_id); const r = rideById(e.ride_id);
      return { child_name: f?.child.name ?? "—", parent_name: f?.parent.name ?? "—", carpool: carpoolById(r?.carpool_id ?? "")?.name ?? "—", reached_at: e.created_at };
    }));
  },
  adminBroadcast: async (title, body) => {
    requireAdmin();
    broadcasts.unshift({ id: uid(), title, body, created_at: nowISO() });
    users.filter((u) => u.role === "parent").forEach((u) => notify(u.id, "📢 " + title, body, "system"));
    return wait(OK);
  },
  getBroadcasts: async () => wait(broadcasts.map((b) => ({ ...b }))),
  publishTnc: async (body) => {
    requireAdmin();
    const v = latestTncVersion() + 1; tnc.push({ version: v, body, published_at: nowISO() });
    users.filter((u) => u.role === "parent").forEach((u) => notify(u.id, "Terms updated", `New Terms & Conditions (v${v}). Please review and accept.`, "system"));
    return wait({ version: v });
  },
  adminTncList: async () => { requireAdmin(); return wait([...tnc].sort((a, b) => b.version - a.version).map((t) => ({ ...t }))); },
  promoteYear: async () => {
    requireAdmin();
    users.forEach((u) => u.children.forEach((c) => { c.class_level = c.class_level >= 12 ? 13 : c.class_level + 1; }));
    return wait({ academic_year: 2027 });
  },

  // ---- realtime (in-memory topic bus) ----
  onRideLocation: (rideId, cb): Unsub => on("loc:" + rideId, cb),
  onRideEvents: (rideId, cb): Unsub => on("rideev:" + rideId, cb),
  onRideStops: (rideId, cb): Unsub => on("stops:" + rideId, cb),
  onRideEnded: (rideId, cb): Unsub => on("ended:" + rideId, () => cb()),
  onNotifications: (cb): Unsub => on("notif:" + (currentId ?? ""), cb),
  onChat: (carpoolId, cb): Unsub => on("chat:" + carpoolId, cb),
};

function recomputeDriver(u: UserRow) {
  if (u.role !== "addon" || u.relation !== "driver") return;
  const t = today();
  const has = (ty: string) => u.documents.some((d) => d.type === ty && (!d.expiry || d.expiry >= t));
  u.driver_status = has("licence") && has("insurance") ? "verified" : "incomplete";
}
function deleteCarpoolRows(carpoolId: string) {
  for (let i = members.length - 1; i >= 0; i--) if (members[i].carpool_id === carpoolId) members.splice(i, 1);
  const rideIds = new Set(rides.filter((r) => r.carpool_id === carpoolId).map((r) => r.id));
  for (let i = rides.length - 1; i >= 0; i--) if (rideIds.has(rides[i].id)) rides.splice(i, 1);
  for (let i = stops.length - 1; i >= 0; i--) if (rideIds.has(stops[i].ride_id)) stops.splice(i, 1);
  for (let i = pings.length - 1; i >= 0; i--) if (rideIds.has(pings[i].ride_id)) pings.splice(i, 1);
  for (let i = events.length - 1; i >= 0; i--) if (rideIds.has(events[i].ride_id)) events.splice(i, 1);
  for (let i = chats.length - 1; i >= 0; i--) if (chats[i].carpool_id === carpoolId) chats.splice(i, 1);
  const ix = carpools.findIndex((c) => c.id === carpoolId); if (ix >= 0) carpools.splice(ix, 1);
}
