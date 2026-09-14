# VVS Carpool

A school carpooling app for **Vasant Valley School, Vasant Kunj, New Delhi** — built for the *BUILD FOR VVS 2026* Challenge 7. Parents find nearby school-verified families, form carpools, and the app tracks each trip **fully hands-free**: children are checked in and dropped off automatically by detecting when the car genuinely stops at a pickup point — no buttons to press while driving.

## How trips work

- **Two routes, chosen explicitly.** Every carpool has a *school run* (`to_school`) and a *home run* (`from_school`); the organiser picks which one to start. Never inferred from the clock or GPS.
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
- **Roles trimmed to what they do** — family add-ons (grandparents, helpers) and family drivers get Home / Carpools / Alerts / Profile only; drivers keep a car profile (no document uploads); only the organising parent or a confirmed family driver can start a trip.
- **Consent** — organisers confirm their commitments when creating a carpool; families confirm data-sharing when accepting an invite or requesting a seat.
- **Hand-over rule** — an organiser can hand a carpool over only to another family *with a car* (one carpool = one driving family); with no such family the carpool closes rather than passing to someone who can't drive it. Never while a trip is live.
- **Terms gate** — when the school publishes new Terms, every parent must accept them before anything else loads.
- **School review (v8.3)** — Vasant Valley crest as the app mark; parent phone numbers visible while forming a carpool; admin can open any carpool to see every family's contact details and children (class, allergies, emergency number); tracking starts automatically on the driver's phone the moment a trip is opened, with the driver's number shown and editable during the trip.

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript + Tailwind CSS v4
- **Backend:** Supabase — Postgres + Auth (email/password) + Realtime + Row-Level Security, with all writes going through `SECURITY DEFINER` RPC functions
- **Maps:** Mappls (MapmyIndia) Web SDK only — `VITE_MAPPLS_KEY` is required for the map to render (the app shows a clear configuration error otherwise). OSRM is used for road routing.

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
npm run test              # 242 assertions: trip model (logic-test.ts) + every API method (contract-test.ts)
npm run test:sql          # 171 SQL assertions on a throwaway Postgres (schema loads twice + 2 scenarios)
npm run test:e2e          # headless browser: 52 multi-role flow checks + 464 screen-matrix checks
```

Coverage is measured, not assumed: all 76 `Backend` methods are asserted against the demo backend and all 71 RPC-backed methods against the real SQL. The screen matrix visits every screen for every role in light + dark at 360 px and 430 px and checks, by code, for horizontal overflow, unnamed buttons, unlabelled inputs and text below 3:1 contrast.

End-to-end flows (multi-role, in a headless browser against `npm run build` + `npx vite preview --port 4177`): `npm run test:e2e` — onboarding → admin approval, invite → consent → accept, seat request → approve, absence, chat, hand-over/leave, delete, family & add-on management, driver confirmation, settings/theme, admin rules validation, notices, terms gate, history → replay.

## Deploying the backend

1. Create a Supabase project. In the SQL editor, run `supabase/schema.sql` top-to-bottom. It is idempotent — safe to re-run.
2. In **Authentication → Providers → Email**, turn **Confirm email** *off* (the app uses email/password directly).
3. Sign up once in the app with your own email, then promote yourself to admin:
   ```sql
   update profiles set role='admin', status='approved' where email='YOUR_EMAIL';
   ```
4. **Optional — demo accounts on the live site:** run `supabase/seed_demo.sql` in the SQL editor. It creates the seeded families (Asha, Vikram, Neha, Priya, the driver, Dadi, the admin…) as real logins with password `demo1234`, and switches on the one-tap "Demo quick login" panel on the sign-in screen. Demo accounts can also run the simulated drive. Re-run to reset them; delete their rows to remove them.
5. Whitelist your origin(s) in the **Mappls** console for `VITE_MAPPLS_KEY` (the site's exact domain, e.g. `vvs-carpool-ch2.pages.dev`).
6. Build with the three keys set, and deploy `dist/` to Cloudflare Pages (or any static host).

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
  screens/    Auth, Onboarding, Home, Discover, Carpools, CarpoolDetail, LiveTrip,
              History, Replay, Chat, Alerts, Profile, Family, Car, Settings, Admin, Shell
  context/    auth provider
  components/ shared UI + the location/map picker
supabase/
  schema.sql          the complete Postgres schema (tables, RPCs, RLS, realtime)
  _localtest/         throwaway-Postgres validation harness
logic-test.ts         162 assertions run against the demo backend
```
