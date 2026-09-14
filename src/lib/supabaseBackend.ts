// Live backend backed by Supabase (Postgres + Auth + Realtime).
// Implements the ONE data contract (`Backend` in ./backend.ts) exactly, so the
// UI is backend-agnostic. Writes go through SECURITY DEFINER RPC functions
// (supabase/schema.sql, all prefixed app_); reads use RLS-protected selects.
//
// Realtime (SPEC §8): a broadcast channel `ride:<id>` is the PRIMARY transport
// (events `loc`, `event`, `stops`, `ended` — the driver's client pushes what the
// RPC returned, sub-second, no DB round-trip for watchers). postgres_changes on
// ride_pings / ride_events / ride_stops / rides / notifications / chat_messages is
// the BACKUP path, de-duplicated so a fix arriving on both paths fires once.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { Backend, Unsub } from "./backend";
import type {
  Profile, SignInResult, RegisterData, Child, Vehicle, Discovery, Filters, Carpool, TripDriver, Ride,
  LocationResult, Stop, RideEvent, TripSummary, TripReplay, CarpoolStats, ChatMessage, Notification,
  School, Settings, Broadcast, AttendanceRow, Incident, AdminStats, AdminAnalytics, PushSubscriptionJSON,
  Direction,
} from "./types";

const sb = () => {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
};
// Internal RPC helper — loosely typed on purpose; every public method narrows it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = async <T = any>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await sb().rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
};
const OK = { ok: true } as const;

// ---- profile → SignInResult -------------------------------------------------
async function resolveSignIn(email: string): Promise<SignInResult> {
  try { await rpc("_link_addon"); } catch { /* not an add-on — fine */ }
  const profile = await rpc<Profile | null>("app_get_profile");
  if (!profile) return { status: "new", email };
  if (profile.status === "pending" || profile.status === "rejected") return { status: profile.status, profile };
  return { status: "in", profile };
}

// ---- ride broadcast bus ------------------------------------------------------
// ONE broadcast channel per ride per client, shared by the sender (driver
// posting fixes) and receivers (watchers). ALL handlers are attached at creation
// time (supabase-js forbids adding bindings after subscribe); callbacks register
// into plain sets, so subscribing/unsubscribing screens never touches the
// channel itself. broadcast.self=true so the driver's own screen also glides
// from its own pushes.
type LocPayload = { lat: number; lng: number; heading?: number | null; eta_min?: number | null; distance_km?: number | null };
type Handler<T> = (p: T) => void;
interface RideBus {
  ch: RealtimeChannel; joined: boolean;
  loc: Set<Handler<LocPayload>>; ev: Set<Handler<RideEvent>>; stops: Set<Handler<Stop[]>>; end: Set<Handler<void>>;
}
const buses: Record<string, RideBus> = {};
type BroadcastMsg = { payload?: unknown };
function fanout<T>(set: Set<Handler<T>>, p: T) { set.forEach((f) => { try { f(p); } catch { /* listener error must not break the bus */ } }); }
function rideBus(rideId: string): RideBus {
  let b = buses[rideId];
  if (!b) {
    const ch = sb().channel("ride:" + rideId, { config: { broadcast: { self: true } } });
    const bus: RideBus = { ch, joined: false, loc: new Set(), ev: new Set(), stops: new Set(), end: new Set() };
    b = buses[rideId] = bus;
    ch.on("broadcast", { event: "loc" }, (m: BroadcastMsg) => { if (m.payload) fanout(bus.loc, m.payload as LocPayload); });
    ch.on("broadcast", { event: "event" }, (m: BroadcastMsg) => { if (m.payload) fanout(bus.ev, m.payload as RideEvent); });
    ch.on("broadcast", { event: "stops" }, (m: BroadcastMsg) => { if (Array.isArray(m.payload)) fanout(bus.stops, m.payload as Stop[]); });
    ch.on("broadcast", { event: "ended" }, () => fanout(bus.end, undefined));
  }
  return b;
}
function busJoin(b: RideBus) { if (!b.joined) { b.joined = true; try { b.ch.subscribe(); } catch { /* ignore */ } } }
function bcast(rideId: string, event: "loc" | "event" | "stops" | "ended", payload: unknown) {
  try { const b = rideBus(rideId); busJoin(b); void b.ch.send({ type: "broadcast", event, payload }); }
  catch { /* best-effort — the DB write already succeeded */ }
}
function busMaybeDrop(rideId: string) {
  const b = buses[rideId];
  if (b && b.loc.size === 0 && b.ev.size === 0 && b.stops.size === 0 && b.end.size === 0) {
    try { void sb().removeChannel(b.ch); } catch { /* ignore */ }
    delete buses[rideId];
  }
}
function localEvent(rideId: string, type: string, childId?: string | null, note?: string | null): RideEvent {
  return { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ride_id: rideId, type, note: note ?? null, child_id: childId ?? null, created_at: new Date().toISOString() } as RideEvent;
}
// After a manual board/unboard/drop the stop rail changed server-side: refetch
// and broadcast it so every watcher's rail updates without waiting for pg changes.
async function pushStops(rideId: string) {
  try { const stops = await rpc<Stop[]>("app_ride_stops", { ride_id: rideId }); bcast(rideId, "stops", stops); } catch { /* backup path covers it */ }
}
function pgChannel(name: string, table: string, filter: string, event: "INSERT" | "UPDATE" | "*", cb: (row: Record<string, unknown>) => void): RealtimeChannel {
  return sb().channel(name)
    .on("postgres_changes", { event, schema: "public", table, filter }, (p: { new: Record<string, unknown> }) => cb(p.new))
    .subscribe();
}
function drop(ch: RealtimeChannel | null | undefined) { if (ch) { try { void sb().removeChannel(ch); } catch { /* ignore */ } } }
const names = new Map<string, Promise<string>>();
function senderName(userId: string): Promise<string> {
  const cached = names.get(userId);
  if (cached) return cached;
  const p: Promise<string> = Promise.resolve(sb().from("profiles").select("name").eq("id", userId).maybeSingle())
    .then(({ data }) => (data?.name as string | undefined) ?? "", () => "");
  names.set(userId, p);
  return p;
}

export const supabaseBackend: Backend = {
  // ---- pre-login ----
  publicConfig: async () => {
    try { const r = await rpc<{ demo_logins?: boolean; school_name?: string }>("app_public_config"); return { demo_logins: !!r?.demo_logins, school_name: r?.school_name ?? null }; }
    catch { return { demo_logins: false, school_name: null }; }
  },

  // ---- auth / profile ----
  signIn: async (email, password) => {
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return resolveSignIn(email);
  },
  signUp: async (email, password) => {
    const { data, error } = await sb().auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error("Check your inbox to confirm your email, then sign in.");
    return resolveSignIn(email);
  },
  signOut: async () => { await sb().auth.signOut(); },
  getProfile: async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) return null;
    try { await rpc("_link_addon"); } catch { /* ignore */ }
    return rpc<Profile | null>("app_get_profile");
  },
  register: async (_email: string, data: RegisterData) => rpc<Profile>("app_register", { data }),
  pendingInvite: async () => rpc<{ name: string; relation: string; parent_name: string } | null>("app_pending_invite"),
  updateProfile: async (patch: Partial<Profile>) => rpc<Profile>("app_update_profile", { patch }),
  addChild: async (c) => rpc<Profile>("app_add_child", { c }),
  updateChild: async (childId: string, patch: Partial<Child>) => rpc<Profile>("app_update_child", { child_id: childId, patch }),
  removeChild: async (childId: string) => rpc<Profile>("app_remove_child", { child_id: childId }),
  addAddon: async (a) => rpc<Profile>("app_add_addon", { a }),
  removeAddon: async (addonId: string) => rpc<Profile>("app_remove_addon", { addon_id: addonId }),
  confirmDriver: async (addonId: string, confirmed: boolean, plate?: string) =>
    rpc<Profile>("app_confirm_driver", { addon_id: addonId, confirmed, plate: plate ?? null }),
  acceptTnc: async () => rpc<Profile>("app_accept_tnc"),
  latestTnc: async () => rpc<{ version: number; body: string } | null>("app_latest_tnc"),
  addTrusted: async (t) => rpc<Profile>("app_add_trusted", { t }),
  removeTrusted: async (id: string) => rpc<Profile>("app_remove_trusted", { trusted_id: id }),

  // ---- driver (family add-on with relation 'driver') ----
  getDriverProfile: async () => rpc<Profile>("app_get_driver_profile"),
  updateDriverProfile: async (patch: { vehicle?: Vehicle; photo_url?: string }) => rpc<Profile>("app_update_driver_profile", { patch }),
  addDriverDoc: async (doc) => rpc<Profile>("app_add_driver_doc", { doc }),
  removeDriverDoc: async (docId: string) => rpc<Profile>("app_remove_driver_doc", { doc_id: docId }),
  myDriverCarpools: async () => rpc<Carpool[]>("app_my_driver_carpools"),

  // ---- discovery ----
  searchParents: async (filters: Filters) => rpc<Discovery>("app_search_parents", { filters }),

  // ---- carpools ----
  myCarpools: async () => rpc<Carpool[]>("app_my_carpools"),
  getCarpool: async (carpoolId: string) => rpc<Carpool>("app_get_carpool", { carpool_id: carpoolId }),
  createCarpool: async (data) => rpc<Carpool>("app_create_carpool", { data }),
  respondInvite: async (carpoolId: string, accept: boolean) => rpc<Carpool>("app_respond_invite", { carpool_id: carpoolId, accept }),
  requestJoinCarpool: async (carpoolId: string) => { await rpc("app_request_join", { carpool_id: carpoolId }); return OK; },
  respondJoinRequest: async (carpoolId: string, parentId: string, accept: boolean) =>
    rpc<Carpool>("app_respond_join", { carpool_id: carpoolId, parent_id: parentId, accept }),
  setDriver: async (carpoolId: string, name: string, phone: string, vehicle?: string) =>
    rpc<Carpool>("app_set_driver", { carpool_id: carpoolId, driver_name: name, driver_phone: phone, driver_vehicle: vehicle ?? null }),
  leaveCarpool: async (carpoolId: string) => { await rpc("app_leave_carpool", { carpool_id: carpoolId }); return OK; },
  deleteCarpool: async (carpoolId: string) => { await rpc("app_delete_carpool", { carpool_id: carpoolId }); return OK; },
  tripDrivers: async (carpoolId: string) => rpc<TripDriver[]>("app_trip_drivers", { carpool_id: carpoolId }),
  setAbsence: async (carpoolId: string, childId: string, absent: boolean) =>
    rpc<Carpool>("app_set_absence", { carpool_id: carpoolId, child_id: childId, absent }),
  carpoolStats: async (carpoolId: string) => rpc<CarpoolStats>("app_carpool_stats", { carpool_id: carpoolId }),

  // ---- trips ----
  startRide: async (carpoolId: string, driverUserId?: string | null, order?: string[] | null, direction?: Direction | null,
    originLat?: number | null, originLng?: number | null) =>
    rpc<Ride>("app_start_ride", {
      carpool_id: carpoolId, driver_user_id: driverUserId ?? null,
      order_ids: order && order.length ? order : null, direction: direction ?? null,
      origin_lat: originLat ?? null, origin_lng: originLng ?? null,
    }),
  activeRides: async () => rpc<Ride[]>("app_active_rides"),
  getRide: async (rideId: string) => rpc<Ride>("app_get_ride", { ride_id: rideId }),
  // The RPC runs the stop state machine + ETAs + anomalies and returns the
  // LocationResult; the driver's client fans it out on the broadcast channel.
  postLocation: async (rideId: string, lat: number, lng: number, speedKmh?: number | null, heading?: number | null) => {
    const res = await rpc<LocationResult>("app_post_location", {
      ride_id: rideId, lat, lng, speed_kmh: speedKmh ?? null, heading: heading ?? null,
    });
    bcast(rideId, "loc", { ride_id: rideId, lat: res.lat, lng: res.lng, heading: heading ?? null, eta_min: res.eta_min, distance_km: res.distance_km });
    bcast(rideId, "stops", res.stops);
    if (res.ended) bcast(rideId, "ended", { ride_id: rideId });
    return res;
  },
  rideEvent: async (rideId: string, type: string, note: string, childId?: string | null) => {
    await rpc("app_ride_event", { ride_id: rideId, type, note: note || null, child_id: childId ?? null });
    bcast(rideId, "event", localEvent(rideId, type, childId, note));
    return OK;
  },
  rideBoard: async (rideId: string, childId: string) => {
    await rpc("app_ride_board", { ride_id: rideId, child_id: childId, pin: null });
    bcast(rideId, "event", localEvent(rideId, "boarded", childId));
    void pushStops(rideId);
    return OK;
  },
  rideUnboard: async (rideId: string, childId: string) => {
    await rpc("app_ride_unboard", { ride_id: rideId, child_id: childId });
    bcast(rideId, "event", localEvent(rideId, "unboarded", childId));
    void pushStops(rideId);
    return OK;
  },
  rideDrop: async (rideId: string, childId: string, place: "school" | "home" = "school") => {
    await rpc("app_ride_drop", { ride_id: rideId, child_id: childId, place });
    bcast(rideId, "event", localEvent(rideId, place === "home" ? "reached_home" : "reached_school", childId));
    void pushStops(rideId);
    return OK;
  },
  endRide: async (rideId: string) => {
    await rpc("app_end_ride", { ride_id: rideId });
    bcast(rideId, "ended", { ride_id: rideId });
    return OK;
  },
  tripHistory: async () => rpc<TripSummary[]>("app_trip_history"),
  tripReplay: async (rideId: string) => rpc<TripReplay>("app_trip_replay", { ride_id: rideId }),

  // ---- chat / notifications / push ----
  getChat: async (carpoolId: string) => rpc<ChatMessage[]>("app_get_chat", { carpool_id: carpoolId }),
  sendChat: async (carpoolId: string, body: string) => rpc<ChatMessage>("app_send_chat", { carpool_id: carpoolId, body }),
  notifications: async () => rpc<Notification[]>("app_notifications"),
  markNotificationsRead: async () => { await rpc("app_mark_notifications_read"); return OK; },
  pushPublicKey: async () => (await rpc<string | null>("app_push_public_key")) ?? null,
  savePushSubscription: async (sub: PushSubscriptionJSON, ua?: string) => {
    await rpc("app_save_push_subscription", { sub, ua: ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : null) });
    return OK;
  },
  removePushSubscription: async (endpoint: string) => { await rpc("app_remove_push_subscription", { endpoint }); return OK; },

  // ---- school settings / admin ----
  getSchool: async () => rpc<School>("app_get_school"),
  setSchool: async (s: School) => rpc<School>("app_set_school", { name: s.name, lat: s.lat, lng: s.lng }),
  getSettings: async () => rpc<Settings>("app_get_settings"),
  setSettings: async (patch: Partial<Settings>) => rpc<Settings>("app_set_settings", { patch }),
  adminRegistrations: async (status) => rpc<Profile[]>("app_admin_registrations", { status }),
  adminDecision: async (userId: string, decision, reason?: string) => {
    await rpc("app_admin_decision", { user_id: userId, decision, reason: reason ?? null });
    return OK;
  },
  adminStats: async () => rpc<AdminStats>("app_admin_stats"),
  adminCarpools: async () => rpc<Carpool[]>("app_admin_carpools"),
  adminAnalytics: async () => rpc<AdminAnalytics>("app_admin_analytics"),
  adminIncidents: async () => rpc<Incident[]>("app_admin_incidents"),
  adminAttendance: async () => rpc<AttendanceRow[]>("app_admin_attendance"),
  adminBroadcast: async (title: string, body: string) => { await rpc("app_admin_broadcast", { title, body }); return OK; },
  getBroadcasts: async () => rpc<Broadcast[]>("app_get_broadcasts"),
  publishTnc: async (body: string) => rpc<{ version: number }>("app_publish_tnc", { body }),
  adminTncList: async () => rpc<{ version: number; body: string; published_at: string }[]>("app_admin_tnc_list"),
  promoteYear: async () => rpc<{ academic_year: number }>("app_promote_year"),

  // ---- realtime ----
  onRideLocation: (rideId, cb): Unsub => {
    let lastKey = "";
    const emit = (p: LocPayload) => {
      const k = `${p.lat},${p.lng},${p.distance_km ?? ""}`;
      if (k === lastKey) return; lastKey = k; cb(p);
    };
    const b = rideBus(rideId); b.loc.add(emit); busJoin(b);
    const pg = pgChannel("pg-loc:" + rideId, "ride_pings", `ride_id=eq.${rideId}`, "INSERT", (row) =>
      emit({ lat: Number(row.lat), lng: Number(row.lng), heading: row.heading == null ? null : Number(row.heading),
        eta_min: row.eta_min == null ? null : Number(row.eta_min), distance_km: row.distance_km == null ? null : Number(row.distance_km) }));
    return () => { b.loc.delete(emit); busMaybeDrop(rideId); drop(pg); };
  },
  onRideEvents: (rideId, cb): Unsub => {
    const seen = new Set<string>();
    const emit = (ev: RideEvent) => {
      const k = `${ev.type}:${ev.child_id ?? ""}:${ev.id ?? ev.created_at ?? ""}`;
      if (seen.has(k)) return; seen.add(k); cb(ev);
    };
    const b = rideBus(rideId); b.ev.add(emit); busJoin(b);
    const pg = pgChannel("pg-ev:" + rideId, "ride_events", `ride_id=eq.${rideId}`, "INSERT", (row) => emit(row as unknown as RideEvent));
    return () => { b.ev.delete(emit); busMaybeDrop(rideId); drop(pg); };
  },
  // Watchers always receive the FULL stops array. Broadcast carries it whole; the
  // pg backup sees single-row changes, so it refetches the array (debounced).
  onRideStops: (rideId, cb): Unsub => {
    let lastJson = "";
    const emit = (stops: Stop[]) => {
      const j = JSON.stringify(stops.map((s) => [s.id, s.status, s.eta_min, s.done_at, s.stopped_at]));
      if (j === lastJson) return; lastJson = j; cb(stops);
    };
    const b = rideBus(rideId); b.stops.add(emit); busJoin(b);
    let timer: ReturnType<typeof setTimeout> | null = null; let alive = true;
    const refetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        try { const stops = await rpc<Stop[]>("app_ride_stops", { ride_id: rideId }); if (alive) emit(stops); } catch { /* transient */ }
      }, 300);
    };
    const pg = pgChannel("pg-stops:" + rideId, "ride_stops", `ride_id=eq.${rideId}`, "*", refetch);
    return () => { alive = false; if (timer) clearTimeout(timer); b.stops.delete(emit); busMaybeDrop(rideId); drop(pg); };
  },
  onRideEnded: (rideId, cb): Unsub => {
    let fired = false;
    const emit = () => { if (!fired) { fired = true; cb(); } };
    const b = rideBus(rideId); b.end.add(emit); busJoin(b);
    const pg = pgChannel("pg-ride:" + rideId, "rides", `id=eq.${rideId}`, "UPDATE", (row) => { if (row.status === "completed" || row.status === "cancelled") emit(); });
    return () => { b.end.delete(emit); busMaybeDrop(rideId); drop(pg); };
  },
  onNotifications: (cb): Unsub => {
    let ch: RealtimeChannel | null = null; let alive = true;
    void sb().auth.getUser().then(({ data }) => {
      if (!data.user || !alive) return;
      ch = pgChannel("pg-notif:" + data.user.id, "notifications", `user_id=eq.${data.user.id}`, "INSERT", (row) => cb(row as unknown as Notification));
    });
    return () => { alive = false; drop(ch); };
  },
  // The chat_messages row has no sender_name — resolve it once per sender (profiles are readable).
  onChat: (carpoolId, cb): Unsub => {
    const ch = pgChannel("pg-chat:" + carpoolId, "chat_messages", `carpool_id=eq.${carpoolId}`, "INSERT", (row) => {
      const m = row as unknown as ChatMessage;
      void senderName(m.sender_id).then((name) => cb({ ...m, sender_name: m.sender_name || name }));
    });
    return () => drop(ch);
  },
};
