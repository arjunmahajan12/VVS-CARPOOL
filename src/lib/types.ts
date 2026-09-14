// v8 domain types. Shared by both backends and every screen.
export type Role = "parent" | "admin" | "addon";
export type Status = "pending" | "approved" | "rejected";
export type Direction = "to_school" | "from_school";

export interface Child {
  id: string; name: string; class_level: number; gender?: string | null;
  photo_url?: string | null; allergies?: string | null; emergency_name?: string | null; emergency_phone?: string | null;
}
export interface Addon { id: string; name: string; email: string; relation?: string | null; driver_status?: string | null; vehicle?: Vehicle | null; signed_up?: boolean; }

export type DocType = "licence" | "insurance" | "puc" | "id";
export interface DriverDoc { id: string; type: DocType; number: string; expiry: string; status: "pending" | "verified" | "rejected"; }
export interface Vehicle { make_model?: string; color?: string; plate?: string; seats?: number; }
export interface TrustedPickup { id: string; name: string; phone: string; }

export interface Profile {
  id: string; role: Role; name: string; email: string;
  phone?: string | null; address?: string | null; colony?: string | null; pincode?: string | null;
  home_lat?: number | null; home_lng?: number | null;
  existing_carpool: boolean; status: Status;
  tnc_version: number; latest_tnc?: number; needs_tnc?: boolean;
  parent_owner_id?: string | null; relation?: string | null;
  can_drive?: boolean;
  children: Child[]; addons: Addon[];
  photo_url?: string | null; vehicle?: Vehicle | null; documents?: DriverDoc[];
  driver_status?: "incomplete" | "pending" | "verified" | "suspended" | "rejected" | null;
  trusted?: TrustedPickup[];
  push_enabled?: boolean;
}

export interface ParentPin {
  id: string; name: string; colony?: string | null; pincode?: string | null; phone?: string | null;
  home_lat?: number | null; home_lng?: number | null; existing_carpool: boolean;
  children: { name: string; class_level: number; gender?: string | null }[];
  distance_km: number | null;            // from YOUR home (ranking key)
  distance_from_route_km: number | null; // extra detour vs your own school run
}
export interface NearbyCarpool {
  id: string; name: string; creator_name?: string | null;
  members_count: number; seats?: number | null; seats_used?: number; full?: boolean;
  distance_km: number | null; lat?: number | null; lng?: number | null;
  my_status?: string | null;
}
export interface Discovery {
  school: School; me: { home_lat?: number | null; home_lng?: number | null };
  parents: ParentPin[]; carpools: NearbyCarpool[];
}

export interface Member {
  parent_id: string; parent_name: string; phone?: string | null; colony?: string | null;
  existing_carpool: boolean; can_drive?: boolean; role: "creator" | "member";
  status: "invited" | "joined" | "rejected" | "left" | "requested";
  home_lat?: number | null; home_lng?: number | null; child_id?: string; child_name?: string;
}
export type RiderStatus = "waiting" | "boarded" | "dropped";
export interface Rider {
  child_id: string; child_name: string; class_level: number; gender?: string | null;
  parent_id: string; parent_name: string; home_lat?: number | null; home_lng?: number | null;
  colony?: string | null; absent: boolean; status: RiderStatus;
  boarded_at?: string | null; dropped_at?: string | null;
  allergies?: string | null; emergency_phone?: string | null; photo_url?: string | null;
}
export interface Carpool {
  id: string; name: string; creator_id: string; creator_name?: string;
  driver_name?: string | null; driver_phone?: string | null; driver_vehicle?: string | null;
  seats?: number | null; seats_used?: number;
  members: Member[]; joined: Member[]; riders?: Rider[];
  my_status?: string | null; is_creator?: boolean; is_org_household?: boolean;
  active_ride?: Ride | null;
  stats?: CarpoolStats | null;
}

// ---- trips -----------------------------------------------------------------
export type StopStatus = "pending" | "arriving" | "stopped" | "done" | "missed" | "skipped";
export type StopKind = "pickup" | "drop" | "school" | "home_end";
export interface Stop {
  id: string; ride_id: string; child_id?: string | null; seq: number; kind: StopKind;
  lat: number; lng: number; label: string; sub?: string | null;
  status: StopStatus;
  planned_eta_min?: number | null; planned_at?: string | null;
  eta_min?: number | null; eta_at?: string | null;
  arrived_at?: string | null; stopped_at?: string | null; done_at?: string | null;
  dwell_s?: number | null; delay_min?: number | null;
  parent_id?: string | null; child_name?: string | null;
}
export type RideEventType =
  | "started" | "ended" | "arriving" | "stopped" | "boarded" | "unboarded"
  | "reached_school" | "reached_home" | "missed_pickup" | "route_alert"
  | "anomaly_long_stop" | "anomaly_speed" | "note";
export interface RideEvent { id: string; type: RideEventType | string; note?: string | null; child_id?: string | null; child_name?: string | null; created_at: string; }
export interface Ping { lat: number; lng: number; speed_kmh?: number | null; heading?: number | null; eta_min?: number | null; distance_km?: number | null; created_at: string; }
export interface Ride {
  id: string; carpool_id: string; carpool?: Carpool;
  driver_user_id?: string | null; driver_name?: string | null; driver_phone?: string | null; driver_vehicle?: string | null;
  order?: string[]; direction?: Direction | null;
  origin_lat?: number | null; origin_lng?: number | null;
  status: "active" | "completed" | "cancelled" | string;
  started_at?: string | null; ended_at?: string | null;
  last_lat?: number | null; last_lng?: number | null; last_heading?: number | null; last_update?: string | null;
  events?: RideEvent[]; stops?: Stop[];
  school?: School;
  planned_duration_min?: number | null; actual_duration_min?: number | null; on_time?: boolean | null; distance_km?: number | null;
}
export interface LocationResult {
  ride_id: string; lat: number; lng: number; eta_min: number | null; distance_km: number | null;
  stops: Stop[]; ended: boolean; anomalies: string[];
}
export interface TripDriver {
  id: string; name: string; kind: "parent" | "driver";
  phone?: string | null; vehicle?: string | null; owner_name?: string | null; confirmed: boolean;
}
export interface TripSummary {
  id: string; carpool_id: string; carpool_name: string; direction?: Direction | null;
  driver_name?: string | null; started_at?: string | null; ended_at?: string | null;
  on_time?: boolean | null; duration_min?: number | null; distance_km?: number | null;
  missed_count?: number; stops_done?: number; stops_total?: number;
  events: RideEvent[];
}
export interface TripReplay { ride: Ride; stops: Stop[]; pings: Ping[]; events: RideEvent[]; }
export interface CarpoolStats {
  trips: number; on_time_pct: number | null; avg_pickup_delay_min: number | null;
  missed_rate: number | null; avg_duration_min: number | null;
  trend: { date: string; on_time: boolean | null; duration_min: number | null; delay_min: number | null }[];
}

// ---- misc ------------------------------------------------------------------
export interface ChatMessage { id: string; carpool_id: string; sender_id: string; sender_name: string; body: string; created_at: string; }
export interface Notification { id: string; title: string; body?: string | null; kind: string; read: boolean; created_at: string; }
export interface School { name: string; lat: number; lng: number; }
export interface Settings {
  school_name: string; school_lat: number; school_lng: number;
  fence_near_m: number; fence_stop_m: number; fence_leave_m: number; fence_miss_m: number;
  dwell_s: number; stationary_m: number; school_gate_m: number; offroute_km: number;
  long_stop_s: number; speed_max_kmh: number; school_start_time: string; school_end_time: string;
  city_speed_kmh: number; road_factor: number;
}
export interface Filters { class_min?: string; class_max?: string; gender?: string; pincode?: string; radius_km?: string; }
export interface Broadcast { id: string; title: string; body: string; created_at: string; }
export interface AttendanceRow { child_name: string; parent_name: string; carpool: string; reached_at: string; }
export interface Incident { id: string; ride_id: string; carpool: string; type: string; note?: string | null; created_at: string; }
export interface AdminStats { pending: number; approved: number; rejected: number; carpools: number; live: number; addons: number; academic_year: number; school: School; }
export interface AdminAnalytics extends CarpoolStats {
  approved: number; matched: number; unmatched: number; completed_trips: number;
  per_carpool: { id: string; name: string; stats: CarpoolStats }[];
}
export interface PushSubscriptionJSON { endpoint: string; keys: { p256dh: string; auth: string }; }
export interface RegisterData {
  name: string; phone?: string; address?: string; colony?: string; pincode?: string;
  child_name?: string; child_class?: number | string; child_gender?: string;
  home_lat?: number; home_lng?: number; can_drive?: boolean; existing_carpool?: boolean;
  accept_tnc: boolean; relation?: string;
}
export type SignInResult = { status: "in"; profile: Profile } | { status: "new"; email: string } | { status: "pending" | "rejected"; profile: Profile };
