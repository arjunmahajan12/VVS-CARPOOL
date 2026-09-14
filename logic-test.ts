// Logic test of the demo backend (the app's runtime for preview mode) — v8.
// Every v7 assertion is kept (adapted to the typed `Backend` contract) and the
// v8 stop machine / ETA / anomaly / punctuality / replay / push paths are added.
//   npx tsx logic-test.ts   →   === LOGIC: N passed, 0 failed ===
import { demoBackend as api } from "./src/lib/demo";
import { subscriberCount } from "./src/lib/bus";
import type { Stop, Notification, ChatMessage, RideEvent } from "./src/lib/types";

interface Hooks { __VVS_DWELL_MS?: number; __VVS_NOW?: number; __VVS_LATENCY_MS?: number; }
const G = globalThis as unknown as Hooks;
// Stop-detection normally needs an 8 s dwell — tests run in milliseconds.
G.__VVS_DWELL_MS = 0;
G.__VVS_LATENCY_MS = 0;

let pass = 0, fail = 0;
function ok(c: unknown, m: string) { if (c) { pass++; } else { fail++; console.log("  ✗ " + m); } }
async function throws(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }
const as = (email: string) => api.signIn(email, "demo");
const isoRe = /^\d{4}-\d{2}-\d{2}T/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const t = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

const SCH = { lat: 28.533246002067454, lng: 77.14409813768475 };
const ashaHome = { lat: SCH.lat + 0.012, lng: SCH.lng + 0.010 };
const nehaHome = { lat: SCH.lat - 0.009, lng: SCH.lng + 0.014 };
// Post a genuine STOP at a point p: a stationary ping, then drive away.
async function stopAndGo(rideId: string, p: { lat: number; lng: number }) {
  await api.postLocation(rideId, p.lat, p.lng);
  await api.postLocation(rideId, p.lat, p.lng);              // stationary → stop clock
  return api.postLocation(rideId, p.lat + 0.006, p.lng);     // ~0.67 km away → clears both fences
}
const stopOf = (stops: Stop[], childId: string) => stops.find((s) => s.child_id === childId);
const kindOf = (stops: Stop[], kind: Stop["kind"]) => stops.find((s) => s.kind === kind);

async function run() {
  // --- Parent auth + profile ---
  const asha = await as("asha@demo.in");
  ok(asha.status === "in" && asha.profile.status === "approved", "Asha signs in, approved");
  ok(asha.status === "in" && asha.profile.children.length === 1, "Asha has 1 child");
  ok(asha.status === "in" && asha.profile.addons.length === 2, "Asha has 2 add-ons (driver + grandparent)");

  // --- Discovery + matching (ranked from MY home, radius, carpool pins) ---
  const all = await api.searchParents({});
  ok(all.parents.length === 5, "discovery returns 5 other families, got " + all.parents.length);
  ok(all.parents.every((p) => p.distance_km !== undefined), "home-to-home distance computed (ranking key)");
  const sorted = all.parents.map((p) => p.distance_km ?? 1e9);
  ok(sorted.every((d, i) => i === 0 || d >= sorted[i - 1]), "families ranked by distance from MY home");
  const byClass = await api.searchParents({ class_min: "7", class_max: "7" });
  ok(byClass.parents.length === 1 && byClass.parents[0].name === "Neha Gupta", "class filter → Neha only");
  const byKm = await api.searchParents({ radius_km: "3" });
  ok(byKm.parents.every((p) => (p.distance_km ?? 1e9) <= 3), "3 km radius filter works");
  const byAll = await api.searchParents({ radius_km: "all" });
  ok(byAll.parents.length === 5, "radius 'All' disables the limit");
  ok(all.carpools.every((c) => c.lat === undefined || c.lat === null || typeof c.lat === "number"), "nearby carpools carry a map pin");

  const cp1 = await api.getCarpool("cp1");
  ok(cp1.riders?.length === 2, "cp1 has 2 riders (Riya + Kabir)");
  const riya = cp1.riders!.find((r) => r.child_name === "Riya Mehta")!;
  const kabirId = cp1.riders!.find((r) => r.child_name === "Kabir Gupta")!.child_id;
  ok(cp1.is_org_household === true && cp1.is_creator === true, "organiser sees is_org_household + is_creator");
  ok(!!cp1.stats && typeof cp1.stats.trips === "number" && cp1.stats.trips > 0, "getCarpool includes stats with seeded trips");

  // --- Start a trip: organiser anchors route, NOBODY auto-boarded ---
  const stopEvents: Stop[][] = []; const locs: number[] = []; let endedSignal = 0;
  const ride = await api.startRide("cp1", undefined, null, "to_school", ashaHome.lat, ashaHome.lng);
  const offStops = api.onRideStops(ride.id, (s) => stopEvents.push(s));
  const offLoc = api.onRideLocation(ride.id, (p) => locs.push(p.lat));
  const offEnd = api.onRideEnded(ride.id, () => { endedSignal++; });
  ok(subscriberCount("stops:" + ride.id) === 1 && subscriberCount("loc:" + ride.id) === 1, "bus topics stops:<rideId> / loc:<rideId> subscribed");
  ok(ride.status === "active", "ride started");
  ok(ride.direction === "to_school" && ride.origin_lat != null, "trip stores its own direction + origin");
  ok(ride.order?.[0] === riya.child_id, "organiser's child is the FIRST routed stop");
  ok(ride.order?.length === 2, "route covers all travelling children");
  let c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_name === "Riya Mehta")!.status === "waiting", "nobody is auto-boarded at start");
  ok(typeof ride.started_at === "string" && ride.ended_at === null && ride.last_update != null, "Ride carries started_at / ended_at / last_update");

  // --- v8: persisted stops — kinds, order, planned ETAs ---
  const s0 = ride.stops ?? [];
  ok(s0.map((s) => s.kind).join(",") === "pickup,pickup,school", "school run stops = pickups (organiser first) then the gate, got " + s0.map((s) => s.kind).join(","));
  ok(s0.every((s, i) => s.seq === i + 1), "stops carry 1-based seq");
  ok(s0[0].child_id === riya.child_id && s0[1].child_id === kabirId, "stop order follows the route order");
  ok(s0.every((s) => s.status === "pending"), "all stops start pending");
  ok(s0.every((s) => typeof s.planned_eta_min === "number" && isoRe.test(s.planned_at ?? "")), "planned ETA + planned_at fixed at start");
  ok(s0.every((s, i) => i === 0 || (s.planned_eta_min ?? 0) >= (s0[i - 1].planned_eta_min ?? 0)), "planned ETAs are cumulative along the route");
  ok(s0[0].planned_eta_min === 0, "origin = organiser's home → first stop planned at 0 min");
  ok(s0.every((s) => typeof s.eta_min === "number"), "live ETA seeded for every remaining stop at start");
  ok(s0[0].sub === "Asha Mehta · Vasant Kunj B-6" && s0[0].parent_id === "asha" && s0[0].child_name === "Riya Mehta", "pickup stop carries sub / parent_id / child_name");
  ok(s0[2].sub === "School gate" && s0[2].child_id == null && s0[2].label.includes("Vasant Valley"), "school stop has no child, sub 'School gate'");
  ok(ride.planned_duration_min === s0[2].planned_eta_min, "planned_duration_min = planned ETA of the last stop");
  const rideAgain = await api.getRide(ride.id);
  ok((rideAgain.stops?.length ?? 0) === 3 && rideAgain.stops![0].id === s0[0].id, "getRide returns the stop rail");

  // --- STOP-DETECTION: a genuine pull-over checks a child in ---
  const r1a = await api.postLocation(ride.id, ashaHome.lat, ashaHome.lng);
  const riyaArr = stopOf(r1a.stops, riya.child_id)!;
  ok(riyaArr.status === "arriving" && isoRe.test(riyaArr.arrived_at ?? ""), "inside fence_near_m → 'arriving' with arrived_at");
  ok(r1a.stops.every((s) => s.status !== "arriving" || s.child_id === riya.child_id), "only the near stop is arriving");
  const r1b = await api.postLocation(ride.id, ashaHome.lat, ashaHome.lng);
  const riyaStp = stopOf(r1b.stops, riya.child_id)!;
  ok(riyaStp.status === "stopped" && isoRe.test(riyaStp.stopped_at ?? "") && riyaStp.dwell_s === 0, "stationary inside fence_stop_m → 'stopped' with stopped_at");
  const r1c = await api.postLocation(ride.id, ashaHome.lat + 0.006, ashaHome.lng);
  const riyaDone = stopOf(r1c.stops, riya.child_id)!;
  ok(riyaDone.status === "done" && isoRe.test(riyaDone.done_at ?? ""), "leaving past fence_leave_m after dwell → 'done' with done_at");
  ok(t(riyaDone.arrived_at) <= t(riyaDone.stopped_at) && t(riyaDone.stopped_at) <= t(riyaDone.done_at), "arrived_at ≤ stopped_at ≤ done_at");
  ok(typeof riyaDone.delay_min === "number" && riyaDone.eta_min === null, "done stop has delay_min (done_at − planned_at) and eta_min null");
  c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_id === riya.child_id)!.status === "boarded", "stop-and-go at the home checks the child in");
  ok(c.active_ride?.stops?.some((s) => s.child_id === riya.child_id && s.status === "done"), "carpool.active_ride carries the same stops");
  ok((await api.notifications()).some((n) => n.title === "Boarded safely ✅"), "parent notified 'Boarded safely ✅'");
  ok((await api.notifications()).some((n) => n.title === "Driver arriving 🚗"), "parent notified 'Driver arriving 🚗'");

  // --- v8: live ETA shrinks as the car approaches; result.eta_min = FINAL remaining stop ---
  const far = await api.postLocation(ride.id, SCH.lat + 0.004, SCH.lng + 0.012);
  const near = await api.postLocation(ride.id, SCH.lat - 0.005, SCH.lng + 0.0135);
  ok((stopOf(near.stops, kabirId)!.eta_min ?? 0) < (stopOf(far.stops, kabirId)!.eta_min ?? 0) || (stopOf(far.stops, kabirId)!.eta_min ?? 0) === 0,
    "next-stop ETA shrinks as the car approaches");
  ok(near.eta_min === kindOf(near.stops, "school")!.eta_min, "LocationResult.eta_min is the ETA of the final remaining stop");
  ok((near.eta_min ?? 0) >= (stopOf(near.stops, kabirId)!.eta_min ?? 0), "final ETA ≥ next-stop ETA (sequential)");
  ok(typeof near.distance_km === "number" && near.distance_km < 3, "distance_km = distance to school");
  ok(Array.isArray(near.anomalies) && near.anomalies.length === 0, "on-corridor driving raises no anomalies");

  // --- v8: rolling stop (leave before dwell) does NOT board — back to 'arriving' ---
  G.__VVS_DWELL_MS = 8000;
  await api.postLocation(ride.id, nehaHome.lat, nehaHome.lng);
  const roll1 = await api.postLocation(ride.id, nehaHome.lat, nehaHome.lng);
  ok(stopOf(roll1.stops, kabirId)!.status === "stopped", "car stops at Kabir's home");
  const roll2 = await api.postLocation(ride.id, nehaHome.lat + 0.004, nehaHome.lng);   // ~445 m: past leave, inside miss
  const kRoll = stopOf(roll2.stops, kabirId)!;
  ok(kRoll.status === "arriving" && kRoll.stopped_at === null, "rolling stop (dwell < dwell_s) → back to 'arriving', stop clock reset");
  c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_id === kabirId)!.status === "waiting", "rolling stop never boards");
  G.__VVS_DWELL_MS = 0;
  await stopAndGo(ride.id, nehaHome);
  c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_id === kabirId)!.status === "boarded", "second stop checks the other child in");
  // reach the school gate → everyone dropped → trip ENDS ITSELF
  const gateRes = await api.postLocation(ride.id, SCH.lat, SCH.lng);
  ok(gateRes.ended === true, "LocationResult.ended = true at the gate");
  ok(kindOf(gateRes.stops, "school")!.status === "done", "school stop done on reaching school_gate_m (no stationary needed)");
  ok(gateRes.stops.every((s) => s.eta_min === null), "no live ETAs left after the trip ends");
  ok((await api.activeRides()).length === 0, "trip auto-ended when everyone reached school");
  const endedRide = await api.getRide(ride.id);
  ok(endedRide.status === "completed" && isoRe.test(endedRide.ended_at ?? "") && typeof endedRide.actual_duration_min === "number"
     && typeof endedRide.distance_km === "number" && typeof endedRide.on_time === "boolean", "completed ride has ended_at / actual_duration_min / distance_km / on_time");
  const histA = await api.tripHistory();
  ok(histA.length >= 1 && histA[0].events.some((e) => (e.note || "").includes("auto")), "trip history shows the audit trail");
  ok(histA[0].id === ride.id && histA[0].stops_done === 3 && histA[0].missed_count === 0 && histA[0].stops_total === 3, "TripSummary counts stops done / missed / total");
  ok(stopEvents.length >= 12 && locs.length === 12 && endedSignal === 1, "bus: stops + loc emitted per ping, ended:<rideId> exactly once");
  ok(stopEvents[stopEvents.length - 1].every((s) => s.status === "done"), "last stops broadcast shows the finished rail");
  offStops(); offLoc(); offEnd();
  ok(subscriberCount("stops:" + ride.id) === 0, "unsubscribe drops the bus listener");

  // --- SOS is rejected ---
  const r2 = await api.startRide("cp1", "asha", null, "to_school", ashaHome.lat, ashaHome.lng);
  ok(await throws(() => api.rideEvent(r2.id, "sos", "x")), "SOS events are rejected (feature removed)");
  // drive-past never boards; parent gets a loud missed-pickup alert
  await api.postLocation(r2.id, nehaHome.lat + 0.003, nehaHome.lng); // sweeps close
  const missRes = await api.postLocation(r2.id, nehaHome.lat + 0.008, nehaHome.lng); // and away, no stop
  c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_id === kabirId)!.status === "waiting", "driving past never boards a child");
  ok(stopOf(missRes.stops, kabirId)!.status === "missed" && stopOf(missRes.stops, kabirId)!.eta_min === null, "stop flagged 'missed' past fence_miss_m, eta null");
  ok((await api.notifications()).some((n) => n.title === "Missed a pickup? ⚠️"), "driver got the missed-pickup alert too");
  await as("neha@demo.in");
  ok((await api.notifications()).some((n) => n.title.includes("Missed pickup")), "parent got a loud missed-pickup alert");
  // parent-side correction reverts a wrong check-in
  await as("asha@demo.in"); await api.rideBoard(r2.id, kabirId);
  ok((await api.getRide(r2.id)).stops!.find((s) => s.child_id === kabirId)!.status === "done", "manual board completes the pickup stop");
  await as("neha@demo.in"); await api.rideUnboard(r2.id, kabirId);
  c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_id === kabirId)!.status === "waiting", "parent correction reverts the check-in");
  ok((await api.notifications()).some((n) => n.title === "Correction ⚠️"), "correction alerts the carpool");
  const rearmed = (await api.getRide(r2.id)).stops!.find((s) => s.child_id === kabirId)!;
  ok(rearmed.status === "pending" && rearmed.done_at === null && rearmed.arrived_at === null, "correction RE-ARMS the stop (→ pending, timestamps cleared)");
  await as("asha@demo.in");
  const afterFix = await stopAndGo(r2.id, nehaHome);
  ok(stopOf(afterFix.stops, kabirId)!.status === "done", "a genuine stop after correction boards the child again");
  c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_id === kabirId)!.status === "boarded", "rider status 'boarded' after the re-armed stop");
  await api.endRide(r2.id);
  ok((await api.getRide(r2.id)).status === "completed", "manual endRide completes the trip");

  // --- Home run: stop at the gate boards everyone; ends at organiser home ---
  const back = await api.startRide("cp1", "asha", null, "from_school");
  ok(back.direction === "from_school", "explicit home run stored");
  const hs = back.stops ?? [];
  // organiser's own children are not drop stops on a home run — they ride to home_end
  ok(hs.map((s) => s.kind).join(",") === "school,drop,home_end", "home run stops = gate, drops (others), home_end, got " + hs.map((s) => s.kind).join(","));
  ok(hs[0].planned_eta_min === 0 && hs[2].sub === "Organiser's home" && hs[2].parent_id === "asha" && hs[2].child_id == null, "home_end belongs to the organiser");
  ok(hs[1].child_id === kabirId && hs[1].sub === "Neha Gupta · Vasant Kunj A-1" && (hs[2].planned_eta_min ?? 0) > (hs[1].planned_eta_min ?? 0), "drop stop is Kabir's home; home_end planned after it");
  await api.postLocation(back.id, SCH.lat + 0.006, SCH.lng); // moving near school, not stopped
  c = await api.getCarpool("cp1");
  ok(c.riders!.filter((r) => !r.absent).every((r) => r.status === "waiting"), "no boarding without a genuine stop at the gate");
  const gateStop = await stopAndGo(back.id, SCH);
  ok(kindOf(gateStop.stops, "school")!.status === "done", "gate stop done after a qualifying stop");
  c = await api.getCarpool("cp1");
  ok(c.riders!.filter((r) => !r.absent).every((r) => r.status === "boarded"), "stopping at the gate then leaving boards everyone");
  const dropRes = await stopAndGo(back.id, nehaHome);
  c = await api.getCarpool("cp1");
  ok(c.riders!.find((r) => r.child_id === kabirId)!.status === "dropped", "auto drop-off at the child's home");
  ok(stopOf(dropRes.stops, kabirId)!.status === "done" && stopOf(dropRes.stops, kabirId)!.kind === "drop", "drop stop done");
  const homeRes = await api.postLocation(back.id, ashaHome.lat, ashaHome.lng); // organiser home → own kid dropped + end
  ok((await api.activeRides()).length === 0, "return trip auto-ended at the organiser's home");
  const he = kindOf(homeRes.stops, "home_end")!;
  ok(homeRes.ended && he.status === "done" && isoRe.test(he.done_at ?? "") && typeof he.delay_min === "number", "home_end done with done_at/delay_min → auto-end");
  ok((await api.getRide(back.id)).events!.some((e) => e.type === "reached_home" && e.child_id === riya.child_id), "organiser's child dropped at home by the auto-end");
  ok((await api.getRide(back.id)).on_time === null, "home run has no on_time verdict");

  // --- v8: home run with no organiser child travelling → home_end skipped, ends at the last drop ---
  await api.setAbsence("cp1", riya.child_id, true);
  const noOwn = await api.startRide("cp1", "asha", null, "from_school");
  ok(noOwn.stops!.map((s) => s.kind).join(",") === "school,drop,home_end" && noOwn.order?.length === 1, "home run route lists only the other families' children");
  await stopAndGo(noOwn.id, SCH);
  const lastDrop = await stopAndGo(noOwn.id, nehaHome);
  ok(lastDrop.ended === true && kindOf(lastDrop.stops, "home_end")!.status === "skipped", "no organiser child on board → trip ends at the last drop, home_end skipped");
  await api.setAbsence("cp1", riya.child_id, false);

  // --- One carpool = one driving family ---
  const cands = await api.tripDrivers("cp1");
  ok(cands.some((d) => d.id === "asha") && !cands.some((d) => d.name === "Neha Gupta"), "only the organiser's household are drivers");
  await as("neha@demo.in");
  ok(await throws(() => api.startRide("cp1", "neha", null, "to_school")), "a member cannot start the organiser's trips");
  ok((await api.getCarpool("cp1")).is_org_household === false, "member is not the organising household");
  await as("priya@demo.in");
  ok((await api.getProfile())?.can_drive === false, "Priya has no car");
  ok(await throws(() => api.createCarpool({ name: "X" })), "a car-less parent cannot create a carpool");

  // --- No-car parent joins an existing carpool ---
  const disc = await api.searchParents({});
  ok(disc.carpools.some((c2) => c2.id === "cp1"), "car-less parent sees nearby carpools");
  await api.requestJoinCarpool("cp1");
  await as("asha@demo.in");
  const cpReq = await api.getCarpool("cp1");
  ok(cpReq.members.some((m) => m.parent_id === "priya" && m.status === "requested"), "organiser sees the join request");
  await api.respondJoinRequest("cp1", "priya", true);
  ok((await api.getCarpool("cp1")).members.some((m) => m.parent_id === "priya" && m.status === "joined"), "Priya joined after approval");

  // --- Carpool create + invite + ownership transfer ---
  await as("asha@demo.in");
  const neha = all.parents.find((p) => p.name === "Neha Gupta")!;
  const created = await api.createCarpool({ name: "Test Pool", invite_ids: [neha.id] });
  ok(created.joined.length === 1, "creator auto-joins new carpool");
  await as("neha@demo.in");
  ok((await api.respondInvite(created.id, true)).joined.length === 2, "Neha accepts → 2 joined");
  await as("asha@demo.in"); await api.leaveCarpool(created.id);
  await as("neha@demo.in");
  ok((await api.myCarpools()).find((cc) => cc.id === created.id)?.is_creator === true, "ownership transfers when the organiser leaves");

  // --- Delete carpool: organiser only, never while live ---
  await as("vikram@demo.in");
  const del = await api.createCarpool({ name: "To Delete" });
  await as("neha@demo.in");
  ok(await throws(() => api.deleteCarpool(del.id)), "a non-organiser cannot delete a carpool");
  await as("vikram@demo.in"); await api.deleteCarpool(del.id);
  ok(!(await api.myCarpools()).some((cc) => cc.id === del.id), "organiser deleted the carpool");
  await as("asha@demo.in");
  const liveR = await api.startRide("cp1", "asha", null, "to_school", ashaHome.lat, ashaHome.lng);
  ok(await throws(() => api.deleteCarpool("cp1")), "cannot delete a carpool with a live trip");

  // --- Ended-trip guards ---
  await api.endRide(liveR.id);
  ok(await throws(() => api.rideBoard(liveR.id, riya.child_id)), "boarding on an ended trip is rejected");
  ok(await throws(() => api.postLocation(liveR.id, SCH.lat, SCH.lng)), "posting location on an ended trip is rejected");

  // --- v8: chat + notification bus ---
  const chatSeen: ChatMessage[] = []; const notifSeen: Notification[] = [];
  const offChat = api.onChat("cp1", (m) => chatSeen.push(m));
  await as("neha@demo.in");
  const offNotif = api.onNotifications((n) => notifSeen.push(n));
  await as("asha@demo.in");
  const sent = await api.sendChat("cp1", "Leaving in 5!");
  ok(chatSeen.length === 1 && chatSeen[0].id === sent.id, "chat:<carpoolId> delivers the message");
  ok(notifSeen.some((n) => n.kind === "chat"), "notif:<userId> delivers the member's inbox insert");
  offChat(); offNotif();

  // --- v8: web push flips push_enabled; no VAPID key in demo ---
  ok((await api.pushPublicKey()) === null, "pushPublicKey() is null in demo");
  ok((await api.getProfile())?.push_enabled === false, "push_enabled false before subscribing");
  await api.savePushSubscription({ endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }, "test-ua");
  ok((await api.getProfile())?.push_enabled === true, "savePushSubscription → push_enabled true");
  await api.removePushSubscription("https://push.example/abc");
  ok((await api.getProfile())?.push_enabled === false, "removePushSubscription → push_enabled false");
  ok(await throws(() => api.savePushSubscription({ endpoint: "", keys: { p256dh: "", auth: "" } })), "invalid subscription rejected");

  // --- v8: replay + punctuality stats (seeded history) ---
  const hist = await api.tripHistory();
  const seeded = hist.filter((h) => h.driver_name === "Ramesh Kumar");
  ok(seeded.length >= 6, "seeded history has completed trips with the family driver");
  ok(hist.some((h) => (h.missed_count ?? 0) > 0), "a seeded trip has a missed pickup");
  ok(seeded.some((h) => h.on_time === true) && seeded.every((h) => h.direction === "to_school" ? typeof h.on_time === "boolean" : h.on_time === null), "school runs that reached the gate carry an on_time verdict; home runs none");
  ok(hist.some((h) => h.id === r2.id && h.on_time === null), "a school run ended before the gate has no on_time verdict");
  const rep = await api.tripReplay(seeded[0].id);
  ok(rep.ride.id === seeded[0].id && Array.isArray(rep.stops) && Array.isArray(rep.pings) && Array.isArray(rep.events), "tripReplay = { ride, stops, pings, events }");
  ok(rep.pings.length > 10 && rep.pings.every((p) => typeof p.lat === "number" && isoRe.test(p.created_at)), "replay has a full ping trail");
  ok(rep.pings.some((p) => typeof p.speed_kmh === "number") && rep.pings.some((p) => typeof p.heading === "number"), "pings carry speed_kmh + heading");
  ok(rep.pings.every((p, i) => i === 0 || t(p.created_at) >= t(rep.pings[i - 1].created_at)), "pings are in time order");
  ok(rep.stops.length >= 3 && rep.stops.every((s) => s.eta_min === null) && rep.stops.some((s) => s.status === "done" && typeof s.delay_min === "number"), "replay stops have final states + delays, no live ETA");
  ok(rep.events.some((e) => e.type === "started") && rep.events.some((e) => e.type === "ended"), "replay events bracket the trip");
  ok(typeof rep.ride.distance_km === "number" && rep.ride.distance_km > 1 && typeof rep.ride.actual_duration_min === "number", "replayed ride has distance/duration");
  const cs = await api.carpoolStats("cp1");
  ok(cs.trips >= 8, "carpoolStats.trips counts completed trips");
  ok(typeof cs.on_time_pct === "number" && cs.on_time_pct >= 0 && cs.on_time_pct <= 100, "on_time_pct in 0..100");
  ok(typeof cs.missed_rate === "number" && cs.missed_rate > 0 && cs.missed_rate < 1, "missed_rate is a fraction 0..1");
  ok(typeof cs.avg_pickup_delay_min === "number" && typeof cs.avg_duration_min === "number", "avg delay + avg duration numeric");
  ok(cs.trend.length === 10 && cs.trend.every((x) => dateRe.test(x.date)), "trend = last 10 trips with IST YYYY-MM-DD dates");
  ok(cs.trend.every((x, i) => i === 0 || x.date >= cs.trend[i - 1].date), "trend is chronological");
  await as("neha@demo.in");
  ok((await api.carpoolStats("cp1")).trips === cs.trips, "member can read carpool stats");
  await as("rahul@demo.in");
  ok(await throws(() => api.carpoolStats("cp1")), "non-member cannot read carpool stats");

  // --- Ratings are gone; admin sees route incidents ---
  ok(!("rateTrip" in api), "rating flow removed entirely");
  await as("admin@vasantvalley.demo");
  const inc = await api.adminIncidents();
  ok(Array.isArray(inc), "incident log returns array");
  ok(inc.some((i) => i.type === "missed_pickup") && inc.every((i) => typeof i.ride_id === "string" && typeof i.carpool === "string" && isoRe.test(i.created_at)), "incidents carry ride_id / carpool / type / created_at");
  const an = await api.adminAnalytics();
  ok(typeof an.approved === "number", "analytics coverage");
  ok(typeof an.trips === "number" && an.trips >= cs.trips && typeof an.completed_trips === "number", "school-wide analytics count all completed trips");
  ok(an.per_carpool.some((p) => p.id === "cp1" && p.stats.trips === cs.trips), "per-carpool table matches carpoolStats");
  ok(typeof an.on_time_pct === "number" && typeof an.missed_rate === "number" && an.matched + an.unmatched === an.approved, "analytics numeric + matched/unmatched sum");
  ok(Array.isArray(await api.adminAttendance()), "attendance register returns rows");
  ok((await api.adminStats()).live === 0, "adminStats.live counts active trips");

  // --- v8: settings — admin only, validated ---
  const st = await api.getSettings();
  ok(st.fence_near_m === 400 && st.fence_stop_m === 150 && st.fence_leave_m === 300 && st.fence_miss_m === 600 && st.dwell_s === 8
     && st.stationary_m === 30 && st.school_gate_m === 300 && st.offroute_km === 2 && st.long_stop_s === 300 && st.speed_max_kmh === 80
     && st.school_start_time === "07:50" && st.school_end_time === "14:10" && st.city_speed_kmh === 22 && st.road_factor === 1.3, "settings defaults per SPEC §3");
  ok(await throws(() => api.setSettings({ fence_stop_m: 500, fence_leave_m: 300 })), "fences must satisfy stop < leave ≤ miss");
  ok(await throws(() => api.setSettings({ school_start_time: "25:99" })), "bell time validated");
  const st2 = await api.setSettings({ speed_max_kmh: 90, school_start_time: "8:00" });
  ok(st2.speed_max_kmh === 90 && st2.school_start_time === "08:00", "admin updates settings");
  await api.setSettings({ speed_max_kmh: 80, school_start_time: "07:50" });
  await as("asha@demo.in");
  ok(await throws(() => api.setSettings({ speed_max_kmh: 90 })), "setSettings is admin-only");
  ok((await api.getSettings()).speed_max_kmh === 80, "parents can read settings");

  // --- New registration + admin approval ---
  const fresh = await as("new@demo.in");
  ok(fresh.status === "new", "unknown email → registration path");
  const reg = await api.register("new@demo.in", { name: "New Parent", child_name: "Kid", child_class: 4, home_lat: 28.54, home_lng: 77.15, accept_tnc: true });
  ok(reg.status === "pending", "new parent pending verification");
  await as("admin@vasantvalley.demo");
  const pend = await api.adminRegistrations("pending");
  ok(pend.length >= 1, "admin sees pending registrations");

  // --- v8: anomalies with a controlled clock (__VVS_NOW) ---
  await as("asha@demo.in");
  const T0 = Date.now(); G.__VVS_NOW = T0;
  const evs: RideEvent[] = [];
  const an1 = await api.startRide("cp1", "asha", null, "to_school", ashaHome.lat, ashaHome.lng);
  const offEv = api.onRideEvents(an1.id, (e) => evs.push(e));
  const mid = { lat: SCH.lat + 0.0015, lng: SCH.lng + 0.012 };       // on the corridor, > 1 km from every stop
  await api.postLocation(an1.id, mid.lat, mid.lng);
  G.__VVS_NOW = T0 + 100_000;
  const ls1 = await api.postLocation(an1.id, mid.lat, mid.lng);
  ok(ls1.anomalies.length === 0, "100 s stationary away from stops is not yet a long stop");
  G.__VVS_NOW = T0 + 310_000;
  const ls2 = await api.postLocation(an1.id, mid.lat, mid.lng);
  ok(ls2.anomalies.includes("long_stop"), "stationary ≥ long_stop_s away from any stop → 'long_stop'");
  ok(evs.some((e) => e.type === "anomaly_long_stop"), "rideev:<rideId> carries anomaly_long_stop");
  G.__VVS_NOW = T0 + 320_000;
  const ls3 = await api.postLocation(an1.id, mid.lat, mid.lng);
  ok(!ls3.anomalies.includes("long_stop"), "long stop reported once per stationary episode");
  await as("neha@demo.in");
  ok((await api.notifications()).some((n) => n.title === "Long stop ⚠️"), "carpool audience alerted about the long stop");
  await as("asha@demo.in");
  // a long wait AT a pickup is a pickup, not an anomaly
  G.__VVS_NOW = T0 + 400_000; await api.postLocation(an1.id, nehaHome.lat, nehaHome.lng);
  G.__VVS_NOW = T0 + 410_000; await api.postLocation(an1.id, nehaHome.lat, nehaHome.lng);
  G.__VVS_NOW = T0 + 800_000; const atStop = await api.postLocation(an1.id, nehaHome.lat, nehaHome.lng);
  ok(!atStop.anomalies.includes("long_stop") && stopOf(atStop.stops, kabirId)!.status === "stopped" && stopOf(atStop.stops, kabirId)!.dwell_s === 390, "390 s at the pickup: dwell counted, no long-stop anomaly");
  G.__VVS_NOW = T0 + 900_000; const left = await api.postLocation(an1.id, nehaHome.lat + 0.006, nehaHome.lng);
  const kLeft = stopOf(left.stops, kabirId)!;
  ok(kLeft.status === "done" && kLeft.dwell_s === 490 && left.anomalies.length === 0, "leaving after a real dwell boards (dwell_s = stopped→left), 24 km/h is not speeding");
  ok(typeof kLeft.delay_min === "number" && kLeft.delay_min === Math.round((T0 + 900_000 - t(kLeft.planned_at)) / 60000), "delay_min = done_at − planned_at in minutes (negative = early)");
  // speeding: ~556 m in 10 s = 200 km/h
  G.__VVS_NOW = T0 + 910_000; const sp1 = await api.postLocation(an1.id, nehaHome.lat + 0.011, nehaHome.lng);
  ok(sp1.anomalies.includes("speed"), "ping-to-ping speed > speed_max_kmh → 'speed'");
  ok(evs.some((e) => e.type === "anomaly_speed"), "anomaly_speed event emitted");
  G.__VVS_NOW = T0 + 920_000; const sp2 = await api.postLocation(an1.id, nehaHome.lat + 0.016, nehaHome.lng);
  ok(!sp2.anomalies.includes("speed"), "speeding reported at most once per 5 min");
  await as("admin@vasantvalley.demo");
  const inc2 = await api.adminIncidents();
  ok(inc2.some((i) => i.type === "anomaly_long_stop" && i.ride_id === an1.id) && inc2.some((i) => i.type === "anomaly_speed" && i.ride_id === an1.id), "anomalies land in the incident log");
  await as("asha@demo.in"); await api.endRide(an1.id); offEv();
  delete G.__VVS_NOW;

  // --- Stale trip sweeps on next touch ---
  await as("asha@demo.in");
  const stale = await api.startRide("cp1", "asha", null, "to_school", ashaHome.lat, ashaHome.lng);
  const rides = await api.activeRides();
  ok(rides.some((r) => r.id === stale.id), "active ride listed for the household");
  await api.endRide(stale.id);
  ok((await api.activeRides()).length === 0, "stale-sweep path exercised");

  console.log(`\n=== LOGIC: ${pass} passed, ${fail} failed ===`);
  if (fail) process.exit(1);
}
run().catch((e) => { console.error("CRASH", e); process.exit(1); });
