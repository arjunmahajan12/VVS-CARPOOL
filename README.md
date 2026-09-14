# VVS Carpool

A school carpooling app for **Vasant Valley School, Vasant Kunj, New Delhi** — built for the *BUILD FOR VVS 2026* Challenge 7. Parents find nearby school-verified families, form carpools, and the app tracks each trip **fully hands-free**: children are checked in and dropped off automatically by detecting when the car genuinely stops at a pickup point — no buttons to press while driving.

## How trips work (the v7 model)

- **Direction is decided by the clock.** A trip started before 11:00 is a *school run* (`to_school`); from 11:00 on it is a *home run* (`from_school`). No GPS guessing, no prompts.
- **Route.** School run: driver's live position → the **organiser's home first** → the other homes in optimal road order → school. Home run: school first, then drop points optimally, ending at the organiser's home.
- **One carpool = one driving family.** Only the organiser's household (the creating parent, or their confirmed family driver) drives that carpool's trips. A different car-owning family runs *their own* carpool. Only a parent who has a car can create one.
- **Seamless boarding via stop-detection.** A child is checked in only when the car actually **stops** near their pickup point (near-stationary GPS, inside a ~150 m fence, for ≥8 s) and then drives away. Driving past never counts — instead it raises a loud *"Missed pickup?"* alert to both the parent and the driver, and the child stays not-on-board.
- **Parent correction.** A *"Didn't board?"* tap reverts a wrong auto check-in, alerts the carpool, and re-arms the detector.
- **Auto-end.** The trip closes itself once every child is accounted for (home runs end when the car reaches the organiser's home). Trips also auto-close after midnight.

## What's in v8

- **Stop progress + per-stop ETA** — every trip persists a stop state machine (`pending → arriving → stopped → done` / `missed` / `skipped`) with planned vs live ETAs; parents see "reaches you in ~6 min".
- **Trip replay + punctuality analytics** — full ping trail with a scrubber; on-time %, avg pickup delay, missed-stop rate per carpool and school-wide.
- **Web push** — service worker + VAPID Edge Function (`supabase/functions/push`, see its README).
- **Configurable geofences + anomaly rules** — admin sets every fence, dwell, off-route, long-stop and speeding threshold and bell times; anomalies feed the incident log.
- **Full-bleed map + bottom sheet** on Discover, Carpool detail and Live trip; rich layers (numbered status stops, geofence rings, gliding car + ETA chip, clustering).
- **Ground-up UI** — new design system (Bricolage Grotesque + DM Sans, marine blue + marigold), light/dark.

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript + Tailwind CSS v4
- **Backend:** Supabase — Postgres + Auth (email/password) + Realtime + Row-Level Security, with all writes going through `SECURITY DEFINER` RPC functions
- **Maps:** Mappls (MapmyIndia) Web SDK, with a keyless Leaflet + OSRM fallback for demo builds

## Two run modes

The app auto-selects its backend from the environment (`src/lib/api.ts`):

- **Demo mode** — no env vars set. Runs entirely in-memory with seeded families; nothing is persisted. Great for local preview and for the deployed demo.
- **Live mode** — set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. All data flows through the Supabase RPCs in `supabase/schema.sql`.

> Vite inlines `VITE_*` vars at **build time** — you must rebuild after changing `.env`.

## Getting started

```bash
npm install
cp .env.example .env      # optional — leave blank for demo mode
npm run dev               # local dev server
npm run build             # production build to dist/
npm run test              # 162 in-memory logic tests (the demo backend = the spec)
```

## Deploying the backend

1. Create a Supabase project. In the SQL editor, run `supabase/schema.sql` top-to-bottom. It is idempotent — safe to re-run.
2. In **Authentication → Providers → Email**, turn **Confirm email** *off* (the app uses email/password directly).
3. Sign up once in the app with your own email, then promote yourself to admin:
   ```sql
   update profiles set role='admin', status='approved' where email='YOUR_EMAIL';
   ```
4. Whitelist your origin(s) in the **Mappls** console for `VITE_MAPPLS_KEY`.
5. Build with the three keys set, and deploy `dist/` to Cloudflare Pages (or any static host).

## Validating the schema

The SQL semantics are checked against a throwaway Postgres 16 instance:

```bash
bash supabase/_localtest/run.sh
```

This loads `schema.sql` twice (idempotency check) and runs `01_scenario.sql`, which asserts the v7 behaviours — organiser-only start, organiser-first routing, stop-detection boarding, drive-past→missed, parent correction, home-run gate stop + end-at-home, delete guards, car-less-can't-create, and one-family driving — mirroring the 162 in-memory logic tests (103 SQL assertions).

## Layout

```
src/
  lib/        api abstraction, demo + supabase backends, routing, map provider, trip logic
  screens/    Login, Onboarding, ParentHome, Find, Carpools, CarpoolDetail,
              Track, DriverToday, DriverDocs, TripHistory, Profile, Admin, Shell
  context/    auth provider
  components/ shared UI + the location/map picker
supabase/
  schema.sql          the complete Postgres schema (tables, RPCs, RLS, realtime)
  _localtest/         throwaway-Postgres validation harness
logic-test.ts         52 assertions run against the demo backend
```
