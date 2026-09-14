-- ============================================================================
-- DEMO ACCOUNTS for a LIVE Supabase project (run AFTER schema.sql).
-- Creates the same families the in-memory demo uses, with real logins:
--   password for every demo account:  demo1234
--   parents : asha@demo.in (organiser, has a car) · vikram@demo.in (2 kids)
--             neha@demo.in (member of Asha's carpool) · rahul@demo.in
--             priya@demo.in (NO car) · sunita@demo.in (invited) · rohan@demo.in (pending)
--   add-ons : driver@demo.in (Asha's confirmed driver Ramesh) · dadi@demo.in (grandparent)
--             suresh@demo.in (Vikram's driver)
--   admin   : admin@vasantvalley.demo
-- Safe to re-run: it deletes and recreates these accounts only.
-- Requires: Authentication → Providers → Email → "Confirm email" OFF.
-- ============================================================================
create extension if not exists pgcrypto;

do $$
declare
  sch_lat double precision; sch_lng double precision;
  pw text := 'demo1234';
  -- fixed ids so re-runs are idempotent
  u_admin  uuid := 'd0000000-0000-4000-8000-000000000001';
  u_asha   uuid := 'd0000000-0000-4000-8000-000000000011';
  u_vikram uuid := 'd0000000-0000-4000-8000-000000000012';
  u_neha   uuid := 'd0000000-0000-4000-8000-000000000013';
  u_rahul  uuid := 'd0000000-0000-4000-8000-000000000014';
  u_priya  uuid := 'd0000000-0000-4000-8000-000000000015';
  u_sunita uuid := 'd0000000-0000-4000-8000-000000000016';
  u_rohan  uuid := 'd0000000-0000-4000-8000-000000000017';
  u_ramesh uuid := 'd0000000-0000-4000-8000-000000000021';
  u_dadi   uuid := 'd0000000-0000-4000-8000-000000000022';
  u_suresh uuid := 'd0000000-0000-4000-8000-000000000023';
  cp1      uuid := 'd0000000-0000-4000-8000-0000000000c1';
  ids uuid[];
  r record;
begin
  select school_lat, school_lng into sch_lat, sch_lng from settings where id=1;
  ids := array[u_admin,u_asha,u_vikram,u_neha,u_rahul,u_priya,u_sunita,u_rohan,u_ramesh,u_dadi,u_suresh];

  -- ---- wipe previous demo data (profiles cascade to children/members/rides…)
  delete from carpools where id = cp1;
  delete from profiles where id = any(ids);
  delete from auth.identities where user_id = any(ids);
  delete from auth.users where id = any(ids);

  -- ---- auth users (email/password) --------------------------------------
  for r in select * from (values
      (u_admin,  'admin@vasantvalley.demo'),
      (u_asha,   'asha@demo.in'),  (u_vikram, 'vikram@demo.in'), (u_neha,  'neha@demo.in'),
      (u_rahul,  'rahul@demo.in'), (u_priya,  'priya@demo.in'),  (u_sunita,'sunita@demo.in'),
      (u_rohan,  'rohan@demo.in'), (u_ramesh, 'driver@demo.in'), (u_dadi,  'dadi@demo.in'),
      (u_suresh, 'suresh@demo.in')) v(id, email)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.email,
        crypt(pw, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), r.id, r.id::text, jsonb_build_object('sub', r.id::text, 'email', r.email), 'email', now(), now(), now());
  end loop;

  -- ---- admin ---------------------------------------------------------------
  insert into profiles(id,role,name,email,status,tnc_version) values (u_admin,'admin','VVS School Admin','admin@vasantvalley.demo','approved',1);

  -- ---- parents (offsets from the school pin, same as the in-memory demo) ---
  insert into profiles(id,role,name,email,phone,address,colony,pincode,home_lat,home_lng,existing_carpool,can_drive,status,tnc_version,vehicle) values
   (u_asha,  'parent','Asha Mehta',   'asha@demo.in',  '+91 98111 11111','B-6/142, Vasant Kunj','Vasant Kunj B-6','110070',sch_lat+0.012,sch_lng+0.010,false,true,'approved',1,
      '{"make_model":"Maruti Ertiga","color":"Silver","plate":"DL 3C AB 1234","seats":6}'::jsonb),
   (u_vikram,'parent','Vikram Sharma','vikram@demo.in','+91 98222 22222','C-9/88, Vasant Kunj','Vasant Kunj C-9','110070',sch_lat+0.018,sch_lng-0.006,true, true,'approved',1,null),
   (u_neha,  'parent','Neha Gupta',   'neha@demo.in',  '+91 98333 33333','A-1/23, Vasant Kunj','Vasant Kunj A-1','110070',sch_lat-0.009,sch_lng+0.014,false,true,'approved',1,null),
   (u_rahul, 'parent','Rahul Verma',  'rahul@demo.in', '+91 98444 44444','H-31, Rangpuri','Rangpuri','110037',sch_lat+0.028,sch_lng+0.020,true, true,'approved',1,null),
   (u_priya, 'parent','Priya Nair',   'priya@demo.in', '+91 98555 55555','K-9, Mahipalpur Extension','Mahipalpur','110037',sch_lat-0.020,sch_lng+0.030,false,false,'approved',1,null),
   (u_sunita,'parent','Sunita Rao',   'sunita@demo.in','+91 98666 66666','D-2/1019, Vasant Kunj','Vasant Kunj D-2','110070',sch_lat+0.006,sch_lng-0.013,false,true,'approved',1,null),
   (u_rohan, 'parent','Rohan Kapoor', 'rohan@demo.in', '+91 98777 77777','E-3/301, Vasant Kunj','Vasant Kunj E-3','110070',sch_lat+0.004,sch_lng+0.008,false,true,'pending',1,null);

  insert into children(parent_id,name,class_level,gender,allergies,emergency_name,emergency_phone) values
   (u_asha,  'Riya Mehta',   6,'female','Peanut allergy — carries an EpiPen','Asha Mehta','+91 98111 11111'),
   (u_vikram,'Aarav Sharma', 6,'male',  null,null,null),
   (u_vikram,'Diya Sharma',  3,'female',null,null,null),
   (u_neha,  'Kabir Gupta',  7,'male',  null,null,null),
   (u_rahul, 'Sara Verma',   5,'female',null,null,null),
   (u_priya, 'Ishaan Nair',  6,'male',  null,null,null),
   (u_sunita,'Myra Rao',     4,'female',null,null,null),
   (u_rohan, 'Anaya Kapoor', 5,'female',null,null,null);

  -- ---- family add-ons (invite + linked profile) ---------------------------
  insert into addon_invites(parent_id,name,email,relation) values
   (u_asha,  'Ramesh Kumar','driver@demo.in','driver'),
   (u_asha,  'Dadi',        'dadi@demo.in',  'grandparent'),
   (u_vikram,'Suresh Yadav','suresh@demo.in','driver');
  insert into profiles(id,role,name,email,phone,parent_owner_id,relation,status,tnc_version,vehicle,driver_status) values
   (u_ramesh,'addon','Ramesh Kumar','driver@demo.in','+91 98700 12345',u_asha,  'driver','approved',1,
      '{"make_model":"Maruti Ertiga","color":"Silver","plate":"DL 3C AB 1234","seats":6}'::jsonb,'verified'),
   (u_dadi,  'addon','Dadi',        'dadi@demo.in',  null,             u_asha,  'grandparent','approved',1,null,null),
   (u_suresh,'addon','Suresh Yadav','suresh@demo.in','+91 98220 55667',u_vikram,'driver','approved',1,
      '{"make_model":"Toyota Innova","color":"White","plate":"DL 8C XY 7788","seats":7}'::jsonb,'verified');

  -- ---- Asha's carpool -----------------------------------------------------
  insert into carpools(id,name,creator_id,driver_name,driver_phone,driver_vehicle,seats)
    values (cp1,'Vasant Kunj B-Block Morning',u_asha,'Ramesh Kumar','+91 98700 12345','DL 3C AB 1234',4);
  insert into carpool_members(carpool_id,parent_id,role,status) values
   (cp1,u_asha,  'creator','joined'),
   (cp1,u_neha,  'member', 'joined'),
   (cp1,u_sunita,'member', 'invited');
  insert into chat_messages(carpool_id,sender_id,body,created_at) values
   (cp1,u_asha,'Ramesh will drive tomorrow — leaving B-6 at 7:20 sharp.', now() - interval '20 hours'),
   (cp1,u_neha,'Perfect, Kabir will be at the gate. Thank you!',          now() - interval '19 hours');

  -- ---- show the demo quick-logins on the sign-in screen -------------------
  update settings set demo_logins = true where id = 1;
  raise notice 'Demo accounts ready — password for all: demo1234';
end $$;
