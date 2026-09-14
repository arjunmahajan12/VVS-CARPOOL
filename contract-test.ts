// CONTRACT SUITE — every Backend method exercised at least once against the demo
// backend, plus permission guards, edge cases and the realtime subscriptions.
// (logic-test.ts covers the trip model in depth; this file covers breadth.)
import { demoBackend as api } from "./src/lib/demo";
(globalThis as any).__VVS_DWELL_MS = 0;

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const throws = async (fn: () => Promise<unknown>, m: string, re?: RegExp) => {
  try { await fn(); ok(false, m + " (did not throw)"); }
  catch (e) { ok(!re || re.test(String((e as Error).message)), m + (re ? ` (message: ${String((e as Error).message).slice(0, 60)})` : "")); }
};
const SCH = { lat: 28.533246002067454, lng: 77.14409813768475 };
const ashaHome = { lat: SCH.lat + 0.012, lng: SCH.lng + 0.010 };
async function stopAndGo(rideId: string, p: { lat: number; lng: number }) {
  await api.postLocation(rideId, p.lat, p.lng); await api.postLocation(rideId, p.lat, p.lng); await api.postLocation(rideId, p.lat + 0.006, p.lng);
}

async function run() {
  // ---------------- pre-login / auth ----------------
  ok((await api.publicConfig()).demo_logins === true, "publicConfig: demo logins on");
  ok((await api.getProfile()) === null, "getProfile is null before sign-in");
  const su = await api.signUp("brandnew@demo.in", "pw");
  ok(su.status === "new", "signUp with unknown email → 'new' (onboarding)");
  ok((await api.pendingInvite()) === null, "pendingInvite null for a non-invited email");
  await throws(() => api.searchParents({}), "unauthenticated call is rejected");
  await api.signOut();
  ok((await api.getProfile()) === null, "signOut clears the session");

  // ---------------- profile / family ----------------
  const asha = await api.signIn("asha@demo.in", "");
  ok(asha.status === "in", "sign in");
  let p = await api.updateProfile({ phone: "+91 90000 00001", colony: "B-6 (edited)" });
  ok(p.phone === "+91 90000 00001" && p.colony === "B-6 (edited)", "updateProfile patches fields");
  const before = p.children.length;
  p = await api.addChild({ name: "Contract Kid", class_level: 3, gender: "male", allergies: "none" });
  ok(p.children.length === before + 1, "addChild");
  const kid = p.children.find((c) => c.name === "Contract Kid")!;
  p = await api.updateChild(kid.id, { class_level: 4, name: "Contract Kid II" });
  ok(p.children.find((c) => c.id === kid.id)?.class_level === 4 && p.children.find((c) => c.id === kid.id)?.name === "Contract Kid II", "updateChild");
  p = await api.removeChild(kid.id);
  ok(!p.children.some((c) => c.id === kid.id), "removeChild");
  p = await api.addAddon({ name: "Aunt Test", email: "aunt@demo.in", relation: "aunt" });
  const aunt = p.addons.find((a) => a.email === "aunt@demo.in");
  ok(!!aunt && aunt.signed_up === false, "addAddon creates a pending invite (not signed up)");
  p = await api.addTrusted({ name: "Trusted Neighbour", phone: "+91 90000 00002" });
  const tr = p.trusted!.find((t) => t.name === "Trusted Neighbour")!;
  ok(!!tr, "addTrusted");
  p = await api.removeTrusted(tr.id);
  ok(!p.trusted!.some((t) => t.id === tr.id), "removeTrusted");
  const ramesh = p.addons.find((a) => a.email === "driver@demo.in")!;
  p = await api.confirmDriver(ramesh.id, false);
  ok(p.addons.find((a) => a.id === ramesh.id)?.driver_status === "incomplete", "confirmDriver(false) un-confirms");
  ok(!(await api.tripDrivers("cp1")).some((d) => d.id === ramesh.id && d.confirmed), "un-confirmed driver is not a confirmed trip driver");
  p = await api.confirmDriver(ramesh.id, true, "DL 3C AB 1234");
  ok(p.addons.find((a) => a.id === ramesh.id)?.driver_status === "verified", "confirmDriver(true) re-confirms");
  const latest = await api.latestTnc();
  ok(!!latest && latest.version >= 1 && latest.body.length > 20, "latestTnc returns the current version");
  p = await api.acceptTnc();
  ok(p.tnc_version === latest!.version && p.needs_tnc === false, "acceptTnc records the version");

  // ---------------- add-on onboarding via invite ----------------
  await api.signOut();
  const auntIn = await api.signIn("aunt@demo.in", "");
  ok(auntIn.status === "in" && auntIn.profile.role === "addon" && auntIn.profile.parent_owner_id === "asha", "invited email is linked to the family on first sign-in");
  await throws(() => api.createCarpool({ name: "X" }), "an add-on cannot create a carpool");
  ok((await api.myCarpools()).some((c) => c.id === "cp1"), "add-on sees the family's carpool");
  await api.signOut(); await api.signIn("asha@demo.in", "");
  const auntProfile = (await api.getProfile())!.addons.find((a) => a.email === "aunt@demo.in")!;
  p = await api.removeAddon(auntProfile.id);
  ok(!p.addons.some((a) => a.email === "aunt@demo.in"), "removeAddon removes invite + login");
  await api.signOut();
  ok((await api.signIn("aunt@demo.in", "")).status === "new", "removed add-on is no longer linked");
  await api.signOut();

  // ---------------- driver profile ----------------
  await api.signIn("driver@demo.in", "");
  const dp = await api.getDriverProfile();
  ok(dp.role === "addon" && dp.relation === "driver", "getDriverProfile");
  const dp2 = await api.updateDriverProfile({ vehicle: { make_model: "Maruti Ertiga", color: "Silver", plate: "DL 3C AB 9999", seats: 6 } });
  ok(dp2.vehicle?.plate === "DL 3C AB 9999", "updateDriverProfile updates the vehicle");
  const dp3 = await api.addDriverDoc({ type: "licence", number: "DL-TEST-1", expiry: "2030-01-01" });
  const doc = dp3.documents!.find((d) => d.number === "DL-TEST-1")!;
  ok(!!doc, "addDriverDoc (legacy API still works)");
  ok(!(await api.removeDriverDoc(doc.id)).documents!.some((d) => d.id === doc.id), "removeDriverDoc");
  ok((await api.myDriverCarpools()).some((c) => c.id === "cp1"), "myDriverCarpools lists the family's carpool");
  await api.signOut();

  // ---------------- carpool admin-ish ops ----------------
  await api.signIn("asha@demo.in", "");
  const sd = await api.setDriver("cp1", "Ramesh Kumar", "+91 98700 12345", "DL 3C AB 1234");
  ok(sd.driver_name === "Ramesh Kumar" && sd.driver_vehicle === "DL 3C AB 1234", "setDriver");
  const chat = await api.getChat("cp1");
  ok(Array.isArray(chat) && chat.length >= 2, "getChat returns seeded messages");
  const sent = await api.sendChat("cp1", "contract hello");
  ok(sent.body === "contract hello" && (await api.getChat("cp1")).some((m) => m.id === sent.id), "sendChat appends");
  await api.signOut(); await api.signIn("rahul@demo.in", "");
  await throws(() => api.sendChat("cp1", "intruder"), "non-member cannot post in a carpool chat");
  await throws(() => api.getCarpool("cp1"), "non-member cannot open a carpool");
  await api.signOut(); await api.signIn("asha@demo.in", "");

  // ---------------- seats / full carpool ----------------
  const disc = await api.searchParents({});
  const vik = disc.parents.find((x) => x.name === "Vikram Sharma")!; // 2 kids
  const neh = disc.parents.find((x) => x.name === "Neha Gupta")!;    // 1 kid
  const small = await api.createCarpool({ name: "Tiny Pool", seats: 2, invite_ids: [vik.id, neh.id] });
  await api.signOut(); await api.signIn("neha@demo.in", "");
  await api.respondInvite(small.id, true);
  await api.signOut(); await api.signIn("vikram@demo.in", "");
  await throws(() => api.respondInvite(small.id, true), "accepting beyond the seat limit is refused", /full|seat/i);
  await api.signOut(); await api.signIn("asha@demo.in", "");

  // ---------------- pending user is blocked from carpool actions ----------------
  await api.signOut(); await api.signIn("rohan@demo.in", "");
  await throws(() => api.createCarpool({ name: "Nope" }), "pending family cannot create a carpool", /verification|approve/i);
  await throws(() => api.requestJoinCarpool("cp1"), "pending family cannot request a seat", /verification|approve/i);
  await api.signOut();

  // ---------------- notifications ----------------
  await api.signIn("neha@demo.in", "");
  const unread = (await api.notifications()).filter((n) => !n.read).length;
  ok(unread > 0, "Neha has unread notifications");
  await api.markNotificationsRead();
  ok((await api.notifications()).every((n) => n.read), "markNotificationsRead marks all read");
  await api.signOut();

  // ---------------- trips: guards + rideDrop + realtime ----------------
  await api.signIn("asha@demo.in", "");
  const ride = await api.startRide("cp1", "asha", null, "to_school", ashaHome.lat, ashaHome.lng);
  ok((await api.startRide("cp1", "asha", null, "to_school")).id === ride.id, "a second start while live returns the same live trip (idempotent)");
  const active = await api.activeRides();
  ok(active.length === 1 && active[0].id === ride.id, "activeRides lists exactly the live trip (no duplicate start)");
  await throws(() => api.leaveCarpool("cp1"), "cannot leave while a trip is live", /live/i);
  const seen: string[] = [];
  const offLoc = api.onRideLocation(ride.id, () => seen.push("loc"));
  const offEv = api.onRideEvents(ride.id, () => seen.push("ev"));
  const offSt = api.onRideStops(ride.id, () => seen.push("stops"));
  const offEnd = api.onRideEnded(ride.id, () => seen.push("ended"));
  const offN = api.onNotifications(() => seen.push("notif"));
  const offC = api.onChat("cp1", () => seen.push("chat"));
  await stopAndGo(ride.id, ashaHome);
  ok(seen.includes("loc") && seen.includes("stops"), "onRideLocation + onRideStops fire on pings");
  ok(seen.includes("ev"), "onRideEvents fires on boarding");
  await api.sendChat("cp1", "ping"); ok(seen.includes("chat"), "onChat fires");
  const riya = (await api.getCarpool("cp1")).riders!.find((r) => r.child_name === "Riya Mehta")!;
  await api.rideDrop(ride.id, riya.child_id, "school");
  ok((await api.getCarpool("cp1")).riders!.find((r) => r.child_id === riya.child_id)?.status === "dropped", "rideDrop marks the child dropped");
  await api.endRide(ride.id);
  ok(seen.includes("ended"), "onRideEnded fires");
  offLoc(); offEv(); offSt(); offEnd(); offN(); offC();
  const n0 = seen.length; await api.sendChat("cp1", "after-unsub");
  ok(seen.length === n0, "unsubscribe stops events");
  await throws(() => api.rideDrop(ride.id, riya.child_id), "rideDrop on an ended trip is rejected");
  await throws(() => api.postLocation(ride.id, SCH.lat, SCH.lng), "postLocation on an ended trip is rejected");

  // ---------------- start with every child absent ----------------
  const cp1 = await api.getCarpool("cp1");
  for (const r of cp1.riders!.filter((r) => !r.absent)) { await api.signOut(); await api.signIn(r.parent_id === "asha" ? "asha@demo.in" : "neha@demo.in", ""); await api.setAbsence("cp1", r.child_id, true); }
  await api.signOut(); await api.signIn("asha@demo.in", "");
  const allAbsent = await api.startRide("cp1", "asha", null, "to_school", ashaHome.lat, ashaHome.lng);
  const pk = allAbsent.stops!.filter((s) => s.kind === "pickup");
  ok(pk.length === cp1.riders!.length && pk.every((s) => s.status === "skipped"), "all-absent trip: every child still has a stop, all marked skipped");
  await api.endRide(allAbsent.id);
  for (const r of cp1.riders!) { await api.signOut(); await api.signIn(r.parent_id === "asha" ? "asha@demo.in" : "neha@demo.in", ""); await api.setAbsence("cp1", r.child_id, false); }
  await api.signOut(); await api.signIn("asha@demo.in", "");

  // ---------------- midnight sweep ----------------
  const stale = await api.startRide("cp1", "asha", null, "to_school", ashaHome.lat, ashaHome.lng);
  (globalThis as any).__VVS_NOW = Date.now() + 36 * 3600e3; // next day
  ok((await api.activeRides()).length === 0, "a trip left open is auto-closed on the next day");
  ok((await api.tripHistory()).some((t) => t.id === stale.id && t.events.some((e) => /auto-closed/i.test(e.note ?? ""))), "auto-closed trip lands in history with the reason");
  delete (globalThis as any).__VVS_NOW;
  await api.signOut();

  // ---------------- admin surface ----------------
  await api.signIn("admin@vasantvalley.demo", "");
  const sch = await api.getSchool();
  ok(sch.name.length > 0 && Math.abs(sch.lat - SCH.lat) < 1e-6, "getSchool");
  const sch2 = await api.setSchool({ name: "VVS (moved)", lat: SCH.lat + 0.001, lng: SCH.lng });
  ok(sch2.name === "VVS (moved)", "setSchool");
  await api.setSchool({ name: sch.name, lat: sch.lat, lng: sch.lng });
  const stats = await api.adminStats();
  ok(typeof stats.pending === "number" && typeof stats.approved === "number" && stats.school.name === sch.name, "adminStats");
  const acs = await api.adminCarpools();
  ok(acs.some((c) => c.id === "cp1") && acs.find((c) => c.id === "cp1")!.members.every((m) => "phone" in m), "adminCarpools exposes members with phones");
  const pendingBefore = (await api.adminRegistrations("pending")).length;
  const rohan = (await api.adminRegistrations("pending")).find((x) => x.email === "rohan@demo.in")!;
  await api.adminDecision(rohan.id, "rejected", "Not on the roll");
  ok((await api.adminRegistrations("pending")).length === pendingBefore - 1 && (await api.adminRegistrations("rejected")).some((x) => x.id === rohan.id), "adminDecision(rejected)");
  await api.adminDecision(rohan.id, "approved");
  ok((await api.adminRegistrations("approved")).some((x) => x.id === rohan.id), "adminDecision(approved)");
  ok(Array.isArray(await api.adminAttendance()), "adminAttendance");
  await api.adminBroadcast("Contract notice", "Body text");
  ok((await api.getBroadcasts()).some((b) => b.title === "Contract notice"), "adminBroadcast + getBroadcasts");
  const v = await api.publishTnc("Contract terms — a full new version of the terms text for testing purposes.");
  ok(v.version === latest!.version + 1 && (await api.adminTncList())[0].version === v.version, "publishTnc + adminTncList");
  const kidsBefore = (await api.adminCarpools()).find((c) => c.id === "cp1")!.riders!.map((r) => r.class_level);
  const py = await api.promoteYear();
  const kidsAfter = (await api.adminCarpools()).find((c) => c.id === "cp1")!.riders!.map((r) => r.class_level);
  ok(py.academic_year > 2026 && kidsAfter.every((c, i) => c === Math.min(kidsBefore[i] + 1, 13)), "promoteYear moves every child up one class");
  await api.signOut();

  // ---------------- non-admin is refused every admin RPC ----------------
  await api.signIn("neha@demo.in", "");
  ok((await api.getProfile())!.needs_tnc === true, "parents need to accept the newly published terms");
  for (const [name, fn] of Object.entries({
    adminRegistrations: () => api.adminRegistrations("pending"), adminDecision: () => api.adminDecision("asha", "approved"),
    adminStats: () => api.adminStats(), adminCarpools: () => api.adminCarpools(), adminAnalytics: () => api.adminAnalytics(),
    adminIncidents: () => api.adminIncidents(), adminAttendance: () => api.adminAttendance(), adminBroadcast: () => api.adminBroadcast("x", "y"),
    publishTnc: () => api.publishTnc("x".repeat(30)), adminTncList: () => api.adminTncList(), setSchool: () => api.setSchool({ name: "x", lat: 1, lng: 1 }),
    setSettings: () => api.setSettings({ dwell_s: 9 }), promoteYear: () => api.promoteYear(),
  })) await throws(fn as () => Promise<unknown>, `parent is refused ${name}`);
  ok(Array.isArray(await api.getBroadcasts()), "parents can read broadcasts");
  await api.signOut();

  console.log(`\n=== CONTRACT: ${pass} passed, ${fail} failed ===`);
  if (fail) process.exit(1);
}
run().catch((e) => { console.error("CRASH", e); process.exit(1); });
