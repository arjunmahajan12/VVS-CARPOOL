// The ONE data contract the whole UI talks to. Both `demoBackend` (in-memory)
// and `supabaseBackend` (RPC) implement this interface — TypeScript enforces
// parity, so a method added here must exist in both.
import type {
  Profile, SignInResult, RegisterData, Child, Vehicle,
  Discovery, Filters, Carpool, TripDriver, Ride, LocationResult, Stop, RideEvent,
  TripSummary, TripReplay, CarpoolStats, ChatMessage, Notification, School, Settings,
  Broadcast, AttendanceRow, Incident, AdminStats, AdminAnalytics, PushSubscriptionJSON,
  Direction,
} from "./types";

export type Unsub = () => void;

export interface Backend {
  // ---- pre-login ----
  publicConfig(): Promise<{ demo_logins: boolean; school_name?: string | null }>;

  // ---- auth / profile ----
  signIn(email: string, password: string): Promise<SignInResult>;
  signUp(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  getProfile(): Promise<Profile | null>;
  register(email: string, data: RegisterData): Promise<Profile>;
  pendingInvite(): Promise<{ name: string; relation: string; parent_name: string } | null>;
  updateProfile(patch: Partial<Profile>): Promise<Profile>;
  addChild(c: Partial<Child> & { name: string; class_level: number }): Promise<Profile>;
  updateChild(childId: string, patch: Partial<Child>): Promise<Profile>;
  removeChild(childId: string): Promise<Profile>;
  addAddon(a: { name: string; email: string; relation: string }): Promise<Profile>;
  removeAddon(addonId: string): Promise<Profile>;
  confirmDriver(addonId: string, confirmed: boolean, plate?: string): Promise<Profile>;
  acceptTnc(): Promise<Profile>;
  latestTnc(): Promise<{ version: number; body: string } | null>;
  addTrusted(t: { name: string; phone: string }): Promise<Profile>;
  removeTrusted(id: string): Promise<Profile>;

  // ---- driver (family add-on with relation 'driver') ----
  getDriverProfile(): Promise<Profile>;
  updateDriverProfile(patch: { vehicle?: Vehicle; photo_url?: string }): Promise<Profile>;
  addDriverDoc(doc: { type: string; number: string; expiry: string }): Promise<Profile>;
  removeDriverDoc(docId: string): Promise<Profile>;
  myDriverCarpools(): Promise<Carpool[]>;

  // ---- discovery ----
  searchParents(filters: Filters): Promise<Discovery>;

  // ---- carpools ----
  myCarpools(): Promise<Carpool[]>;
  getCarpool(carpoolId: string): Promise<Carpool>;
  createCarpool(data: { name: string; seats?: number; invite_ids?: string[] }): Promise<Carpool>;
  respondInvite(carpoolId: string, accept: boolean): Promise<Carpool>;
  requestJoinCarpool(carpoolId: string): Promise<{ ok: true }>;
  respondJoinRequest(carpoolId: string, parentId: string, accept: boolean): Promise<Carpool>;
  setDriver(carpoolId: string, name: string, phone: string, vehicle?: string): Promise<Carpool>;
  leaveCarpool(carpoolId: string): Promise<{ ok: true }>;
  deleteCarpool(carpoolId: string): Promise<{ ok: true }>;
  tripDrivers(carpoolId: string): Promise<TripDriver[]>;
  setAbsence(carpoolId: string, childId: string, absent: boolean): Promise<Carpool>;
  carpoolStats(carpoolId: string): Promise<CarpoolStats>;

  // ---- trips ----
  startRide(carpoolId: string, driverUserId?: string | null, order?: string[] | null,
    direction?: Direction | null, originLat?: number | null, originLng?: number | null): Promise<Ride>;
  activeRides(): Promise<Ride[]>;
  getRide(rideId: string): Promise<Ride>;
  postLocation(rideId: string, lat: number, lng: number, speedKmh?: number | null, heading?: number | null): Promise<LocationResult>;
  rideEvent(rideId: string, type: string, note: string, childId?: string | null): Promise<{ ok: true }>;
  rideBoard(rideId: string, childId: string): Promise<{ ok: true }>;
  rideUnboard(rideId: string, childId: string): Promise<{ ok: true }>;
  rideDrop(rideId: string, childId: string, place?: "school" | "home"): Promise<{ ok: true }>;
  endRide(rideId: string): Promise<{ ok: true }>;
  tripHistory(): Promise<TripSummary[]>;
  tripReplay(rideId: string): Promise<TripReplay>;

  // ---- chat / notifications / push ----
  getChat(carpoolId: string): Promise<ChatMessage[]>;
  sendChat(carpoolId: string, body: string): Promise<ChatMessage>;
  notifications(): Promise<Notification[]>;
  markNotificationsRead(): Promise<{ ok: true }>;
  pushPublicKey(): Promise<string | null>;
  savePushSubscription(sub: PushSubscriptionJSON, ua?: string): Promise<{ ok: true }>;
  removePushSubscription(endpoint: string): Promise<{ ok: true }>;

  // ---- school settings / admin ----
  getSchool(): Promise<School>;
  setSchool(s: School): Promise<School>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  adminRegistrations(status: "pending" | "approved" | "rejected"): Promise<Profile[]>;
  adminDecision(userId: string, decision: "approved" | "rejected", reason?: string): Promise<{ ok: true }>;
  adminStats(): Promise<AdminStats>;
  adminCarpools(): Promise<Carpool[]>;
  adminAnalytics(): Promise<AdminAnalytics>;
  adminIncidents(): Promise<Incident[]>;
  adminAttendance(): Promise<AttendanceRow[]>;
  adminBroadcast(title: string, body: string): Promise<{ ok: true }>;
  getBroadcasts(): Promise<Broadcast[]>;
  publishTnc(body: string): Promise<{ version: number }>;
  adminTncList(): Promise<{ version: number; body: string; published_at: string }[]>;
  promoteYear(): Promise<{ academic_year: number }>;

  // ---- realtime ----
  onRideLocation(rideId: string, cb: (p: { lat: number; lng: number; heading?: number | null; eta_min?: number | null; distance_km?: number | null }) => void): Unsub;
  onRideEvents(rideId: string, cb: (e: RideEvent) => void): Unsub;
  onRideStops(rideId: string, cb: (stops: Stop[]) => void): Unsub;
  onRideEnded(rideId: string, cb: () => void): Unsub;
  onNotifications(cb: (n: Notification) => void): Unsub;
  onChat(carpoolId: string, cb: (m: ChatMessage) => void): Unsub;
}
