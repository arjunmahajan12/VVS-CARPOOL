-- ============================================================================
-- CONTRACT scenario — every RPC that 01_scenario.sql doesn't touch, plus the
-- permission guards. Runs after 01 on the same database (state carries over:
-- admin a0 · asha a1 · neha a2 · priya a3, carpool "Asha Pool 2" with Asha+Neha).
-- ============================================================================
\set ON_ERROR_STOP on

insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000000b1','aunt@vvs.test'),
  ('00000000-0000-0000-0000-0000000000b2','ramesh@vvs.test'),
  ('00000000-0000-0000-0000-0000000000b3','stranger@vvs.test')
on conflict do nothing;

do $$
declare
  a_admin uuid := '00000000-0000-0000-0000-0000000000a0'; a_asha uuid := '00000000-0000-0000-0000-0000000000a1';
  a_neha  uuid := '00000000-0000-0000-0000-0000000000a2'; a_priya uuid := '00000000-0000-0000-0000-0000000000a3';
  a_aunt  uuid := '00000000-0000-0000-0000-0000000000b1'; a_ramesh uuid := '00000000-0000-0000-0000-0000000000b2';
  a_str   uuid := '00000000-0000-0000-0000-0000000000b3';
  cp uuid; j jsonb; kid uuid; tid uuid; v1 int; v2 int; n int; cls int; small uuid; rid uuid;
begin
  select id into cp from carpools where name='Asha Pool 2';
  perform _assert(cp is not null, 'contract: working carpool from 01 exists');

  -- ================= public config =================
  perform set_config('app.uid','',false);
  perform _assert((app_public_config()->>'demo_logins')::boolean = false, 'public config readable pre-login, demo_logins off by default');

  -- ================= profile / family (Asha) =================
  perform set_config('app.uid',a_asha::text,false);
  j := app_update_profile('{"phone":"+91 90000 00001","colony":"B-6 (edited)"}'::jsonb);
  perform _assert(j->>'phone'='+91 90000 00001' and j->>'colony'='B-6 (edited)', 'app_update_profile patches fields');
  j := app_add_child('{"name":"Contract Kid","class_level":3,"gender":"male"}'::jsonb);
  select (e->>'id')::uuid into kid from jsonb_array_elements(j->'children') e where e->>'name'='Contract Kid';
  perform _assert(kid is not null, 'app_add_child');
  j := app_update_child(kid, '{"name":"Contract Kid II","class_level":4}'::jsonb);
  perform _assert(exists(select 1 from jsonb_array_elements(j->'children') e where (e->>'id')::uuid=kid and e->>'name'='Contract Kid II' and (e->>'class_level')::int=4), 'app_update_child updates name + class');
  j := app_remove_child(kid);
  perform _assert(not exists(select 1 from jsonb_array_elements(j->'children') e where (e->>'id')::uuid=kid), 'app_remove_child');
  j := app_add_trusted('{"name":"Trusted Neighbour","phone":"+91 90000 00002"}'::jsonb);
  select (e->>'id')::uuid into tid from jsonb_array_elements(j->'trusted') e where e->>'name'='Trusted Neighbour';
  perform _assert(tid is not null, 'app_add_trusted');
  j := app_remove_trusted(tid);
  perform _assert(not exists(select 1 from jsonb_array_elements(j->'trusted') e where (e->>'id')::uuid=tid), 'app_remove_trusted');
  j := app_add_addon('{"name":"Aunt Test","email":"aunt@vvs.test","relation":"aunt"}'::jsonb);
  perform _assert(exists(select 1 from jsonb_array_elements(j->'addons') e where e->>'email'='aunt@vvs.test' and (e->>'signed_up')::boolean=false), 'app_add_addon creates a pending invite');
  perform app_add_addon('{"name":"Ramesh Kumar","email":"ramesh@vvs.test","relation":"driver"}'::jsonb);

  -- ================= add-on onboarding (aunt) =================
  perform set_config('app.uid',a_aunt::text,false);
  j := app_pending_invite();
  perform _assert(j->>'relation'='aunt' and j->>'parent_name'='Asha Mehta', 'app_pending_invite finds the invite for a not-yet-registered email');
  perform _link_addon();
  perform _assert((select role from profiles where id=a_aunt)='addon' and (select parent_owner_id from profiles where id=a_aunt)=a_asha, '_link_addon creates the linked add-on profile');
  perform _assert(app_pending_invite() is null, 'pending invite is null once registered');
  perform _assert(_raises('select app_create_carpool(''{"name":"X"}''::jsonb)'), 'an add-on cannot create a carpool');
  perform _assert(exists(select 1 from jsonb_array_elements(app_my_carpools()) e where (e->>'id')::uuid=cp), 'add-on sees the family carpool');
  perform _assert(jsonb_array_length(app_get_chat(cp)) >= 0, 'add-on of a joined household can read the chat');

  -- ================= driver add-on (ramesh) =================
  perform set_config('app.uid',a_ramesh::text,false);
  perform _link_addon();
  j := app_get_driver_profile();
  perform _assert(j->>'role'='addon' and j->>'relation'='driver', 'app_get_driver_profile');
  j := app_update_driver_profile('{"vehicle":{"make_model":"Maruti Ertiga","plate":"DL 3C AB 9999","seats":6}}'::jsonb);
  perform _assert(j->'vehicle'->>'plate'='DL 3C AB 9999', 'app_update_driver_profile updates the vehicle');
  perform _assert(exists(select 1 from jsonb_array_elements(app_my_driver_carpools()) e where (e->>'id')::uuid=cp), 'app_my_driver_carpools lists the family carpool');
  perform _assert(not exists(select 1 from jsonb_array_elements(app_trip_drivers(cp)) e where (e->>'id')::uuid=a_ramesh and (e->>'confirmed')::boolean), 'unconfirmed driver is not a confirmed trip driver');
  perform _assert(_raises(format('select app_start_ride(%L,%L,null,%L)', cp, a_ramesh, 'to_school')), 'unconfirmed driver cannot start a trip');

  -- family confirms the driver
  perform set_config('app.uid',a_asha::text,false);
  j := app_confirm_driver(a_ramesh, true, 'DL 3C AB 1234');
  perform _assert((select driver_status from profiles where id=a_ramesh)='verified', 'app_confirm_driver(true)');
  perform _assert(exists(select 1 from jsonb_array_elements(app_trip_drivers(cp)) e where (e->>'id')::uuid=a_ramesh and (e->>'confirmed')::boolean), 'confirmed driver is a trip driver');
  perform set_config('app.uid',a_ramesh::text,false);
  rid := (app_start_ride(cp, a_ramesh, null, 'to_school'))->>'id';
  perform _assert(rid is not null and (app_get_ride(rid)->>'driver_user_id')::uuid=a_ramesh, 'confirmed driver starts the trip as themselves');
  perform app_end_ride(rid);
  perform set_config('app.uid',a_asha::text,false);
  perform app_confirm_driver(a_ramesh, false);
  perform _assert((select driver_status from profiles where id=a_ramesh)='incomplete', 'app_confirm_driver(false)');
  j := app_remove_addon(a_aunt);
  perform _assert(not exists(select 1 from profiles where id=a_aunt) and not exists(select 1 from addon_invites where email='aunt@vvs.test'), 'app_remove_addon removes invite + login');

  -- ================= chat + membership guards =================
  j := app_send_chat(cp, 'contract hello');
  perform _assert(exists(select 1 from jsonb_array_elements(app_get_chat(cp)) e where e->>'body'='contract hello'), 'app_send_chat + app_get_chat');
  perform _assert(_raises(format('select app_send_chat(%L,%L)', cp, '')), 'empty chat message rejected');
  perform set_config('app.uid',a_priya::text,false);  -- Priya is NOT in this carpool
  perform _assert(_raises(format('select app_send_chat(%L,%L)', cp, 'intruder')), 'non-member cannot post in chat');
  perform _assert(_raises(format('select app_get_chat(%L)', cp)), 'non-member cannot read chat');
  perform _assert(_raises(format('select app_get_carpool(%L)', cp)), 'non-member cannot open the carpool');

  -- ================= set_driver / absence =================
  perform set_config('app.uid',a_asha::text,false);
  j := app_set_driver(cp, 'Ramesh Kumar', '+91 98700 12345', 'DL 3C AB 1234');
  perform _assert(j->>'driver_name'='Ramesh Kumar' and j->>'driver_vehicle'='DL 3C AB 1234', 'app_set_driver');
  select (e->>'child_id')::uuid into kid from jsonb_array_elements(app_get_carpool(cp)->'riders') e where e->>'child_name'='Riya Mehta';
  j := app_set_absence(cp, kid, true);
  perform _assert(exists(select 1 from jsonb_array_elements(j->'riders') e where (e->>'child_id')::uuid=kid and (e->>'absent')::boolean), 'app_set_absence(true)');
  rid := (app_start_ride(cp, a_asha, null, 'to_school'))->>'id';
  perform _assert(exists(select 1 from ride_stops s where s.ride_id=rid and s.child_id=kid and s.status='skipped'), 'absent child is a skipped stop on a new trip');
  perform app_end_ride(rid);
  j := app_set_absence(cp, kid, false);
  perform _assert(not exists(select 1 from jsonb_array_elements(j->'riders') e where (e->>'child_id')::uuid=kid and (e->>'absent')::boolean), 'app_set_absence(false)');
  perform set_config('app.uid',a_neha::text,false);
  perform _assert(_raises(format('select app_set_absence(%L,%L,true)', cp, kid)), 'a parent cannot mark another family''s child absent');

  -- ================= seats: full carpool =================
  perform set_config('app.uid',a_asha::text,false);
  small := (app_create_carpool(jsonb_build_object('name','Tiny Pool','seats',2,'invite_ids',jsonb_build_array(a_neha,a_priya))))->>'id';
  perform set_config('app.uid',a_neha::text,false);
  perform app_respond_invite(small, true);
  perform set_config('app.uid',a_priya::text,false);
  perform _assert(_raises(format('select app_respond_invite(%L,true)', small)), 'accepting beyond the seat limit is refused');

  -- ================= join request + approve (Priya → Asha Pool 2) =================
  perform app_request_join(cp);
  perform set_config('app.uid',a_asha::text,false);
  perform _assert(exists(select 1 from jsonb_array_elements(app_get_carpool(cp)->'members') e where (e->>'parent_id')::uuid=a_priya and e->>'status'='requested'), 'organiser sees the seat request');
  j := app_respond_join(cp, a_priya, true);
  perform _assert(exists(select 1 from jsonb_array_elements(j->'members') e where (e->>'parent_id')::uuid=a_priya and e->>'status'='joined'), 'app_respond_join(true)');

  -- ================= leave / hand-over rule =================
  -- Priya (no car) leaves: plain leave
  perform set_config('app.uid',a_priya::text,false);
  perform app_leave_carpool(cp);
  perform _assert((select status from carpool_members where carpool_id=cp and parent_id=a_priya)='left', 'member leaves');
  -- Asha (organiser) leaves: Neha has a car → hand-over
  perform set_config('app.uid',a_asha::text,false);
  perform app_leave_carpool(cp);
  perform _assert((select creator_id from carpools where id=cp)=a_neha, 'organiser leaving hands over to a car-owning member');
  perform _assert(exists(select 1 from notifications where user_id=a_neha and title like 'You now organise%'), 'new organiser is notified');
  -- Neha (now organiser) leaves Tiny Pool where only... she is the only member besides Asha(creator). Test the close path on a fresh pool:
  perform set_config('app.uid',a_neha::text,false);
  rid := (app_create_carpool(jsonb_build_object('name','Close Pool','seats',3,'invite_ids',jsonb_build_array(a_priya))))->>'id';
  perform set_config('app.uid',a_priya::text,false);
  perform app_respond_invite(rid, true);
  perform set_config('app.uid',a_neha::text,false);
  perform app_leave_carpool(rid);
  perform _assert(not exists(select 1 from carpools where id=rid), 'organiser leaving with only car-less members closes the carpool');
  perform _assert(exists(select 1 from notifications where user_id=a_priya and title='Carpool closed'), 'members told the carpool closed');

  -- ================= notifications =================
  perform set_config('app.uid',a_priya::text,false);
  select count(*) into n from jsonb_array_elements(app_notifications()) e where not (e->>'read')::boolean;
  perform _assert(n > 0, 'Priya has unread notifications');
  perform app_mark_notifications_read();
  select count(*) into n from jsonb_array_elements(app_notifications()) e where not (e->>'read')::boolean;
  perform _assert(n = 0, 'app_mark_notifications_read');

  -- ================= pending user is blocked =================
  perform set_config('app.uid',a_str::text,false);
  perform app_register(jsonb_build_object('name','Stranger','home_lat',28.53,'home_lng',77.14,'accept_tnc',true,'child_name','S Kid','child_class',2));
  perform _assert(_raises('select app_create_carpool(''{"name":"Nope"}''::jsonb)'), 'pending family cannot create a carpool');
  perform _assert(_raises(format('select app_request_join(%L)', cp)), 'pending family cannot request a seat');

  -- ================= admin surface =================
  perform set_config('app.uid',a_admin::text,false);
  j := app_admin_stats();
  perform _assert((j->>'pending')::int >= 1 and (j->>'approved')::int >= 3 and (j->'school'->>'name') is not null, 'app_admin_stats');
  j := app_set_school('VVS (moved)', 28.5333, 77.1441);
  perform _assert((app_get_school()->>'name')='VVS (moved)', 'app_set_school + app_get_school');
  perform app_set_school('Vasant Valley School, Vasant Kunj', 28.533246002067454, 77.14409813768475);
  perform _assert(jsonb_typeof(app_admin_attendance())='array', 'app_admin_attendance');
  perform _assert(exists(select 1 from jsonb_array_elements(app_admin_carpools()) e where (e->>'id')::uuid=cp), 'app_admin_carpools');
  perform app_admin_decision(a_str, 'rejected', 'Not on the roll');
  perform _assert((select status from profiles where id=a_str)='rejected', 'app_admin_decision(rejected)');
  perform app_admin_broadcast('Contract notice', 'Body text');
  perform _assert(exists(select 1 from jsonb_array_elements(app_get_broadcasts()) e where e->>'title'='Contract notice'), 'app_admin_broadcast + app_get_broadcasts');
  perform _assert(exists(select 1 from notifications where user_id=a_asha and title='📢 Contract notice' or user_id=a_asha and title like '%Contract notice%'), 'broadcast lands in every family inbox');
  v1 := _latest_tnc();
  j := app_publish_tnc('Contract terms — a full new version of the terms text for testing purposes.');
  v2 := (j->>'version')::int;
  perform _assert(v2 = v1 + 1 and (app_admin_tnc_list()->0->>'version')::int = v2, 'app_publish_tnc + app_admin_tnc_list');
  select class_level into cls from children where parent_id=a_asha limit 1;
  j := app_promote_year();
  perform _assert((select class_level from children where parent_id=a_asha limit 1) = least(cls+1,13), 'app_promote_year moves classes up');

  -- ================= parents need the new terms; admin RPCs refused =================
  perform set_config('app.uid',a_asha::text,false);
  perform _assert((app_get_profile()->>'needs_tnc')::boolean = true, 'parent needs to accept the new terms');
  perform app_accept_tnc();
  perform _assert((app_get_profile()->>'needs_tnc')::boolean = false, 'app_accept_tnc clears the flag');
  perform _assert(_raises('select app_admin_stats()'), 'parent refused app_admin_stats');
  perform _assert(_raises('select app_admin_carpools()'), 'parent refused app_admin_carpools');
  perform _assert(_raises('select app_admin_attendance()'), 'parent refused app_admin_attendance');
  perform _assert(_raises('select app_admin_broadcast(''x'',''y'')'), 'parent refused app_admin_broadcast');
  perform _assert(_raises('select app_publish_tnc(''xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'')'), 'parent refused app_publish_tnc');
  perform _assert(_raises('select app_admin_tnc_list()'), 'parent refused app_admin_tnc_list');
  perform _assert(_raises('select app_set_school(''x'',1,1)'), 'parent refused app_set_school');
  perform _assert(_raises('select app_promote_year()'), 'parent refused app_promote_year');
  perform _assert(_raises(format('select app_admin_decision(%L,''approved'')', a_str)), 'parent refused app_admin_decision');
  perform _assert(jsonb_typeof(app_get_broadcasts())='array', 'parent can read broadcasts');

  -- ================= remaining RPCs: latest_tnc, driver docs (legacy), ride_drop, ride_stops =================
  perform set_config('app.uid',a_asha::text,false);
  perform _assert((app_latest_tnc()->>'version')::int = _latest_tnc(), 'app_latest_tnc returns the current version');
  perform set_config('app.uid',a_ramesh::text,false);
  j := app_add_driver_doc('{"type":"licence","number":"DL-TEST-1","expiry":"2030-01-01"}'::jsonb);
  select (e->>'id')::uuid into tid from jsonb_array_elements(j->'documents') e where e->>'number'='DL-TEST-1';
  perform _assert(tid is not null, 'app_add_driver_doc (legacy API)');
  j := app_remove_driver_doc(tid);
  perform _assert(not exists(select 1 from jsonb_array_elements(j->'documents') e where (e->>'id')::uuid=tid), 'app_remove_driver_doc');
  -- Neha now organises "Asha Pool 2": start a trip, manual drop, stops RPC
  perform set_config('app.uid',a_neha::text,false);
  rid := (app_start_ride(cp, a_neha, null, 'to_school'))->>'id';
  perform _assert(jsonb_array_length(app_ride_stops(rid)) >= 2, 'app_ride_stops returns the stop list');
  select (e->>'child_id')::uuid into kid from jsonb_array_elements(app_get_carpool(cp)->'riders') e where e->>'child_name'='Kabir Gupta';
  perform app_ride_board(rid, kid);
  perform app_ride_drop(rid, kid, 'school');
  perform _assert(_rider_status(cp, kid)='dropped', 'app_ride_drop marks the child dropped');
  perform app_end_ride(rid);
  perform _assert(_raises(format('select app_ride_drop(%L,%L,''school'')', rid, kid)), 'app_ride_drop on an ended trip is rejected');

  raise notice 'CONTRACT: all assertions passed';
end $$;
