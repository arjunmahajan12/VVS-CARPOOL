-- ============================================================================
-- Scenario harness for schema.sql — mirrors the demo logic-tests in SQL.
-- Runs on the 00_authmock harness (auth.uid() reads the app.uid GUC).
-- Asserts the v7 product rules: organiser-only start, organiser-first order,
-- stop-detection boarding, drive-past→missed, parent correction, home-run
-- gate stop + end-at-organiser-home, delete guards, car-less-can't-create,
-- one-family driving, no ratings.
-- v8 additions: persisted ride_stops (kinds/order/planned ETAs), the
-- pending→arriving→stopped→done|missed machine with timestamps, rolling stops,
-- delay_min, correction re-arm, live ETA shrink, long-stop + speeding
-- anomalies, replay, carpool/admin analytics, settings RPCs, push subscriptions.
-- ============================================================================
\set ON_ERROR_STOP on

-- Fixed identities
-- admin a0 · asha a1 (car, Riya cls5) · neha a2 (car, Kabir cls7) · priya a3 (NO car)
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000a0','admin@vvs.test'),
  ('00000000-0000-0000-0000-0000000000a1','asha@vvs.test'),
  ('00000000-0000-0000-0000-0000000000a2','neha@vvs.test'),
  ('00000000-0000-0000-0000-0000000000a3','priya@vvs.test')
on conflict do nothing;

-- School + home coords (same geometry the demo logic-test uses)
--   SCH 28.533246,77.144098 · ashaHome +0.012/+0.010 · nehaHome -0.009/+0.014
-- stop-and-go helper: two pings to arm the stop clock (arriving → stopped),
-- backdate stopped_at past the 8 s dwell, then a drive-away ping ~0.67 km out
-- that clears every fence (→ done).
create or replace function _sg(rid uuid, la double precision, lo double precision) returns void language plpgsql as $$
begin
  perform app_post_location(rid, la, lo);
  perform app_post_location(rid, la, lo);
  update ride_stops set stopped_at = stopped_at - interval '30 seconds'
    where ride_id=rid and status='stopped';
  perform app_post_location(rid, la + 0.006, lo);
end $$;

-- backdate the latest ping of a ride by N seconds (simulates elapsed time)
create or replace function _age_last_ping(rid uuid, secs int) returns void language plpgsql as $$
begin
  update ride_pings set created_at = created_at - make_interval(secs => secs)
    where id = (select max(id) from ride_pings where ride_id=rid);
end $$;

-- stop row helper
create or replace function _stop(rid uuid, kid uuid) returns ride_stops language sql as $$
  select * from ride_stops where ride_id=rid and child_id=kid limit 1
$$;

-- expect a call to raise (returns true if it did)
create or replace function _raises(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

do $$
declare
  SCH_LAT double precision := 28.533246002067454; SCH_LNG double precision := 77.14409813768475;
  aH_LAT double precision; aH_LNG double precision; nH_LAT double precision; nH_LNG double precision;
  cp uuid; ride jsonb; rid uuid; r2 uuid; r3 uuid; r4 uuid; back uuid; live uuid;
  riya uuid; kabir uuid; j jsonb; cands jsonb; hist jsonb; n int; loc jsonb; eta1 int; eta2 int;
  ks ride_stops; ss ride_stops; expected_on_time boolean; stats jsonb; inc jsonb;
begin
  aH_LAT := SCH_LAT + 0.012; aH_LNG := SCH_LNG + 0.010;
  nH_LAT := SCH_LAT - 0.009; nH_LNG := SCH_LNG + 0.014;

  -- ============ registration + admin approval ============
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a0',false);
  insert into profiles(id,role,name,email,status) values ('00000000-0000-0000-0000-0000000000a0','admin','School Admin','admin@vvs.test','approved')
    on conflict (id) do update set role='admin',status='approved';

  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  perform app_register(jsonb_build_object('name','Asha Mehta','home_lat',aH_LAT,'home_lng',aH_LNG,'can_drive',true,'accept_tnc',true,'child_name','Riya Mehta','child_class',5));
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  perform app_register(jsonb_build_object('name','Neha Gupta','home_lat',nH_LAT,'home_lng',nH_LNG,'can_drive',true,'accept_tnc',true,'child_name','Kabir Gupta','child_class',7));
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a3',false);
  perform app_register(jsonb_build_object('name','Priya Rao','home_lat',SCH_LAT+0.02,'home_lng',SCH_LNG+0.02,'can_drive',false,'accept_tnc',true,'child_name','Ishaan Rao','child_class',6));

  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a0',false);
  perform _assert(jsonb_array_length(app_admin_registrations('pending')) = 3, 'admin sees 3 pending registrations');
  perform app_admin_decision('00000000-0000-0000-0000-0000000000a1','approved');
  perform app_admin_decision('00000000-0000-0000-0000-0000000000a2','approved');
  perform app_admin_decision('00000000-0000-0000-0000-0000000000a3','approved');
  perform _assert((select status from profiles where id='00000000-0000-0000-0000-0000000000a1')='approved','Asha approved');

  -- ============ v8 settings: defaults readable by anyone signed in ============
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  j := app_get_settings();
  perform _assert((j->>'fence_near_m')::int=400 and (j->>'fence_stop_m')::int=150 and (j->>'fence_leave_m')::int=300 and (j->>'fence_miss_m')::int=600
    and (j->>'dwell_s')::int=8 and (j->>'stationary_m')::int=30 and (j->>'school_gate_m')::int=300 and (j->>'offroute_km')::numeric=2.0
    and (j->>'long_stop_s')::int=300 and (j->>'speed_max_kmh')::int=80 and j->>'school_start_time'='07:50' and j->>'school_end_time'='14:10'
    and (j->>'city_speed_kmh')::int=22 and (j->>'road_factor')::numeric=1.3 and j->>'school_name' is not null, 'settings expose every geofence/anomaly/bell-time default');

  -- ============ discovery: ranked from MY home, radius, carpool pins ============
  j := app_search_parents('{}'::jsonb);
  perform _assert(jsonb_array_length(j->'parents') = 2, 'discovery returns the 2 other families');
  perform _assert((j->'parents'->0->>'distance_km') is not null, 'home-to-home distance computed (ranking key)');
  perform _assert(jsonb_array_length(app_search_parents('{"class_min":"7","class_max":"7"}'::jsonb)->'parents') = 1, 'class filter → one family');
  perform _assert((select bool_and((e->>'distance_km')::numeric <= 3) from jsonb_array_elements(app_search_parents('{"radius_km":"3"}'::jsonb)->'parents') e), '3 km radius filter works');

  -- ============ create carpool + invite + accept ============
  cp := (app_create_carpool(jsonb_build_object('name','Asha Pool','seats',4)))->>'id';
  perform _assert(cp is not null, 'car-owner creates a carpool');
  j := app_create_carpool(jsonb_build_object('name','Asha Pool 2','invite_ids',jsonb_build_array('00000000-0000-0000-0000-0000000000a2')));
  perform _assert(not (j ? 'pickup_time') and not (j ? 'days'), 'carpools carry no schedule fields (SPEC 1.9)');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  -- accept the invite into the SECOND pool, then use it as the working carpool
  perform app_respond_invite((j->>'id')::uuid, true);
  cp := (j->>'id')::uuid;
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  j := app_get_carpool(cp);
  perform _assert(jsonb_array_length(j->'riders') = 2, 'carpool has 2 riders once Neha joins');
  perform _assert((j->'stats'->>'trips')::int = 0 and (j->>'is_org_household')::boolean, 'carpool detail carries stats + organiser-household flag');
  select (e->>'child_id')::uuid into riya from jsonb_array_elements(j->'riders') e where e->>'child_name'='Riya Mehta';
  select (e->>'child_id')::uuid into kabir from jsonb_array_elements(j->'riders') e where e->>'child_name'='Kabir Gupta';

  -- ============ start trip: organiser anchors route, NOBODY auto-boarded ============
  ride := app_start_ride(cp, null, null, 'to_school', aH_LAT, aH_LNG);
  rid := (ride->>'id')::uuid;
  perform _assert(ride->>'status'='active', 'ride started');
  perform _assert(ride->>'direction'='to_school' and (ride->>'origin_lat') is not null, 'trip stores its own direction + origin');
  perform _assert((ride->'order'->>0)::uuid = riya, 'organiser child is the FIRST routed stop');
  perform _assert(jsonb_array_length(ride->'order') = 2, 'route covers all travelling children');
  perform _assert(_rider_status(cp, riya)='waiting', 'nobody is auto-boarded at start');
  -- v8: persisted stops in the right order with planned ETAs
  perform _assert(jsonb_array_length(ride->'stops') = 3
    and ride->'stops'->0->>'kind'='pickup' and (ride->'stops'->0->>'child_id')::uuid = riya
    and ride->'stops'->1->>'kind'='pickup' and (ride->'stops'->1->>'child_id')::uuid = kabir
    and ride->'stops'->2->>'kind'='school' and ride->'stops'->2->>'child_id' is null, 'school run stops: organiser pickup, other pickup, school (in seq)');
  perform _assert((select bool_and(e->>'status'='pending' and (e->>'planned_eta_min') is not null and (e->>'planned_at') is not null and (e->>'eta_min') is not null)
    from jsonb_array_elements(ride->'stops') e), 'every stop starts pending with a planned ETA and a live ETA');
  perform _assert((ride->'stops'->0->>'planned_eta_min')::int < (ride->'stops'->1->>'planned_eta_min')::int
    and (ride->'stops'->1->>'planned_eta_min')::int < (ride->'stops'->2->>'planned_eta_min')::int
    and (ride->>'planned_duration_min')::int = (ride->'stops'->2->>'planned_eta_min')::int, 'planned ETAs are sequential and planned_duration is the final stop ETA');
  perform _assert(ride->'stops'->1->>'child_name'='Kabir Gupta' and (ride->'stops'->1->>'parent_id')::uuid='00000000-0000-0000-0000-0000000000a2', 'stop rows carry child_name + parent_id');
  perform _assert(jsonb_array_length(app_get_ride(rid)->'stops') = 3, 'app_get_ride includes stops');

  -- ============ STOP-DETECTION: a genuine pull-over checks a child in ============
  perform app_post_location(rid, aH_LAT, aH_LNG);
  ks := _stop(rid, riya);
  perform _assert(ks.status='arriving' and ks.arrived_at is not null and ks.stopped_at is null, 'first fix inside the near fence → arriving (not yet stopped)');
  perform _assert(exists(select 1 from ride_events where ride_id=rid and type='arriving' and child_id=riya)
    and exists(select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000a1' and title like 'Driver arriving%'), 'arriving raises an event and tells the parent');
  loc := app_post_location(rid, aH_LAT, aH_LNG);
  ks := _stop(rid, riya);
  perform _assert(ks.status='stopped' and ks.stopped_at is not null, 'stationary inside the stop fence → stopped (stopped_at set)');
  perform _assert(loc ? 'stops' and jsonb_array_length(loc->'stops') = 3 and (loc->>'ended')::boolean = false and jsonb_typeof(loc->'anomalies')='array', 'post_location returns the LocationResult shape');
  perform _assert(_rider_status(cp, riya)='waiting', 'stopped alone does not board — the car must drive away');
  update ride_stops set stopped_at = stopped_at - interval '30 seconds' where ride_id=rid and status='stopped';
  perform app_post_location(rid, aH_LAT + 0.006, aH_LNG);
  perform _assert(_rider_status(cp, riya)='boarded', 'stop-and-go at the home checks the child in');
  ks := _stop(rid, riya);
  perform _assert(ks.status='done' and ks.done_at is not null and ks.dwell_s >= 8 and ks.delay_min is not null, 'done stop has done_at, dwell_s ≥ dwell and delay_min');
  perform _assert(not exists(select 1 from ride_stops where ride_id=rid and child_id=riya and status='missed'), 'a clean stop never raises a missed-pickup');
  -- v8: live ETA shrinks as the car approaches the next stop
  eta1 := (_stop(rid, kabir)).eta_min;
  loc := app_post_location(rid, (aH_LAT + nH_LAT)/2, (aH_LNG + nH_LNG)/2);
  eta2 := (_stop(rid, kabir)).eta_min;
  perform _assert(eta1 is not null and eta2 is not null and eta2 < eta1, 'live eta_min shrinks as the car approaches (' || eta1 || ' → ' || eta2 || ')');
  perform _assert((loc->>'eta_min')::int >= eta2, 'result eta_min is the ETA of the final stop (≥ next stop)');
  perform _sg(rid, nH_LAT, nH_LNG);
  perform _assert(_rider_status(cp, kabir)='boarded', 'second stop checks the other child in');
  perform app_post_location(rid, SCH_LAT, SCH_LNG);
  perform _assert(jsonb_array_length(app_active_rides()) = 0, 'trip auto-ended when everyone reached school');
  perform _assert((select bool_and(status='done') from ride_stops where ride_id=rid), 'all three stops are done at the end of the school run');
  expected_on_time := ((clock_timestamp() at time zone 'Asia/Kolkata')::time <= (select school_start_time from settings where id=1));
  perform _assert((select on_time from rides where id=rid) = expected_on_time
    and (select actual_duration_min from rides where id=rid) is not null and (select distance_km from rides where id=rid) > 0, 'school run records on_time (gate time ≤ bell), duration and distance');
  hist := app_trip_history();
  perform _assert(jsonb_array_length(hist) >= 1
    and exists(select 1 from jsonb_array_elements(hist->0->'events') e where (e->>'note') like '%auto%'), 'trip history shows the audit trail');
  perform _assert(hist->0 ? 'on_time' and (hist->0->>'stops_done')::int = 3 and (hist->0->>'stops_total')::int = 3 and (hist->0->>'missed_count')::int = 0
    and hist->0 ? 'duration_min' and hist->0 ? 'distance_km', 'history rows carry on_time / duration / distance / stop counts');

  -- ============ SOS removed; drive-past → missed; parent correction ============
  ride := app_start_ride(cp, '00000000-0000-0000-0000-0000000000a1', null, 'to_school', aH_LAT, aH_LNG);
  r2 := (ride->>'id')::uuid;
  perform _assert(_raises(format('select app_ride_event(%L,%L,%L)', r2, 'sos', 'x')), 'SOS events are rejected (feature removed)');
  -- sweep close to Kabir then away without stopping
  perform app_post_location(r2, nH_LAT + 0.003, nH_LNG);
  perform _assert((_stop(r2, kabir)).status='arriving', 'came within the near fence → arriving');
  perform app_post_location(r2, nH_LAT + 0.008, nH_LNG);
  perform _assert(_rider_status(cp, kabir)='waiting', 'driving past never boards a child');
  perform _assert(exists(select 1 from ride_stops where ride_id=r2 and child_id=kabir and status='missed'), 'a drive-past raises the missed-pickup flag');
  perform _assert(exists(select 1 from ride_events where ride_id=r2 and type='missed_pickup' and child_id=kabir), 'missed stop logs a missed_pickup event');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  perform _assert(exists(select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000a2' and title like 'Missed pickup%'), 'parent got a loud missed-pickup alert');
  perform _assert(exists(select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000a1' and title like 'Missed a pickup%'), 'driver got the missed-pickup alert too');
  -- wrong manual check-in, then parent reverts it
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  perform app_ride_board(r2, kabir, null);
  perform _assert(_rider_status(cp, kabir)='boarded', 'manual board sets boarded');
  perform _assert((_stop(r2, kabir)).status='done', 'manual board completes the stop');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  perform app_ride_unboard(r2, kabir);
  perform _assert(_rider_status(cp, kabir)='waiting', 'parent correction reverts the check-in');
  ks := _stop(r2, kabir);
  perform _assert(ks.status='pending' and ks.done_at is null and ks.stopped_at is null and ks.delay_min is null, 'correction re-arms the stop (back to pending)');
  -- a later genuine stop boards the child
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  perform _sg(r2, nH_LAT, nH_LNG);
  perform _assert(_rider_status(cp, kabir)='boarded' and (_stop(r2, kabir)).status='done', 'after a correction a genuine stop boards the child again');
  perform app_end_ride(r2);

  -- ============ v8: rolling stop (leaves before dwell) never boards ============
  ride := app_start_ride(cp, '00000000-0000-0000-0000-0000000000a1', null, 'to_school', aH_LAT, aH_LNG);
  r3 := (ride->>'id')::uuid;
  perform app_post_location(r3, nH_LAT, nH_LNG);
  perform app_post_location(r3, nH_LAT, nH_LNG);
  perform _assert((_stop(r3, kabir)).status='stopped', 'rolling-stop test: car is stopped at the home');
  perform app_post_location(r3, nH_LAT + 0.004, nH_LNG);   -- 0.44 km: past the leave fence, inside the miss fence
  ks := _stop(r3, kabir);
  perform _assert(ks.status='arriving' and ks.stopped_at is null and _rider_status(cp, kabir)='waiting', 'leaving before dwell_s is a rolling stop → back to arriving, not boarded');
  perform app_post_location(r3, nH_LAT, nH_LNG);
  perform _assert((_stop(r3, kabir)).status='arriving', 'returning while moving keeps arriving');
  perform app_post_location(r3, nH_LAT, nH_LNG);
  perform _assert((_stop(r3, kabir)).status='stopped', 'stationary again → stopped again');
  update ride_stops set stopped_at = stopped_at - interval '30 seconds' where ride_id=r3 and status='stopped';
  perform app_post_location(r3, nH_LAT + 0.006, nH_LNG);
  ks := _stop(r3, kabir);
  perform _assert(ks.status='done' and _rider_status(cp, kabir)='boarded' and ks.dwell_s >= 8, 'a proper stop after the rolling one boards the child');
  perform app_end_ride(r3);

  -- ============ home run: stop at gate boards all; ends at organiser home ============
  ride := app_start_ride(cp, '00000000-0000-0000-0000-0000000000a1', null, 'from_school');
  back := (ride->>'id')::uuid;
  perform _assert(ride->>'direction'='from_school', 'explicit home run stored');
  perform _assert(jsonb_array_length(ride->'stops') = 3 and ride->'stops'->0->>'kind'='school'
    and ride->'stops'->1->>'kind'='drop' and (ride->'stops'->1->>'child_id')::uuid = kabir
    and ride->'stops'->2->>'kind'='home_end' and (ride->'stops'->2->>'parent_id')::uuid='00000000-0000-0000-0000-0000000000a1', 'home run stops: school, drop, home_end at the organiser');
  perform app_post_location(back, SCH_LAT + 0.006, SCH_LNG);  -- moving near school, not stopped
  perform _assert(_rider_status(cp, riya)='waiting' and _rider_status(cp, kabir)='waiting', 'no boarding without a genuine stop at the gate');
  perform _sg(back, SCH_LAT, SCH_LNG);
  perform _assert(_rider_status(cp, riya)='boarded' and _rider_status(cp, kabir)='boarded', 'stopping at the gate then leaving boards everyone');
  perform _assert((select status from ride_stops where ride_id=back and kind='school')='done', 'gate stop is done after the qualifying stop');
  perform _sg(back, nH_LAT, nH_LNG);
  perform _assert(_rider_status(cp, kabir)='dropped', 'auto drop-off at the child home');
  ks := _stop(back, kabir);
  perform _assert(ks.status='done' and ks.delay_min is not null, 'drop stop done with delay_min');
  perform app_post_location(back, aH_LAT, aH_LNG);  -- organiser home → own kid dropped + end
  perform _assert(jsonb_array_length(app_active_rides()) = 0, 'return trip auto-ended at the organiser home');
  perform _assert((select status from ride_stops where ride_id=back and kind='home_end')='done' and (select on_time from rides where id=back) is null, 'home_end done; home runs have no on_time');

  -- ============ v8: anomalies — long stop away from stops, speeding; not at a pickup ============
  ride := app_start_ride(cp, '00000000-0000-0000-0000-0000000000a1', null, 'to_school', aH_LAT, aH_LNG);
  r4 := (ride->>'id')::uuid;
  perform app_post_location(r4, aH_LAT + 0.010, aH_LNG);           -- 1.1 km north of any stop
  perform _age_last_ping(r4, 400);                                   -- been here 400 s (> long_stop_s 300)
  loc := app_post_location(r4, aH_LAT + 0.010, aH_LNG);
  perform _assert((select count(*) from ride_events where ride_id=r4 and type='anomaly_long_stop') = 1
    and loc->'anomalies' ? 'long_stop', 'stationary ≥ long_stop_s away from stops → anomaly_long_stop');
  perform _assert(exists(select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000a2' and title like 'Long stop%'), 'long stop alerts the carpool audience');
  perform app_post_location(r4, aH_LAT + 0.010, aH_LNG);
  perform _assert((select count(*) from ride_events where ride_id=r4 and type='anomaly_long_stop') = 1, 'long stop fires once per stationary episode');
  perform _age_last_ping(r4, 30);
  loc := app_post_location(r4, aH_LAT + 0.010, aH_LNG + 0.012);    -- ~1.2 km in 30 s ≈ 140 km/h
  perform _assert(exists(select 1 from ride_events where ride_id=r4 and type='anomaly_speed') and loc->'anomalies' ? 'speed', 'implausible jump → anomaly_speed');
  perform _assert((select speed_kmh from ride_pings where ride_id=r4 order by id desc limit 1) > 80, 'ping stores the computed speed when none was posted');
  loc := app_post_location(r4, nH_LAT, nH_LNG, 12.5, 270);
  perform _assert((select speed_kmh from ride_pings where ride_id=r4 order by id desc limit 1) = 12.5
    and (select last_heading from rides where id=r4) = 270, 'posted speed/heading are stored');
  perform _age_last_ping(r4, 400);
  perform app_post_location(r4, nH_LAT, nH_LNG);                     -- 400 s stationary AT the pickup
  perform _assert((select count(*) from ride_events where ride_id=r4 and type='anomaly_long_stop') = 1, 'a long wait at a pickup is NOT a long-stop anomaly');
  perform _assert((_stop(r4, kabir)).status='stopped', 'the wait at the pickup armed the stop instead');
  perform app_end_ride(r4);

  -- ============ v8: replay + analytics ============
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  j := app_trip_replay(rid);
  perform _assert(j->'ride'->>'id' = rid::text and jsonb_array_length(j->'pings') >= 5 and jsonb_array_length(j->'stops') = 3
    and jsonb_array_length(j->'events') >= 5 and (j->'pings'->0) ? 'speed_kmh' and (j->'pings'->0) ? 'heading', 'replay returns ride + pings (speed/heading) + stops + events');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a3',false);
  perform _assert(_raises(format('select app_trip_replay(%L)', rid)), 'a non-member cannot replay the trip');
  perform _assert(_raises(format('select app_carpool_stats(%L)', cp)), 'a non-member cannot read carpool stats');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  stats := app_carpool_stats(cp);
  perform _assert((stats->>'trips')::int = 5 and (stats->>'on_time_pct')::numeric in (0,100) and (stats->>'avg_pickup_delay_min') is not null
    and (stats->>'missed_rate')::numeric >= 0 and (stats->>'avg_duration_min') is not null
    and jsonb_array_length(stats->'trend') = 5 and (stats->'trend'->0) ? 'date' and (stats->'trend'->0) ? 'on_time', 'carpool stats: trips, on_time_pct, avg delay, missed rate, duration, trend');
  perform _assert((select (e->>'date') from jsonb_array_elements(stats->'trend') e limit 1) <= (select (e->>'date') from jsonb_array_elements(stats->'trend') e offset 4 limit 1), 'trend runs oldest → newest');

  -- ============ one carpool = one driving family ============
  cands := app_trip_drivers(cp);
  perform _assert(exists(select 1 from jsonb_array_elements(cands) e where (e->>'id')::uuid='00000000-0000-0000-0000-0000000000a1')
              and not exists(select 1 from jsonb_array_elements(cands) e where e->>'name'='Neha Gupta'), 'only the organiser household are drivers');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  perform _assert(_raises(format('select app_start_ride(%L,%L,null,%L)', cp, '00000000-0000-0000-0000-0000000000a2','to_school')), 'a member cannot start the organiser trips');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a3',false);
  perform _assert((app_get_profile()->>'can_drive')='false', 'Priya has no car');
  perform _assert(_raises('select app_create_carpool(''{"name":"X"}''::jsonb)'), 'a car-less parent cannot create a carpool');

  -- ============ delete guards: organiser only, never while live ============
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  perform _assert(_raises(format('select app_delete_carpool(%L)', cp)), 'a non-organiser cannot delete a carpool');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  ride := app_start_ride(cp, '00000000-0000-0000-0000-0000000000a1', null, 'to_school', aH_LAT, aH_LNG);
  live := (ride->>'id')::uuid;
  perform _assert(_raises(format('select app_delete_carpool(%L)', cp)), 'cannot delete a carpool with a live trip');
  perform app_end_ride(live);
  perform _assert(_raises(format('select app_ride_board(%L,%L)', live, riya)), 'boarding on an ended trip is rejected');
  perform _assert(_raises(format('select app_post_location(%L,%s,%s)', live, aH_LAT, aH_LNG)), 'location on an ended trip is rejected');

  -- ============ v8: push subscriptions (private per user) ============
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  perform _assert(app_push_public_key() is null, 'no VAPID key until the admin sets one');
  perform app_save_push_subscription('{"endpoint":"https://push.example/abc","keys":{"p256dh":"P256","auth":"AUTH"}}'::jsonb, 'Chrome/128');
  perform app_save_push_subscription('{"endpoint":"https://push.example/abc","keys":{"p256dh":"P256b","auth":"AUTH"}}'::jsonb, 'Chrome/129');
  perform _assert((select count(*) from push_subscriptions where user_id='00000000-0000-0000-0000-0000000000a2') = 1
    and (select p256dh from push_subscriptions where endpoint='https://push.example/abc')='P256b', 'push subscription upserts by endpoint');
  perform _assert((app_get_profile()->>'push_enabled')::boolean, 'profile reports push_enabled');
  perform _assert(_raises('select app_save_push_subscription(''{"endpoint":"x"}''::jsonb)'), 'malformed subscriptions are rejected');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a1',false);
  perform app_remove_push_subscription('https://push.example/abc');
  perform _assert((select count(*) from push_subscriptions) = 1, 'another user cannot remove my subscription');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a2',false);
  perform app_remove_push_subscription('https://push.example/abc');
  perform _assert((select count(*) from push_subscriptions) = 0 and not (app_get_profile()->>'push_enabled')::boolean, 'push subscription save/remove round-trip');

  -- ============ ratings gone; admin surfaces ============
  perform _assert(not exists(select 1 from pg_proc where proname='app_rate_trip'), 'rating flow removed entirely');
  perform _assert(not exists(select 1 from pg_tables where tablename='ride_geo_alerts'), 'ride_geo_alerts retired');
  perform _assert(_raises('select app_set_settings(''{"dwell_s":10}''::jsonb)'), 'a non-admin cannot change settings');
  perform set_config('app.uid','00000000-0000-0000-0000-0000000000a0',false);
  inc := app_admin_incidents();
  perform _assert(jsonb_typeof(inc) = 'array', 'incident log returns array');
  perform _assert(exists(select 1 from jsonb_array_elements(inc) e where e->>'type'='anomaly_long_stop')
    and exists(select 1 from jsonb_array_elements(inc) e where e->>'type'='anomaly_speed')
    and exists(select 1 from jsonb_array_elements(inc) e where e->>'type'='missed_pickup')
    and (inc->0) ? 'ride_id' and (inc->0) ? 'carpool' and (inc->0) ? 'note', 'incidents list anomalies + missed pickups in the Incident shape');
  j := app_admin_analytics();
  perform _assert((j->>'approved') is not null, 'analytics coverage');
  perform _assert((j->>'approved')::int = 3 and (j->>'matched')::int = 2 and (j->>'unmatched')::int = 1 and (j->>'completed_trips')::int = 6
    and (j->>'on_time_pct') is not null and j ? 'avg_pickup_delay_min' and j ? 'missed_rate' and j ? 'avg_duration_min'
    and jsonb_array_length(j->'per_carpool') = 2 and (j->'per_carpool'->0->'stats') ? 'trips', 'admin analytics: funnel + school-wide stats + per-carpool table');
  -- settings: validated writes, read-back, VAPID key
  j := app_set_settings('{"dwell_s":10,"speed_max_kmh":60,"school_start_time":"08:00","vapid_public_key":"BPUBLICKEY"}'::jsonb);
  perform _assert((j->>'dwell_s')::int = 10 and (j->>'speed_max_kmh')::int = 60 and j->>'school_start_time'='08:00', 'admin updates settings and reads them back');
  perform _assert(app_push_public_key() = 'BPUBLICKEY', 'VAPID public key is served to clients');
  perform _assert(_raises('select app_set_settings(''{"dwell_s":0}''::jsonb)'), 'settings ranges are validated');
  perform _assert(_raises('select app_set_settings(''{"fence_stop_m":700}''::jsonb)'), 'fence ordering is validated (stop < leave ≤ miss)');
  perform _assert(_raises('select app_set_settings(''{"school_start_time":"late"}''::jsonb)'), 'bell times must parse');
  perform app_set_settings('{"dwell_s":8,"speed_max_kmh":80,"school_start_time":"07:50"}'::jsonb);
  perform _assert((app_get_settings()->>'dwell_s')::int = 8, 'settings restored');

  raise notice 'SCENARIO: all assertions passed';
end $$;
