# VVS Carpool — v8 Product & Architecture Spec

This is the single source of truth for the v8 ground-up rebuild. Every builder
(backend, map engine, design system, screens) works from this file. The old code
is reference only — nothing in it is sacred except the **product rules** below.

---

## 1. Product rules (agreed, do not change)

These were decided with the school and are the spec, not implementation detail.

1. **Direction is the clock.** A trip started before **11:00 IST** is a *school run*
   (`to_school`); from 11:00 it is a *home run* (`from_school`). Never guessed
   from GPS, never asked.
2. **Route.** School run: driver's live position → **organiser's home first** →
   the other homes in optimal road order → school. Home run: school → drop
   points optimally, **ending at the organiser's home**.
3. **One carpool = one driving family.** Only the organiser's household (the
   creating parent or their confirmed family driver) drives that carpool's trips.
   Another car-owning family creates its own carpool. **Only a parent with a car
   (`can_drive`) can create a carpool.** Car-less families join existing ones.
4. **Seamless boarding by stop-detection.** A child is checked in **only** when the
   car genuinely stops (near-stationary GPS inside the stop fence for ≥ dwell)
   and then drives away. Driving past never counts.
5. **Missed stop is loud.** Leaving a pickup area without a qualifying stop raises a
   "Missed pickup?" alert to the parent **and** the driver; child stays not-on-board.
6. **Parent correction.** A "Didn't board?" tap reverts a wrong check-in, alerts the
   carpool, and re-arms detection for that child.
7. **Auto-end.** The trip closes itself once every travelling child is accounted for
   (dropped, or flagged missed). Home runs end when the car reaches the organiser's
   home. Any trip still open after midnight IST is auto-closed on next touch.
8. **Removed for good:** manual driver "confirm boarding", ratings, SOS.
9. Carpools have **no time/days fields** — trips are ad-hoc, direction by clock.

## 2. v8 modules (all built for real)

| Module | What "real" means |
|---|---|
| **Stop progress + per-stop ETA** | Every trip has persisted `ride_stops` with a state machine (`pending → arriving → stopped → done` / `missed` / `skipped`), arrival + stop + dwell timestamps, a *planned* ETA fixed at start and a *live* ETA recomputed on every ping. Parents see "reaches you in ~6 min". |
| **Trip replay + punctuality analytics** | Full ping trail stored (with speed/heading) and replayable with a scrubber. Per-carpool + school-wide stats: on-time %, avg pickup delay, missed-stop rate, avg duration, trend. |
| **Web push** | Real device push (service worker + VAPID) for arriving / boarded / missed / trip started / correction. Supabase Edge Function fires on `notifications` insert via DB webhook. In-app inbox stays as the fallback. |
| **Configurable geofences + anomaly rules** | School-level settings for every fence radius, dwell, off-route threshold, long-stop and speeding thresholds, school bell times. Long-stop and speeding anomalies feed the incident log and alert the carpool. |
| **Full-bleed map + bottom sheet** | Discover, Carpool detail and Live trip are map-first: edge-to-edge Mappls with a draggable sheet (snap points). Rich layers (see §5). Leaflet parity for keyless demo. |
| **Complete UI rebuild** | New design system (§6). Every screen rebuilt (§7). Skeletons, empty states, error states everywhere. No placeholders. |

## 3. Data model (Supabase Postgres) — additions to the v7 tables

```
settings (id=1) +
  fence_near_m int 400      -- "arriving" alert
  fence_stop_m int 150      -- must be inside this AND stationary to arm the stop clock
  fence_leave_m int 300     -- leaving past this after a qualifying stop = done
  fence_miss_m int 600      -- leaving past this without a stop = missed
  dwell_s int 8             -- min stationary seconds for a qualifying stop
  stationary_m int 30       -- ping-to-ping movement under this = stationary
  school_gate_m int 300     -- school arrival fence
  offroute_km numeric 2.0
  long_stop_s int 300       -- stationary this long away from any stop = anomaly
  speed_max_kmh int 80
  school_start_time time '07:50'   -- on-time = arrival at gate ≤ this (school run)
  school_end_time time '14:10'
  city_speed_kmh int 22     -- ETA fallback speed when the car isn't moving
  road_factor numeric 1.3   -- haversine → road distance multiplier for ETAs

ride_stops
  id uuid pk, ride_id fk, child_id fk null (school/organiser-home stops have none),
  seq int, kind text ('pickup'|'drop'|'school'|'home_end'),
  lat, lng, label text,
  status text ('pending'|'arriving'|'stopped'|'done'|'missed'|'skipped'),
  planned_eta_min int, planned_at timestamptz,
  eta_min int, eta_at timestamptz,                  -- live
  arrived_at, stopped_at, done_at timestamptz, dwell_s int,
  delay_min int                                     -- done_at - planned_at, minutes
  unique (ride_id, seq)

ride_pings + speed_kmh numeric, heading numeric
rides + planned_duration_min int, actual_duration_min int, on_time boolean,
        distance_km numeric
ride_events.type adds: 'arriving','stopped','anomaly_long_stop','anomaly_speed'
push_subscriptions (endpoint text pk, user_id fk, p256dh text, auth text, ua text, created_at)
```
`ride_geo_alerts` is retired; all per-stop memory lives in `ride_stops`.
`_rider_status` derives from `ride_stops` + events exactly as before (latest boarded/unboarded wins; done drop = dropped).

### Stop state machine (driven by `app_post_location`)
```
pending  --d < fence_near_m-------------------> arriving   (event 'arriving', notify parent)
arriving --d < fence_stop_m && stationary-----> stopped    (stopped_at = now)
stopped  --d > fence_leave_m && dwell ≥ dwell_s-> done      (board on school run / drop on home run; delay_min)
stopped  --d > fence_leave_m && dwell < dwell_s-> arriving  (a rolling stop; keep watching)
arriving --d > fence_miss_m (no qualifying stop)> missed    (event 'missed_pickup', alerts to parent + driver)
any      --parent correction (unboard)---------> pending    (re-armed)
any      --child absent today------------------> skipped
```
School stop on a home run: same machine keyed on the gate (`kind='school'`);
leaving it after a qualifying stop boards every waiting child.

### Live ETA (every ping) and planned ETA (once at start)
Sequential along remaining stops from the car: `leg_km = haversine × road_factor`;
`speed = recent moving speed (last 5 pings) else city_speed_kmh`;
`eta_i = eta_{i-1} + leg_i/speed + dwell_s/60` (dwell added for every stop before it).
Planned ETA uses the same formula from the origin with `city_speed_kmh`.

### Anomalies
- **Long stop:** stationary ≥ `long_stop_s` and not inside `fence_stop_m` of any stop
  or the gate → `anomaly_long_stop` (once per stop episode), notify audience, incident.
- **Speeding:** ping-to-ping speed > `speed_max_kmh` with interval ≥ 5 s and plausible
  distance → `anomaly_speed` (max once per 5 min), incident.
- Existing off-route (`offroute_km`) stays.

### Punctuality
- `on_time` (school run) = gate arrival time-of-day ≤ `school_start_time`.
- Per-stop `delay_min` = `done_at − planned_at` (can be negative = early).
- Carpool stats: trips, on_time_pct, avg_pickup_delay_min, missed_rate, avg_duration_min,
  last-10 trend. School-wide = same over all carpools + per-carpool table.

## 4. API contract — `src/lib/backend.ts`

A single TypeScript `interface Backend` that **both** `demoBackend` and
`supabaseBackend` `implement`. No `any`. `api.ts` exports `api: Backend`.
The full interface is in the file; the method groups are:

- **auth/profile:** signIn, signUp, signOut, getProfile, register, pendingInvite,
  updateProfile, addChild, updateChild, removeChild, addAddon, removeAddon,
  confirmDriver, acceptTnc, latestTnc, addTrusted, removeTrusted
- **driver:** getDriverProfile, updateDriverProfile, addDriverDoc, removeDriverDoc, myDriverCarpools
- **discovery:** searchParents(filters) → { school, me, parents, carpools }
- **carpools:** myCarpools, getCarpool, createCarpool, respondInvite, requestJoinCarpool,
  respondJoinRequest, setDriver, leaveCarpool, deleteCarpool, tripDrivers, setAbsence
- **trips:** startRide(carpoolId, driverUserId?, order?, direction?, originLat?, originLng?),
  activeRides, getRide (includes `stops`), postLocation(rideId, lat, lng, speed?, heading?)
  → { stops, eta, anomalies }, rideEvent, rideBoard, rideUnboard, rideDrop, endRide,
  tripHistory, tripReplay(rideId) → { ride, stops, pings, events }, carpoolStats(carpoolId)
- **chat/notifications:** getChat, sendChat, notifications, markNotificationsRead,
  savePushSubscription, removePushSubscription, pushPublicKey
- **settings/admin:** getSchool, setSchool, getSettings, setSettings (admin),
  adminRegistrations, adminDecision, adminStats, adminCarpools, adminAnalytics,
  adminIncidents, adminAttendance, adminBroadcast, getBroadcasts, publishTnc,
  adminTncList, promoteYear
- **realtime:** onRideLocation, onRideEvents, onRideStops, onRideEnded,
  onNotifications, onChat — each returns an unsubscribe fn.

## 5. Map contract — `src/components/map/mapTypes.ts` (v2)

```ts
interface MapStop { id: string; seq: number; lat: number; lng: number;
  kind: 'pickup'|'drop'|'school'|'home_end'; status: StopStatus;
  label: string; sub?: string; etaMin?: number|null; isNext?: boolean; }
interface MapPin { id: string; lat: number; lng: number;
  kind: 'school'|'home'|'family'|'carpool'; label: string; sub?: string;
  selected?: boolean; }
interface MapProps {
  center: [number, number]; zoom?: number;
  pins?: MapPin[]; stops?: MapStop[];
  route?: [number, number][];          // planned road geometry
  travelled?: [number, number][];      // portion already driven (drawn muted)
  car?: { lat: number; lng: number; heading?: number|null } | null;
  carEta?: number|null;                 // chip beside the car
  fences?: { lat: number; lng: number; radiusM: number; tone: 'stop'|'near' }[];
  radius?: { lat: number; lng: number; km: number } | null;   // Discover radius ring
  corridor?: [number, number][] | null; // "on your way" highlight
  follow?: boolean; traffic?: boolean; cluster?: boolean;
  onPinTap?(id: string): void; onStopTap?(id: string): void; onMapTap?(lat:number,lng:number): void;
  onReady?(): void; className?: string; padding?: { bottom: number }; // sheet inset
}
```
Rendering rules (both providers): numbered stop badges coloured by status
(pending slate · arriving amber · stopped marigold pulse · done emerald · missed rose ·
skipped dashed); `isNext` gets a callout with the live ETA; fences are soft rings;
route = casing + line, `travelled` muted; car = heading-rotated puck that glides
between pings (rAF, ~900 ms) with the ETA chip; follow = smooth pan; a
**skeleton shimmer** shows until `onReady`, and a load failure shows an explicit
error card with Retry (never a silent fallback). Icons are inline SVG **without
parentheses** (Mappls injects them into CSS `url(...)`). `padding.bottom` keeps
fit-bounds clear of the sheet.

`<BottomSheet snapPoints={[0.18, 0.5, 0.92]} initial={1}>` — drag handle,
momentum, backdrop none (map stays interactive), content scroll inside at top snap.

## 6. Design system

**Direction:** trustworthy, warm, premium — "the school's own safety app", not a
ride-hailing clone. Map-first screens; calm cards elsewhere.

- **Type:** Display **Bricolage Grotesque** (700/800, optical size) · Body/UI **DM Sans**
  (400/500/600/700) with `font-variant-numeric: tabular-nums` on any digit column.
  Google Fonts. Scale: 12 / 13 / 15 / 17 / 20 / 24 / 30 / 38.
- **Color tokens** (Tailwind v4 `@theme`, light in `:root`, dark via `.dark`):
  - `primary` marine blue 50…900, 600 = `#1F4B99`, 700 = `#173B7A` (dark mode 400 = `#7FA6F0`)
  - `accent` marigold 500 = `#F2A900`, 600 = `#D99500` — used **only** for live/ETA/key CTA
  - `ink` 950 `#0B1220` · 900 `#111A2E` · 700 `#334155` · 500 `#64748B` · 300 `#CBD5E1`
  - surfaces: `bg` `#F5F7FB` · `card` `#FFFFFF` · dark `bg` `#0B1220` · `card` `#141D33`
  - semantic: `ok` emerald `#10B981` · `warn` amber `#F59E0B` · `danger` rose `#E11D48` · `info` sky `#0EA5E9`
  - map stop tones map 1:1 to semantic.
- **Radius:** 10 / 14 / 20 / 28. **Shadow:** one soft card shadow, one sheet shadow.
- **Components** (`src/components/ui/`): Button (primary/soft/ghost/danger, sm/md/lg, loading),
  IconButton, Card, Chip, Pill/StatusBadge, Input/Select/Textarea with labels + errors,
  Avatar, ListRow, Skeleton (text/card/map), EmptyState, Toast, ConfirmDialog,
  SegmentedControl, Stat tile, Sparkline, ProgressRail (stop rail), SheetHeader,
  TopBar, TabBar. Focus rings visible; reduced-motion respected.

## 7. Screens (mobile-first, ≤ 430 px; scales up)

| Screen | Key behaviour |
|---|---|
| **Auth** | Sign in / create account; demo quick-logins in demo mode. |
| **Onboarding** | 3 steps: family (name, phone, child), home pin (Mappls autosuggest + tap), car & terms. Add-on invite short-path. |
| **Home** | Live-trip hero card (if a trip is running: map snippet, next stop, ETA, "Open"), today's direction hint, quick actions, my carpools, unread notifications, push permission nudge once. |
| **Discover** | Full-bleed map + sheet. Radius ring, family & carpool pins, tap-pin → card in sheet; list ranked by road distance; filters; multi-select invite → creates carpool; request seat on a carpool. Car-less parents see join-only. |
| **Carpools** | My carpools with live badge, seats, organiser chip, pending invites/requests. |
| **Carpool detail** | Full-bleed route preview map (ordered numbered stops for today's direction) + sheet: members, riders, absences, chat, start trip (organiser household only; auto-picks the single driver), delete (organiser, never while live). |
| **Live trip** | Full-bleed map: car, route + travelled, numbered status stops, fences, next-stop callout. Sheet: **stop rail** (vertical timeline with per-stop ETA/delay), driver mode (GPS share toggle, hands-free copy, end trip) vs parent mode (my child's status, "Didn't board?" correction, call driver). Simulate-trip control in demo mode (with stop pauses). |
| **Trip history** | List with on-time badge, duration, missed count; tap → **Replay**: map scrubber over the ping trail with events + stops. |
| **Notifications** | Inbox grouped by day; kinds coloured. |
| **Profile** | Family (children CRUD, add-ons + driver confirm), car & documents, trusted pickups, push toggle, theme, terms, sign out. |
| **Admin** | Dashboard (stats + punctuality analytics with sparklines), Verify, Carpools (end stuck trip), Incidents (anomalies + missed + off-route), Settings (school pin, **geofence & anomaly rules**, bell times, promote year), Notices + Terms. |

## 8. Realtime
Supabase broadcast primary (`ride:<id>` channel: `loc`, `event`, `stops`, `ended`),
`postgres_changes` backup on `ride_pings`, `ride_events`, `ride_stops`, `rides`,
`notifications`, `chat_messages`. Demo mode: in-memory bus with the same topics.

## 9. Validation gates (all must be green before delivery)
1. `npx tsc -b` clean · 2. `npm run build` · 3. `npm run test` (demo logic tests, extended
for v8) · 4. `bash supabase/_localtest/run.sh` (schema twice + scenario, extended for v8)
· 5. Playwright tour: every screen, light + dark, no console errors, screenshots reviewed.
