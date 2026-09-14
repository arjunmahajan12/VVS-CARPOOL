-- ============================================================================
-- Vasant Valley Carpool — Supabase schema (Postgres + Auth + Realtime + RLS)
-- Consolidated, idempotent: safe to run top-to-bottom on a fresh project and
-- safe to re-run. Writes go through SECURITY DEFINER RPC functions; reads use
-- RLS-protected selects; realtime uses broadcast (primary) + change streams.
--
-- After running: create your admin. Sign up once in the app with your email +
-- password, then run:
--   update profiles set role='admin', status='approved' where email='YOUR_EMAIL';
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables ----
create table if not exists settings (
  id int primary key default 1,
  school_name text not null default 'Vasant Valley School, Vasant Kunj',
  school_lat double precision not null default 28.533246002067454,
  school_lng double precision not null default 77.14409813768475
);
insert into settings (id) values (1) on conflict do nothing;

-- v8: configurable geofences, anomaly rules, bell times, ETA model (SPEC §3).
alter table settings add column if not exists fence_near_m int not null default 400;      -- "arriving" alert
alter table settings add column if not exists fence_stop_m int not null default 150;      -- inside this AND stationary arms the stop clock
alter table settings add column if not exists fence_leave_m int not null default 300;     -- leaving past this after a qualifying stop = done
alter table settings add column if not exists fence_miss_m int not null default 600;      -- leaving past this without a stop = missed
alter table settings add column if not exists dwell_s int not null default 8;             -- min stationary seconds for a qualifying stop
alter table settings add column if not exists stationary_m int not null default 30;       -- ping-to-ping movement under this = stationary
alter table settings add column if not exists school_gate_m int not null default 300;     -- school arrival fence
alter table settings add column if not exists offroute_km numeric not null default 2.0;
alter table settings add column if not exists long_stop_s int not null default 300;       -- stationary this long away from any stop = anomaly
alter table settings add column if not exists speed_max_kmh int not null default 80;
alter table settings add column if not exists school_start_time time not null default '07:50';
alter table settings add column if not exists school_end_time time not null default '14:10';
alter table settings add column if not exists city_speed_kmh int not null default 22;     -- ETA fallback speed
alter table settings add column if not exists road_factor numeric not null default 1.3;   -- haversine → road multiplier
alter table settings add column if not exists vapid_public_key text;                      -- web push (public half only)

create table if not exists profiles (
  id uuid primary key,
  role text not null default 'parent' check (role in ('parent','admin','addon')),
  name text not null default '',
  email text,
  phone text, address text, colony text, pincode text,
  home_lat double precision, home_lng double precision,
  existing_carpool boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  tnc_version int not null default 0,
  parent_owner_id uuid, relation text,
  can_drive boolean not null default true,
  photo_url text, vehicle jsonb,
  driver_status text, trust_score double precision, rating_count int default 0,
  created_at timestamptz not null default now()
);

create table if not exists children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  name text not null, class_level int not null default 1, gender text,
  allergies text, emergency_name text, emergency_phone text, photo_url text
);

create table if not exists addon_invites (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  name text not null, email text not null, relation text
);

create table if not exists carpools (
  id uuid primary key default gen_random_uuid(),
  name text not null, creator_id uuid not null references profiles(id) on delete cascade,
  driver_id uuid, driver_name text, driver_phone text, driver_vehicle text,
  seats int not null default 4,
  direction text default 'to_school', days text default 'Mon,Tue,Wed,Thu,Fri', pickup_time text default '07:30',
  created_at timestamptz not null default now()
);

create table if not exists carpool_members (
  carpool_id uuid not null references carpools(id) on delete cascade,
  parent_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'invited' check (status in ('invited','joined','requested','rejected','left')),
  primary key (carpool_id, parent_id)
);

create table if not exists rides (
  id uuid primary key default gen_random_uuid(),
  carpool_id uuid not null references carpools(id) on delete cascade,
  driver_user_id uuid, driver_name text, driver_phone text, driver_vehicle text,
  pickup_order jsonb not null default '[]'::jsonb,
  direction text, origin_lat double precision, origin_lng double precision,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  started_at timestamptz default now(), ended_at timestamptz,
  last_lat double precision, last_lng double precision, last_update timestamptz
);
-- v8 punctuality columns (filled by _end_ride) + last heading for the car puck
alter table rides add column if not exists planned_duration_min int;
alter table rides add column if not exists actual_duration_min int;
alter table rides add column if not exists on_time boolean;
alter table rides add column if not exists distance_km numeric;
alter table rides add column if not exists last_heading double precision;

create table if not exists ride_pings (
  id bigint generated always as identity primary key,
  ride_id uuid not null references rides(id) on delete cascade,
  lat double precision not null, lng double precision not null,
  eta_min int, distance_km double precision, created_at timestamptz not null default now()
);
-- v8 trail data for replay + anomaly rules
alter table ride_pings add column if not exists speed_kmh numeric;
alter table ride_pings add column if not exists heading numeric;
create index if not exists ride_pings_ride_idx on ride_pings(ride_id, id);

-- v8: persisted per-stop state machine (SPEC §3). All stop memory lives here;
-- ride_geo_alerts (v7) is retired.
create table if not exists ride_stops (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id) on delete cascade,
  child_id uuid references children(id) on delete set null,   -- null for school / home_end
  seq int not null,
  kind text not null check (kind in ('pickup','drop','school','home_end')),
  lat double precision not null, lng double precision not null, label text not null default '',
  status text not null default 'pending' check (status in ('pending','arriving','stopped','done','missed','skipped')),
  planned_eta_min int, planned_at timestamptz,       -- fixed once at start
  eta_min int, eta_at timestamptz,                   -- live, recomputed on every ping
  arrived_at timestamptz, stopped_at timestamptz, done_at timestamptz, dwell_s int,
  delay_min int,                                     -- done_at - planned_at (minutes, negative = early)
  unique (ride_id, seq)
);
create index if not exists ride_stops_ride_idx on ride_stops(ride_id);

create table if not exists ride_events (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id) on delete cascade,
  type text not null, child_id uuid references children(id) on delete set null,
  note text, created_at timestamptz not null default now()
);
-- v8: _rider_status orders boarded/unboarded by created_at — clock_timestamp()
-- keeps that order strict even for events written inside one transaction.
alter table ride_events alter column created_at set default clock_timestamp();

create table if not exists absences (
  carpool_id uuid not null references carpools(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  on_date date not null default current_date,
  primary key (carpool_id, child_id, on_date)
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  carpool_id uuid not null references carpools(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null, created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null, body text, kind text default 'info',
  read boolean not null default false, created_at timestamptz not null default now()
);

create table if not exists tnc (version int primary key, body text not null, published_at timestamptz not null default now());
insert into tnc (version, body) values (1,
  'By using Vasant Valley Carpool you agree to share your approximate home location with matched, school-verified families to arrange carpools, keep contact details accurate, and use the platform safely and respectfully.')
  on conflict do nothing;

create table if not exists driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles(id) on delete cascade,
  type text not null, number text, expiry date, status text default 'verified',
  created_at timestamptz not null default now()
);

create table if not exists trusted_pickups (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  name text not null, phone text
);

create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null, body text, created_at timestamptz not null default now()
);

-- v8: web push subscriptions (one row per browser/device endpoint)
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  p256dh text not null, auth text not null, ua text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

-- v7 geofence memory is retired: every per-stop fact now lives in ride_stops.
drop table if exists ride_geo_alerts;

-- --------------------------------------------------------------- helpers ----
create or replace function _uid() returns uuid language sql stable as $$ select auth.uid() $$;
create or replace function _settings() returns settings language sql stable as $$ select * from settings where id=1 $$;

create or replace function _is_admin() returns boolean language sql stable security definer as $$
  select exists(select 1 from profiles where id=auth.uid() and role='admin')
$$;
create or replace function _anchor() returns uuid language sql stable as $$
  select coalesce((select parent_owner_id from profiles where id=auth.uid() and role='addon'), auth.uid())
$$;
create or replace function _latest_tnc() returns int language sql stable as $$ select max(version) from tnc $$;

create or replace function app_get_school() returns jsonb language sql stable as $$
  select jsonb_build_object('name',school_name,'lat',school_lat,'lng',school_lng) from settings where id=1
$$;

create or replace function _dist_km(a double precision, b double precision, c double precision, d double precision)
returns double precision language sql immutable as $$
  select case when a is null or b is null or c is null or d is null then null else
    6371 * 2 * atan2(
      sqrt(sin(radians(c-a)/2)^2 + cos(radians(a))*cos(radians(c))*sin(radians(d-b)/2)^2),
      sqrt(1 - (sin(radians(c-a)/2)^2 + cos(radians(a))*cos(radians(c))*sin(radians(d-b)/2)^2)))
  end
$$;

-- Point (plat,plng) to segment (a→b) distance in km (equirectangular).
create or replace function _dist_route_km(plat double precision, plng double precision,
  alat double precision, alng double precision, blat double precision, blng double precision)
returns double precision language plpgsql immutable as $$
declare r double precision := 6371; lat0 double precision;
  px double precision; py double precision; ax double precision; ay double precision; bx double precision; b_y double precision;
  dx double precision; dy double precision; len2 double precision; t double precision;
begin
  if plat is null or alat is null or blat is null then return null; end if;
  lat0 := radians((alat+blat)/2);
  px := r*radians(plng)*cos(lat0); py := r*radians(plat);
  ax := r*radians(alng)*cos(lat0); ay := r*radians(alat);
  bx := r*radians(blng)*cos(lat0); b_y := r*radians(blat);
  dx := bx-ax; dy := b_y-ay; len2 := dx*dx+dy*dy;
  t := case when len2=0 then 0 else ((px-ax)*dx+(py-ay)*dy)/len2 end;
  t := greatest(0, least(1, t));
  return sqrt((px-(ax+t*dx))^2 + (py-(ay+t*dy))^2);
end $$;

create or replace function _notify(uid uuid, title text, body text, kind text default 'info')
returns void language sql security definer as $$
  insert into notifications(user_id,title,body,kind) values (uid,title,body,kind)
$$;

create or replace function _audience(cid uuid) returns setof uuid language sql stable as $$
  select distinct u from (
    select parent_id u from carpool_members where carpool_id=cid and status='joined'
    union
    select p.id from profiles p join carpool_members m on m.parent_id=p.parent_owner_id
      where p.role='addon' and m.carpool_id=cid and m.status='joined'
  ) x
$$;

create or replace function _child_count(cid uuid) returns int language sql stable as $$
  select count(*)::int from carpool_members m join children ch on ch.parent_id=m.parent_id
    where m.carpool_id=cid and m.status='joined'
$$;

-- custody status: the LATEST boarded/unboarded event wins; a reached_* is dropped.
create or replace function _rider_status(cid uuid, kid uuid) returns text language sql stable as $$
  select case
    when exists(select 1 from ride_events e join rides r on r.id=e.ride_id
                where r.carpool_id=cid and r.status='active' and e.child_id=kid
                  and e.type in ('reached_school','reached_home')) then 'dropped'
    when coalesce((select max(e.created_at) from ride_events e join rides r on r.id=e.ride_id
                where r.carpool_id=cid and r.status='active' and e.child_id=kid and e.type='boarded'), '-infinity'::timestamptz)
       > coalesce((select max(e.created_at) from ride_events e join rides r on r.id=e.ride_id
                where r.carpool_id=cid and r.status='active' and e.child_id=kid and e.type='unboarded'), '-infinity'::timestamptz)
      then 'boarded'
    else 'waiting' end
$$;

create or replace function _profile_json(pid uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id',p.id,'role',p.role,'name',p.name,'email',p.email,'phone',p.phone,'address',p.address,
    'colony',p.colony,'pincode',p.pincode,'home_lat',p.home_lat,'home_lng',p.home_lng,
    'existing_carpool',p.existing_carpool,'status',p.status,'tnc_version',p.tnc_version,
    'parent_owner_id',p.parent_owner_id,'relation',p.relation,'can_drive',p.can_drive,
    'photo_url',p.photo_url,'vehicle',p.vehicle,'driver_status',p.driver_status,
    'trust_score',p.trust_score,'rating_count',p.rating_count,
    'latest_tnc',_latest_tnc(),
    'needs_tnc',(p.role <> 'addon' and p.tnc_version < _latest_tnc()),
    'push_enabled',exists(select 1 from push_subscriptions ps where ps.user_id=p.id),
    'children',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'class_level',c.class_level,'gender',c.gender,
       'allergies',c.allergies,'emergency_name',c.emergency_name,'emergency_phone',c.emergency_phone,'photo_url',c.photo_url) order by c.id) from children c where c.parent_id=p.id),'[]'::jsonb),
    'addons',coalesce((select jsonb_agg(jsonb_build_object(
        'id',coalesce(pr.id, a.id),'name',a.name,'email',a.email,'relation',a.relation,
        'driver_status',pr.driver_status,'vehicle',pr.vehicle,'signed_up',(pr.id is not null)))
      from addon_invites a left join profiles pr on lower(pr.email)=lower(a.email) and pr.parent_owner_id=p.id
      where a.parent_id=p.id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'type',d.type,'number',d.number,'expiry',d.expiry,'status',d.status) order by d.created_at) from driver_documents d where d.driver_id=p.id),'[]'::jsonb),
    'trusted',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'phone',t.phone)) from trusted_pickups t where t.parent_id=p.id),'[]'::jsonb))
  from profiles p where p.id=pid
$$;

create or replace function _carpool_json(cid uuid, viewer uuid, with_ride boolean default true) returns jsonb language plpgsql stable as $$
begin
return (
  with ms as (
    select m.parent_id, p.name parent_name, p.phone, p.colony, p.existing_carpool, p.can_drive, m.role, m.status,
           p.home_lat, p.home_lng, (select id from children where parent_id=p.id order by id limit 1) child_id,
           (select name from children where parent_id=p.id order by id limit 1) child_name
      from carpool_members m join profiles p on p.id=m.parent_id where m.carpool_id=cid),
  rd as (
    select ch.id child_id, ch.name child_name, ch.class_level, ch.gender,
           pr.id parent_id, pr.name parent_name, pr.home_lat, pr.home_lng, pr.colony,
           exists(select 1 from absences ab where ab.carpool_id=cid and ab.child_id=ch.id and ab.on_date=current_date) absent,
           _rider_status(cid, ch.id) status,
           ch.allergies, ch.emergency_phone, ch.photo_url,
           (select e.created_at from ride_events e join rides r on r.id=e.ride_id where r.carpool_id=cid and r.status='active' and e.child_id=ch.id and e.type='boarded' order by e.created_at desc limit 1) boarded_at,
           (select e.created_at from ride_events e join rides r on r.id=e.ride_id where r.carpool_id=cid and r.status='active' and e.child_id=ch.id and e.type in ('reached_school','reached_home') limit 1) dropped_at
    from carpool_members m2 join profiles pr on pr.id=m2.parent_id
    join children ch on ch.parent_id=pr.id
    where m2.carpool_id=cid and m2.status='joined')
  select jsonb_build_object(
    'id',c.id,'name',c.name,'creator_id',c.creator_id,
    'creator_name',(select name from profiles where id=c.creator_id),
    'driver_name',c.driver_name,'driver_phone',c.driver_phone,'driver_vehicle',c.driver_vehicle,'driver_verified',(c.driver_name is not null),
    'seats',c.seats,'seats_used',_child_count(cid),
    'members',coalesce((select jsonb_agg(to_jsonb(ms)) from ms),'[]'::jsonb),
    'joined',coalesce((select jsonb_agg(to_jsonb(ms)) from ms where status='joined'),'[]'::jsonb),
    'riders',coalesce((select jsonb_agg(to_jsonb(rd)) from rd),'[]'::jsonb),
    -- membership is per household: an add-on shares their parent's status
    'my_status',(select status from ms where parent_id=coalesce((select parent_owner_id from profiles where id=viewer and role='addon'),viewer)),
    'is_creator',(c.creator_id=viewer),
    'is_org_household',(_anchor()=c.creator_id),
    'active_ride', case when with_ride then
      (select _ride_json(r.id) from rides r where r.carpool_id=cid and r.status='active' limit 1) else null end)
  from carpools c where c.id=cid);
end $$;

-- Full stop rows (+ child_name / parent_id / sub) in seq order — the Stop shape.
create or replace function _stops_json(rid uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'ride_id',s.ride_id,'child_id',s.child_id,'seq',s.seq,'kind',s.kind,
      'lat',s.lat,'lng',s.lng,'label',s.label,
      'sub', case when s.kind in ('pickup','drop') then coalesce(pr.name,'')||coalesce(' · '||nullif(pr.colony,''),'')
                  when s.kind='school' then 'School gate' else 'Organiser''s home' end,
      'status',s.status,'planned_eta_min',s.planned_eta_min,'planned_at',s.planned_at,
      'eta_min',s.eta_min,'eta_at',s.eta_at,
      'arrived_at',s.arrived_at,'stopped_at',s.stopped_at,'done_at',s.done_at,'dwell_s',s.dwell_s,'delay_min',s.delay_min,
      'parent_id',coalesce(pr.id, case when s.kind='home_end' then c.creator_id end),'child_name',ch.name) order by s.seq),'[]'::jsonb)
  from ride_stops s join rides r on r.id=s.ride_id join carpools c on c.id=r.carpool_id
  left join children ch on ch.id=s.child_id left join profiles pr on pr.id=ch.parent_id
  where s.ride_id=rid
$$;

create or replace function _events_json(rid uuid) returns jsonb language sql stable as $$
  select coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'type',e.type,'note',e.note,'child_id',e.child_id,
      'child_name',(select name from children where id=e.child_id),'created_at',e.created_at) order by e.created_at, e.id)
    from ride_events e where e.ride_id=rid),'[]'::jsonb)
$$;

create or replace function _ride_json(rid uuid) returns jsonb language plpgsql stable as $$
begin
return (
  select jsonb_build_object(
    'id',r.id,'carpool_id',r.carpool_id,'driver_name',r.driver_name,
    'driver_user_id',r.driver_user_id,
    -- the driver's CURRENT number (editable during the trip), falling back to what was captured at start
    'driver_phone',coalesce((select nullif(p.phone,'') from profiles p where p.id=r.driver_user_id), r.driver_phone),'driver_vehicle',r.driver_vehicle,
    'order',coalesce(r.pickup_order,'[]'::jsonb),'status',r.status,
    'direction',coalesce(r.direction,'to_school'),
    'origin_lat',r.origin_lat,'origin_lng',r.origin_lng,
    'started_at',r.started_at,'ended_at',r.ended_at,
    'last_lat',r.last_lat,'last_lng',r.last_lng,'last_heading',r.last_heading,'last_update',r.last_update,
    'planned_duration_min',r.planned_duration_min,'actual_duration_min',r.actual_duration_min,
    'on_time',r.on_time,'distance_km',r.distance_km,
    'carpool',_carpool_json(r.carpool_id, auth.uid(), false),
    'school',app_get_school(),
    'stops',_stops_json(r.id),
    'events',_events_json(r.id))
  from rides r where r.id=rid);
end $$;

-- Carpools carry no schedule (SPEC §1.9): direction is stored per trip.
create or replace function _ride_dir(rid uuid) returns text language sql stable as $$
  select coalesce(r.direction, 'to_school') from rides r where r.id=rid
$$;
create or replace function _ride_family(rid uuid) returns uuid language sql stable as $$
  select creator_id from carpools c join rides r on r.carpool_id=c.id where r.id=rid
$$;
create or replace function _ride_active(rid uuid) returns boolean language sql stable as $$
  select exists(select 1 from rides where id=rid and status='active')
$$;
create or replace function _can_act_on_ride(rid uuid) returns boolean language sql stable as $$
  select exists(select 1 from rides r where r.id=rid and (
    r.driver_user_id = auth.uid() or
    r.carpool_id in (select carpool_id from carpool_members where status='joined' and parent_id=_anchor())))
$$;
create or replace function _require_approved() returns void language plpgsql stable as $$
begin
  if (select status from profiles where id=auth.uid()) is distinct from 'approved' then
    raise exception 'Your family is awaiting school verification — this unlocks once the school approves you.';
  end if;
end $$;

create or replace function _ev_board(rid uuid, kid uuid, auto boolean) returns void language plpgsql as $$
declare parent uuid; kidname text;
begin
  select name, parent_id into kidname, parent from children where id=kid;
  if kidname is null then return; end if;
  insert into ride_events(ride_id,type,note,child_id)
    values (rid,'boarded',kidname||' boarded'||case when auto then ' (auto check-in)' else '' end,kid);
  perform _notify(parent,'Boarded safely ✅', kidname||' is on board'||case when auto then ' — checked in automatically by location' else '' end||'.','safety');
end $$;
create or replace function _ev_drop(rid uuid, kid uuid, place text, auto boolean) returns void language plpgsql as $$
declare parent uuid; kidname text;
begin
  select name, parent_id into kidname, parent from children where id=kid;
  if kidname is null then return; end if;
  insert into ride_events(ride_id,type,note,child_id)
    values (rid, case when place='home' then 'reached_home' else 'reached_school' end,
            kidname||' reached '||place||case when auto then ' (auto)' else '' end, kid);
  perform _notify(parent, case when place='home' then 'Reached home 🏡' else 'Reached school 🏫' end, kidname||' has arrived safely.','safety');
end $$;

-- ---- ETA model (SPEC §3) --------------------------------------------------
-- Recent moving speed over the last 5 pings (km/h): total distance of the
-- moving legs / their elapsed time. Null when the car hasn't really moved.
create or replace function _recent_speed_kmh(rid uuid) returns double precision language plpgsql stable as $$
declare st settings%rowtype := _settings(); dk double precision; dt double precision;
begin
  select coalesce(sum(_dist_km(z.plat,z.plng,z.lat,z.lng)),0), coalesce(sum(extract(epoch from (z.created_at - z.pat))),0)
    into dk, dt
    from (select q.lat, q.lng, q.created_at,
                 lag(q.lat) over w plat, lag(q.lng) over w plng, lag(q.created_at) over w pat
            from (select p.id, p.lat, p.lng, p.created_at from ride_pings p where p.ride_id=rid order by p.id desc limit 5) q
          window w as (order by q.id)) z
   where z.plat is not null and z.created_at > z.pat and _dist_km(z.plat,z.plng,z.lat,z.lng)*1000 >= st.stationary_m;
  if dt < 1 or dk <= 0 then return null; end if;
  dk := dk / (dt/3600.0);
  if dk < 5 then return null; end if;            -- crawling: fall back to city speed
  return least(dk, 120);
end $$;

-- One sequential ETA pass from (flat,flng) over the remaining stops:
--   leg_km = haversine × road_factor;  eta_i = eta_{i-1} + leg_i/speed + dwell_s/60 (dwell for every stop before it)
-- planned=true writes planned_eta_min/planned_at (once, at start); otherwise the live eta_min/eta_at.
-- Returns the ETA (minutes) of the final remaining stop, null when nothing is left.
create or replace function _eta_pass(rid uuid, flat double precision, flng double precision, speed double precision, base timestamptz, planned boolean)
returns int language plpgsql as $$
declare st settings%rowtype := _settings(); cum double precision := 0; plat double precision := flat; plng double precision := flng;
  srow record; last_eta int := null; m int;
begin
  if speed is null or speed <= 0 then speed := st.city_speed_kmh; end if;
  for srow in select s.id, s.lat, s.lng from ride_stops s where s.ride_id=rid and s.status in ('pending','arriving','stopped') order by s.seq loop
    cum := cum + (coalesce(_dist_km(plat,plng,srow.lat,srow.lng),0) * st.road_factor) / speed * 60;
    m := greatest(0, round(cum))::int; last_eta := m;
    if planned then update ride_stops set planned_eta_min=m, planned_at=base + cum * interval '1 minute' where id=srow.id;
    else update ride_stops set eta_min=m, eta_at=base + cum * interval '1 minute' where id=srow.id; end if;
    cum := cum + st.dwell_s/60.0;
    plat := srow.lat; plng := srow.lng;
  end loop;
  if not planned then update ride_stops set eta_min=null, eta_at=null where ride_id=rid and status not in ('pending','arriving','stopped'); end if;
  return last_eta;
end $$;

create or replace function _end_ride(rid uuid, note text) returns void language plpgsql as $$
declare cid uuid; nm text; a uuid; fam uuid; rrow record; st settings%rowtype := _settings();
  gate_at timestamptz; ontime boolean; dist double precision; ended timestamptz := now(); started timestamptz;
begin
  if not exists(select 1 from rides where id=rid and status='active') then return; end if;
  select carpool_id, started_at into cid, started from rides where id=rid;
  if _ride_dir(rid)='from_school' then
    fam := _ride_family(rid);
    for rrow in select ch.id from children ch where ch.parent_id=fam and _rider_status(cid, ch.id)='boarded'
    loop perform _ev_drop(rid, rrow.id, 'home', true); end loop;
  else
    -- on_time (school run) = gate arrival time-of-day in Asia/Kolkata ≤ school_start_time; null if the gate was never reached
    gate_at := coalesce((select s.done_at from ride_stops s where s.ride_id=rid and s.kind='school' and s.status='done'),
                        (select min(e.created_at) from ride_events e where e.ride_id=rid and e.type='reached_school'));
    ontime := case when gate_at is null then null else ((gate_at at time zone 'Asia/Kolkata')::time <= st.school_start_time) end;
  end if;
  select sum(_dist_km(z.plat,z.plng,z.lat,z.lng)) into dist
    from (select p.lat, p.lng, lag(p.lat) over (order by p.id) plat, lag(p.lng) over (order by p.id) plng from ride_pings p where p.ride_id=rid) z
   where z.plat is not null and _dist_km(z.plat,z.plng,z.lat,z.lng) < 5;   -- ignore GPS teleports
  update rides set status='completed', ended_at=ended, on_time=ontime,
    actual_duration_min = greatest(0, round(extract(epoch from (ended - coalesce(started, ended)))/60))::int,
    distance_km = round(coalesce(dist,0)::numeric,1)
   where id=rid;
  update ride_stops set eta_min=null, eta_at=null where ride_id=rid;
  insert into ride_events(ride_id,type,note) values (rid,'ended',coalesce(note,'Trip completed'));
  select name into nm from carpools where id=cid;
  for a in select _audience(cid) loop perform _notify(a,'Trip completed','"'||nm||'" has arrived. Thanks!','info'); end loop;
end $$;

create or replace function _sweep_stale_rides() returns void language plpgsql as $$
declare rrow record;
begin
  for rrow in select id from rides where status='active'
      and (coalesce(started_at, now()) at time zone 'Asia/Kolkata')::date < (now() at time zone 'Asia/Kolkata')::date
  loop perform _end_ride(rrow.id, 'Trip auto-closed — the day ended'); end loop;
end $$;

-- corridor distance for the route-anomaly alert
create or replace function _corridor_km(rid uuid, plat double precision, plng double precision)
returns double precision language plpgsql stable as $$
declare s jsonb := app_get_school(); lats double precision[]; lngs double precision[];
  n int; best double precision; d double precision; i int;
begin
  select array_agg(pr.home_lat order by t.ord), array_agg(pr.home_lng order by t.ord) into lats, lngs
    from rides r cross join lateral jsonb_array_elements_text(r.pickup_order) with ordinality t(cid, ord)
    join children ch on ch.id = t.cid::uuid join profiles pr on pr.id = ch.parent_id and pr.home_lat is not null
   where r.id = rid;
  lats := coalesce(lats,'{}'::double precision[]) || (s->>'lat')::double precision;
  lngs := coalesce(lngs,'{}'::double precision[]) || (s->>'lng')::double precision;
  n := array_length(lats,1);
  if n < 2 then return _dist_km(plat,plng,lats[1],lngs[1]); end if;
  best := null;
  for i in 1..n-1 loop
    d := _dist_route_km(plat,plng,lats[i],lngs[i],lats[i+1],lngs[i+1]);
    if best is null or d < best then best := d; end if;
  end loop;
  return best;
end $$;

-- ------------------------------------------------------------- auth/RPCs ----
create or replace function app_get_profile() returns jsonb language sql stable security definer as $$
  select case when exists(select 1 from profiles where id=auth.uid()) then _profile_json(auth.uid()) else null end
$$;

create or replace function app_register(data jsonb) returns jsonb language plpgsql security definer as $$
declare em text; a uuid;
begin
  select email into em from auth.users where id=auth.uid();
  insert into profiles(id,role,name,email,phone,address,colony,pincode,home_lat,home_lng,existing_carpool,can_drive,status,tnc_version)
    values (auth.uid(),'parent',data->>'name',em,data->>'phone',data->>'address',data->>'colony',data->>'pincode',
      (data->>'home_lat')::double precision,(data->>'home_lng')::double precision,coalesce((data->>'existing_carpool')::boolean,false),
      coalesce((data->>'can_drive')::boolean,true),'pending', case when (data->>'accept_tnc')::boolean then _latest_tnc() else 0 end)
    on conflict (id) do update set name=excluded.name;
  if data ? 'child_name' and coalesce(data->>'child_name','')<>'' then
    insert into children(parent_id,name,class_level,gender) values (auth.uid(),data->>'child_name',coalesce((data->>'child_class')::int,1),data->>'child_gender');
  end if;
  for a in select id from profiles where role='admin' loop perform _notify(a,'New registration to verify',(data->>'name')||' registered and needs verification.','system'); end loop;
  perform _notify(auth.uid(),'Registration received','Your details were sent to the school for verification.','system');
  return _profile_json(auth.uid());
end $$;

-- If the signing-up email matches a pending add-on invite, skip parent onboarding.
create or replace function app_pending_invite() returns jsonb language plpgsql stable security definer as $$
declare em text; inv addon_invites%rowtype;
begin
  if exists(select 1 from profiles where id=auth.uid()) then return null; end if;
  select email into em from auth.users where id=auth.uid();
  select * into inv from addon_invites where lower(email)=lower(em) limit 1;
  if inv.id is null then return null; end if;
  return jsonb_build_object('name',inv.name,'relation',inv.relation,'parent_name',(select name from profiles where id=inv.parent_id));
end $$;

create or replace function app_update_profile(patch jsonb) returns jsonb language plpgsql security definer as $$
begin
  update profiles set
    name=coalesce(patch->>'name',name), phone=coalesce(patch->>'phone',phone), address=coalesce(patch->>'address',address),
    colony=coalesce(patch->>'colony',colony), pincode=coalesce(patch->>'pincode',pincode),
    home_lat=coalesce((patch->>'home_lat')::double precision,home_lat), home_lng=coalesce((patch->>'home_lng')::double precision,home_lng),
    existing_carpool=coalesce((patch->>'existing_carpool')::boolean,existing_carpool),
    can_drive=coalesce((patch->>'can_drive')::boolean,can_drive)
  where id=auth.uid();
  return _profile_json(auth.uid());
end $$;

create or replace function app_add_child(c jsonb) returns jsonb language plpgsql security definer as $$
begin
  insert into children(parent_id,name,class_level,gender,allergies,emergency_phone)
    values (auth.uid(),c->>'name',coalesce((c->>'class_level')::int,1),c->>'gender',c->>'allergies',c->>'emergency_phone');
  return _profile_json(auth.uid());
end $$;
create or replace function app_remove_child(child_id uuid) returns jsonb language plpgsql security definer as $$
begin delete from children where id=child_id and parent_id=auth.uid(); return _profile_json(auth.uid()); end $$;

create or replace function app_add_addon(a jsonb) returns jsonb language plpgsql security definer as $$
begin
  insert into addon_invites(parent_id,name,email,relation) values (auth.uid(),a->>'name',lower(a->>'email'),a->>'relation');
  return _profile_json(auth.uid());
end $$;
create or replace function app_remove_addon(addon_id uuid) returns jsonb language plpgsql security definer as $$
begin
  delete from addon_invites where parent_id=auth.uid() and (id=addon_id or lower(email)=(select lower(email) from profiles where id=addon_id));
  delete from profiles where id=addon_id and parent_owner_id=auth.uid();
  return _profile_json(auth.uid());
end $$;

create or replace function app_confirm_driver(addon_id uuid, confirmed boolean, plate text default null) returns jsonb language plpgsql security definer as $$
begin
  update profiles set driver_status = case when confirmed then 'verified' else 'incomplete' end,
    vehicle = case when plate is not null then coalesce(vehicle,'{}'::jsonb) || jsonb_build_object('plate',plate) else vehicle end
  where id=addon_id and parent_owner_id=auth.uid() and relation='driver';
  perform _notify(addon_id, case when confirmed then 'You''re confirmed to drive ✅' else 'Driving not confirmed' end,
    case when confirmed then 'Your family confirmed you can drive their carpool trips.' else 'Your family hasn''t confirmed you to drive yet.' end,
    case when confirmed then 'approved' else 'info' end);
  return _profile_json(auth.uid());
end $$;

create or replace function app_accept_tnc() returns jsonb language plpgsql security definer as $$
begin update profiles set tnc_version=_latest_tnc() where id=auth.uid(); return _profile_json(auth.uid()); end $$;
create or replace function app_latest_tnc() returns jsonb language sql stable as $$ select to_jsonb(t) from tnc t order by version desc limit 1 $$;

-- Add-on onboarding: link a signed-up add-on email to the inviting family.
create or replace function _link_addon() returns void language plpgsql security definer as $$
declare em text; inv addon_invites%rowtype;
begin
  select email into em from auth.users where id=auth.uid();
  select * into inv from addon_invites where lower(email)=lower(em) limit 1;
  if inv.id is not null and not exists(select 1 from profiles where id=auth.uid()) then
    insert into profiles(id,role,name,email,parent_owner_id,relation,status,tnc_version)
      values (auth.uid(),'addon',inv.name,em,inv.parent_id,inv.relation,'approved',_latest_tnc());
  end if;
end $$;

-- ------------------------------------------------------------ discovery ----
create or replace function app_search_parents(filters jsonb) returns jsonb language plpgsql stable security definer as $$
declare me profiles%rowtype; s jsonb := app_get_school(); result jsonb; cps jsonb; radius double precision;
begin
  select * into me from profiles where id=auth.uid();
  radius := case when filters->>'radius_km' is null or filters->>'radius_km' in ('','all') then null else (filters->>'radius_km')::double precision end;
  with base as (
    select p.*, _dist_km(me.home_lat,me.home_lng,p.home_lat,p.home_lng) as hkm,
      _dist_route_km(p.home_lat,p.home_lng, me.home_lat,me.home_lng,(s->>'lat')::double precision,(s->>'lng')::double precision) as rkm
    from profiles p where p.role='parent' and p.status='approved' and p.id<>me.id),
  filt as (
    select b.* from base b where
      (filters->>'pincode' is null or b.pincode = filters->>'pincode') and
      (radius is null or (b.hkm is not null and b.hkm <= radius)) and
      (filters->>'class_min' is null or exists(select 1 from children c where c.parent_id=b.id and c.class_level >= (filters->>'class_min')::int)) and
      (filters->>'class_max' is null or exists(select 1 from children c where c.parent_id=b.id and c.class_level <= (filters->>'class_max')::int)) and
      (filters->>'gender' is null or exists(select 1 from children c where c.parent_id=b.id and c.gender = filters->>'gender')))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',f.id,'name',f.name,'colony',f.colony,'pincode',f.pincode,'phone',f.phone,
      'home_lat',round(f.home_lat::numeric,3),'home_lng',round(f.home_lng::numeric,3),
      'existing_carpool',f.existing_carpool,
      'children',coalesce((select jsonb_agg(jsonb_build_object('name',c.name,'class_level',c.class_level,'gender',c.gender)) from children c where c.parent_id=f.id),'[]'::jsonb),
      'distance_km', round(f.hkm::numeric,2), 'distance_from_route_km', round(f.rkm::numeric,2)
    ) order by f.hkm nulls last),'[]'::jsonb) into result from filt f;

  select coalesce(jsonb_agg(sub.j order by sub.dkm nulls last),'[]'::jsonb) into cps from (
    select jsonb_build_object(
      'id',c.id,'name',c.name,'creator_name',(select name from profiles where id=c.creator_id),
      'members_count',(select count(*) from carpool_members m where m.carpool_id=c.id and m.status='joined'),
      'seats',c.seats,'seats_used',_child_count(c.id),'full',_child_count(c.id) >= c.seats,
      'distance_km', round(nd.dkm::numeric,2), 'lat', round(nd.nlat::numeric,3), 'lng', round(nd.nlng::numeric,3),
      'my_status',(select status from carpool_members m where m.carpool_id=c.id and m.parent_id=me.id)) j, nd.dkm
    from carpools c
    cross join lateral (
      select pr.home_lat nlat, pr.home_lng nlng, _dist_km(me.home_lat,me.home_lng,pr.home_lat,pr.home_lng) dkm
        from carpool_members m join profiles pr on pr.id=m.parent_id
       where m.carpool_id=c.id and m.status='joined' and pr.home_lat is not null
       order by _dist_km(me.home_lat,me.home_lng,pr.home_lat,pr.home_lng) nulls last limit 1) nd
    where c.creator_id <> me.id
      and coalesce((select status from carpool_members m where m.carpool_id=c.id and m.parent_id=me.id),'none') <> 'joined'
      and (radius is null or (nd.dkm is not null and nd.dkm <= radius))
  ) sub;

  return jsonb_build_object('school',s,'me',jsonb_build_object('home_lat',me.home_lat,'home_lng',me.home_lng),'parents',result,'carpools',cps);
end $$;

-- ------------------------------------------------------------- carpools ----
create or replace function app_my_carpools() returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_agg(_carpool_json(id, auth.uid())),'[]'::jsonb) from (
    select distinct c.id from carpools c
     where c.creator_id=_anchor()
        or c.id in (select carpool_id from carpool_members where parent_id=_anchor())) x
$$;
create or replace function app_get_carpool(carpool_id uuid) returns jsonb language plpgsql stable security definer as $$
#variable_conflict use_column
begin
  if not (_is_admin()
    or exists(select 1 from carpool_members where carpool_id=app_get_carpool.carpool_id and parent_id=_anchor() and status in ('joined','invited','requested'))
    or exists(select 1 from carpools where id=app_get_carpool.carpool_id and creator_id=auth.uid())) then
    raise exception 'You are not part of this carpool';
  end if;
  return _carpool_json(app_get_carpool.carpool_id, auth.uid()) || jsonb_build_object('stats', _carpool_stats(app_get_carpool.carpool_id));
end $$;

-- Carpools have NO schedule (SPEC §1.9): trips are ad-hoc, direction by clock.
create or replace function app_create_carpool(data jsonb) returns jsonb language plpgsql security definer as $$
declare cid uuid; myname text; iid uuid;
begin
  perform _require_approved();
  if (select role from profiles where id=auth.uid()) <> 'parent' then
    raise exception 'Only a parent can create a carpool.';
  end if;
  if (select can_drive from profiles where id=auth.uid()) is false then
    raise exception 'Only a parent with a car can create a carpool — you can join one instead from the Find tab.';
  end if;
  if coalesce(trim(data->>'name'),'') = '' then raise exception 'Give the carpool a name.'; end if;
  select name into myname from profiles where id=auth.uid();
  insert into carpools(name,creator_id,driver_name,driver_phone,seats)
    values (data->>'name',auth.uid(),data->>'driver_name',data->>'driver_phone',coalesce((data->>'seats')::int,4))
    returning id into cid;
  insert into carpool_members(carpool_id,parent_id,role,status) values (cid,auth.uid(),'creator','joined');
  for iid in select jsonb_array_elements_text(coalesce(data->'invite_ids','[]'::jsonb))::uuid loop
    if exists(select 1 from profiles where id=iid and role='parent' and status='approved') and iid<>auth.uid() then
      insert into carpool_members(carpool_id,parent_id,status) values (cid,iid,'invited') on conflict do nothing;
      perform _notify(iid,'Carpool invitation',myname||' invited you to "'||(data->>'name')||'".','invite');
    end if;
  end loop;
  return _carpool_json(cid, auth.uid());
end $$;

create or replace function app_respond_invite(carpool_id uuid, accept boolean) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare cr uuid; myname text;
begin
  if accept then perform _require_approved(); end if;
  if accept and (select count(*) from carpool_members m join children c on c.parent_id=m.parent_id where m.carpool_id=app_respond_invite.carpool_id and m.status='joined')
       + (select count(*) from children where parent_id=auth.uid()) > (select seats from carpools where id=app_respond_invite.carpool_id) then
    raise exception 'This carpool is full — no seats left.';
  end if;
  update carpool_members set status = case when accept then 'joined' else 'rejected' end
    where carpool_id=app_respond_invite.carpool_id and parent_id=auth.uid();
  select creator_id into cr from carpools where id=carpool_id;
  select name into myname from profiles where id=auth.uid();
  perform _notify(cr, case when accept then 'Invitation accepted' else 'Invitation declined' end, myname||case when accept then ' joined' else ' declined' end||' your carpool.','info');
  return _carpool_json(carpool_id, auth.uid());
end $$;

create or replace function app_request_join(carpool_id uuid) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare cr uuid; myname text;
begin
  perform _require_approved();
  insert into carpool_members(carpool_id,parent_id,role,status) values (app_request_join.carpool_id, auth.uid(),'member','requested')
    on conflict (carpool_id,parent_id) do update set status='requested', role='member';
  select creator_id into cr from carpools where id=carpool_id;
  select name into myname from profiles where id=auth.uid();
  perform _notify(cr,'Seat request 🙋', myname||' asked to join your carpool.','invite');
  return jsonb_build_object('ok',true);
end $$;

create or replace function app_respond_join(carpool_id uuid, parent_id uuid, accept boolean) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  if accept and (select count(*) from carpool_members m join children c on c.parent_id=m.parent_id where m.carpool_id=app_respond_join.carpool_id and m.status='joined')
       + (select count(*) from children where parent_id=app_respond_join.parent_id) > (select seats from carpools where id=app_respond_join.carpool_id) then
    raise exception 'This carpool is full — no seats left.';
  end if;
  update carpool_members set status = case when accept then 'joined' else 'rejected' end
    where carpool_id=app_respond_join.carpool_id and parent_id=app_respond_join.parent_id and status='requested';
  perform _notify(app_respond_join.parent_id, case when accept then 'Request approved ✅' else 'Request not approved' end,
    case when accept then 'You''ve joined the carpool.' else 'Your request wasn''t approved.' end, case when accept then 'approved' else 'info' end);
  return _carpool_json(app_respond_join.carpool_id, auth.uid());
end $$;

create or replace function app_set_driver(carpool_id uuid, driver_name text, driver_phone text, driver_vehicle text default null) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  update carpools set driver_name=app_set_driver.driver_name, driver_phone=app_set_driver.driver_phone,
    driver_vehicle=coalesce(app_set_driver.driver_vehicle,driver_vehicle) where id=app_set_driver.carpool_id;
  return _carpool_json(app_set_driver.carpool_id, auth.uid());
end $$;

create or replace function app_leave_carpool(carpool_id uuid) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare nextp uuid; nm text; me text; a uuid;
begin
  if exists(select 1 from rides r where r.carpool_id=app_leave_carpool.carpool_id and r.status='active') then
    raise exception 'End the live trip before leaving this carpool.';
  end if;
  select name into nm from carpools where id=app_leave_carpool.carpool_id;
  select name into me from profiles where id=auth.uid();
  update carpool_members set status='left' where carpool_id=app_leave_carpool.carpool_id and parent_id=auth.uid();
  if exists(select 1 from carpools where id=app_leave_carpool.carpool_id and creator_id=auth.uid()) then
    -- ONE carpool = ONE driving family: hand over only to a family that has a car.
    select m.parent_id into nextp from carpool_members m join profiles p on p.id=m.parent_id
      where m.carpool_id=app_leave_carpool.carpool_id and m.status='joined' and m.parent_id<>auth.uid() and p.can_drive
      order by m.parent_id limit 1;
    if nextp is not null then
      update carpools set creator_id=nextp, driver_name=null, driver_phone=null, driver_vehicle=null where id=app_leave_carpool.carpool_id;
      update carpool_members set role='creator' where carpool_id=app_leave_carpool.carpool_id and parent_id=nextp;
      update carpool_members set role='member' where carpool_id=app_leave_carpool.carpool_id and parent_id=auth.uid();
      perform _notify(nextp,'You now organise "'||nm||'"', me||' left — your household drives its trips from now on.','info');
      for a in select _audience(app_leave_carpool.carpool_id) loop
        if a <> nextp then perform _notify(a,'New organiser', me||' left "'||nm||'"; '||(select name from profiles where id=nextp)||' now organises it.','info'); end if;
      end loop;
    else
      for a in select _audience(app_leave_carpool.carpool_id) loop perform _notify(a,'Carpool closed','"'||nm||'" closed — the organiser left and no other family has a car to drive it.','info'); end loop;
      delete from carpools where id=app_leave_carpool.carpool_id;
    end if;
  else
    for a in select _audience(app_leave_carpool.carpool_id) loop perform _notify(a,'A family left', me||' left "'||nm||'".','info'); end loop;
  end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function app_delete_carpool(carpool_id uuid) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare nm text; a uuid; me text;
begin
  if not exists(select 1 from carpools c where c.id=app_delete_carpool.carpool_id and (c.creator_id=auth.uid() or _is_admin())) then
    raise exception 'Only the organiser or the school admin can delete a carpool.';
  end if;
  if exists(select 1 from rides r where r.carpool_id=app_delete_carpool.carpool_id and r.status='active') then
    raise exception 'End the live trip before deleting this carpool.';
  end if;
  select name into nm from carpools where id=app_delete_carpool.carpool_id;
  select name into me from profiles where id=auth.uid();
  for a in select _audience(app_delete_carpool.carpool_id) loop
    if a <> auth.uid() then perform _notify(a,'Carpool deleted','"'||nm||'" was deleted by '||me||'.','info'); end if;
  end loop;
  delete from carpools where id=app_delete_carpool.carpool_id;
  return jsonb_build_object('ok',true);
end $$;

-- --------------------------------------------------------------- trips ----
-- ONE carpool = ONE driving family: the organiser's household drives every trip.
create or replace function app_trip_drivers(carpool_id uuid) returns jsonb language plpgsql stable security definer as $$
#variable_conflict use_column
declare result jsonb; org uuid;
begin
  select creator_id into org from carpools where id=app_trip_drivers.carpool_id;
  with cand as (
    select p.id, p.name, 'parent'::text kind, p.phone, null::text vehicle, null::text owner_name, true confirmed, 1 ord
      from profiles p where p.id=org and p.can_drive
    union all
    select d.id, d.name, 'driver'::text kind, d.phone, (d.vehicle->>'plate') vehicle,
           (select name from profiles where id=org) owner_name, coalesce(d.driver_status='verified',false) confirmed, 2 ord
      from profiles d where d.parent_owner_id=org and d.role='addon' and d.relation='driver')
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'phone',phone,'vehicle',vehicle,'owner_name',owner_name,'confirmed',confirmed) order by ord, name),'[]'::jsonb)
    into result from cand;
  return result;
end $$;

drop function if exists app_start_ride(uuid, uuid);
drop function if exists app_start_ride(uuid);
create or replace function app_start_ride(carpool_id uuid, driver_user_id uuid default null,
  order_ids jsonb default null, direction text default null,
  origin_lat double precision default null, origin_lng double precision default null)
returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare rid uuid; cands jsonb; chosen jsonb; du profiles%rowtype;
  dn text; dp text; dv text; ord jsonb; s jsonb := app_get_school(); a uuid; nm text;
  expired boolean; dir text; to_school boolean; fam uuid; olat double precision; olng double precision;
  first_kid uuid; first_parent uuid; first_name text; fkm double precision;
  seq int; srow record; fh_lat double precision; fh_lng double precision; fnm text;
begin
  perform _sweep_stale_rides();
  select creator_id into fam from carpools where id=app_start_ride.carpool_id;
  if fam is null then raise exception 'Carpool not found'; end if;
  if _anchor() <> fam then
    raise exception 'Only the organising family (or their driver) starts this carpool''s trips — create your own carpool to drive.';
  end if;
  select id into rid from rides where carpool_id=app_start_ride.carpool_id and status='active' limit 1;
  if rid is null then
    cands := app_trip_drivers(app_start_ride.carpool_id);
    if driver_user_id is not null then select v into chosen from jsonb_array_elements(cands) t(v) where (v->>'id')::uuid = app_start_ride.driver_user_id; end if;
    if chosen is null then select v into chosen from jsonb_array_elements(cands) t(v) where (v->>'id')::uuid = auth.uid(); end if;
    if chosen is null then select v into chosen from jsonb_array_elements(cands) t(v) where coalesce((v->>'confirmed')::boolean,false) limit 1; end if;
    if chosen is null then raise exception 'No one is set to drive this trip yet — pick a driver first.'; end if;
    if not coalesce((chosen->>'confirmed')::boolean,false) then raise exception '% is not confirmed to drive yet — the family must confirm their licence and vehicle first.', chosen->>'name'; end if;
    select * into du from profiles where id=(chosen->>'id')::uuid;
    if chosen->>'kind' = 'driver' then
      expired := exists(select 1 from driver_documents where driver_id=du.id and type in ('licence','insurance') and expiry is not null and expiry < current_date);
      if expired then raise exception '% licence or insurance has expired — update it before starting.', du.name; end if;
      dv := du.vehicle->>'plate';
    else dv := (select driver_vehicle from carpools where id=app_start_ride.carpool_id); end if;
    dn := chosen->>'name'; dp := coalesce(chosen->>'phone', du.phone);
    dir := coalesce(app_start_ride.direction, case when extract(hour from now() at time zone 'Asia/Kolkata') < 11 then 'to_school' else 'from_school' end);
    if dir not in ('to_school','from_school') then dir := 'to_school'; end if;
    to_school := dir <> 'from_school';
    olat := app_start_ride.origin_lat; olng := app_start_ride.origin_lng;
    if olat is null or olng is null then
      if to_school then select home_lat, home_lng into olat, olng from profiles where id=fam; end if;
      if olat is null then olat := (s->>'lat')::double precision; olng := (s->>'lng')::double precision; end if;
    end if;
    -- organiser's children FIRST (their home anchors the route), then others optimally-ish
    with own as (
      select ch.id cid from children ch
       where ch.parent_id=fam and to_school
         and exists(select 1 from carpool_members m0 where m0.carpool_id=app_start_ride.carpool_id and m0.parent_id=fam and m0.status='joined')
         and not exists(select 1 from absences ab where ab.carpool_id=app_start_ride.carpool_id and ab.child_id=ch.id and ab.on_date=current_date)),
    stops as (
      select ch.id cid, _dist_km(pr.home_lat,pr.home_lng,(s->>'lat')::double precision,(s->>'lng')::double precision) dschool
        from carpool_members m2 join profiles pr on pr.id=m2.parent_id join children ch on ch.parent_id=pr.id
       where m2.carpool_id=app_start_ride.carpool_id and m2.status='joined' and pr.id <> fam
         and not exists(select 1 from absences ab where ab.carpool_id=app_start_ride.carpool_id and ab.child_id=ch.id and ab.on_date=current_date)
         and pr.home_lat is not null),
    client_ord as (select t.cid::uuid cid, t.ord from jsonb_array_elements_text(coalesce(app_start_ride.order_ids,'[]'::jsonb)) with ordinality t(cid, ord)),
    merged as (
      select o.cid, 0 grp, 0::bigint pos from own o
      union all
      select st.cid, 1 grp, coalesce(co.ord, 1000 + row_number() over (order by (case when to_school then -st.dschool else st.dschool end) nulls last)) pos
        from stops st left join client_ord co on co.cid = st.cid)
    select coalesce(jsonb_agg(cid order by grp, pos),'[]'::jsonb) into ord from merged;
    insert into rides(carpool_id,driver_user_id,driver_name,driver_phone,driver_vehicle,pickup_order,direction,origin_lat,origin_lng,status,last_lat,last_lng,last_update)
      values (app_start_ride.carpool_id,(chosen->>'id')::uuid,dn,dp,dv,ord,dir,olat,olng,'active',olat,olng,now()) returning id into rid;
    -- ride_stops: school run = pickups in route order (organiser first) then the gate;
    -- home run = gate first, then drops in route order, then home_end at the organiser's home.
    seq := 0;
    if not to_school then
      seq := seq + 1;
      insert into ride_stops(ride_id,seq,kind,lat,lng,label) values (rid,seq,'school',(s->>'lat')::double precision,(s->>'lng')::double precision,s->>'name');
    end if;
    for srow in select ch.id cid, ch.name cname, pr.home_lat, pr.home_lng
                  from jsonb_array_elements_text(ord) with ordinality t(cid, o) join children ch on ch.id=t.cid::uuid join profiles pr on pr.id=ch.parent_id
                 where pr.home_lat is not null and pr.home_lng is not null order by t.o loop
      seq := seq + 1;
      insert into ride_stops(ride_id,child_id,seq,kind,lat,lng,label)
        values (rid,srow.cid,seq,case when to_school then 'pickup' else 'drop' end,srow.home_lat,srow.home_lng,srow.cname);
    end loop;
    -- absent children still get a stop row, marked 'skipped', so the rail shows "Absent"
    -- (SPEC §3); they are never routed, never ETA'd and never counted as missed.
    for srow in select ch.id cid, ch.name cname, pr.home_lat, pr.home_lng
                  from carpool_members m3 join profiles pr on pr.id=m3.parent_id join children ch on ch.parent_id=pr.id
                 where m3.carpool_id=app_start_ride.carpool_id and m3.status='joined' and pr.home_lat is not null
                   and exists(select 1 from absences ab where ab.carpool_id=app_start_ride.carpool_id and ab.child_id=ch.id and ab.on_date=current_date)
                   and (to_school or pr.id <> fam) loop
      seq := seq + 1;
      insert into ride_stops(ride_id,child_id,seq,kind,lat,lng,label,status)
        values (rid,srow.cid,seq,case when to_school then 'pickup' else 'drop' end,srow.home_lat,srow.home_lng,srow.cname,'skipped');
    end loop;
    if to_school then
      seq := seq + 1;
      insert into ride_stops(ride_id,seq,kind,lat,lng,label) values (rid,seq,'school',(s->>'lat')::double precision,(s->>'lng')::double precision,s->>'name');
    else
      select home_lat, home_lng, name into fh_lat, fh_lng, fnm from profiles where id=fam;
      if fh_lat is not null then
        seq := seq + 1;
        insert into ride_stops(ride_id,seq,kind,lat,lng,label) values (rid,seq,'home_end',fh_lat,fh_lng,fnm||'''s home');
      end if;
    end if;
    -- planned ETAs: same formula from the origin at city speed, fixed for the trip
    fkm := _eta_pass(rid, olat, olng, null, now(), true);
    update rides set planned_duration_min = fkm::int where id=rid;
    perform _eta_pass(rid, olat, olng, null, now(), false);
    insert into ride_events(ride_id,type,note) values (rid,'started','Trip started — '||dn||' driving ('||case when to_school then 'pickup run' else 'drop-home run' end||')');
    select name into nm from carpools where id=app_start_ride.carpool_id;
    for a in select _audience(app_start_ride.carpool_id) loop perform _notify(a,'Trip started','"'||nm||'" is on the way with '||dn||'. Track it live.','trip'); end loop;
    if to_school then
      select ch.id, ch.name, ch.parent_id into first_kid, first_name, first_parent
        from jsonb_array_elements_text(ord) with ordinality t(cid, o) join children ch on ch.id=t.cid::uuid where ch.parent_id <> fam order by t.o limit 1;
      if first_parent is not null then
        select s2.planned_eta_min into fkm from ride_stops s2 where s2.ride_id=rid and s2.child_id=first_kid;
        if fkm is not null then perform _notify(first_parent,'You''re first after the organiser 🚗', dn||' is about '||greatest(1, round(fkm))||' min away — please have '||first_name||' ready.','trip'); end if;
      end if;
    end if;
  end if;
  return _ride_json(rid);
end $$;

create or replace function app_active_rides() returns jsonb language plpgsql security definer as $$
begin
  perform _sweep_stale_rides();
  return (select coalesce(jsonb_agg(_ride_json(r.id)),'[]'::jsonb) from rides r
    where r.status='active' and r.carpool_id in (select carpool_id from carpool_members where status='joined' and parent_id=_anchor()));
end $$;
create or replace function app_get_ride(ride_id uuid) returns jsonb language plpgsql stable security definer as $$
begin return _ride_json(ride_id); end $$;

-- STOP-DETECTION state machine + live ETAs + anomalies + auto-end (SPEC §3).
--   pending  --d < fence_near_m-------------------> arriving   (event 'arriving', notify parent)
--   arriving --d < fence_stop_m && stationary-----> stopped    (stopped_at = now)
--   stopped  --d > fence_leave_m && dwell ≥ dwell_s-> done      (board on school run / drop on home run; delay_min)
--   stopped  --d > fence_leave_m && dwell < dwell_s-> arriving  (rolling stop; keep watching)
--   arriving --d > fence_miss_m (no qualifying stop)> missed    (event 'missed_pickup', alerts to parent + driver)
-- Gate on a home run: same machine with fence_stop_m := school_gate_m and the same
-- hysteresis margin (leave = gate + (fence_leave_m - fence_stop_m)); leaving after a
-- qualifying stop boards every waiting child. Gate on a school run: reaching
-- school_gate_m drops every boarded child (arrival IS the drop). home_end: reaching
-- fence_leave_m of the organiser's home once everyone else is accounted for ends the trip.
drop function if exists app_post_location(uuid, double precision, double precision);
create or replace function app_post_location(ride_id uuid, lat double precision, lng double precision,
  speed_kmh double precision default null, heading double precision default null) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare
  rid uuid := app_post_location.ride_id; clat double precision := app_post_location.lat; clng double precision := app_post_location.lng;
  st settings%rowtype := _settings(); ts timestamptz := clock_timestamp();
  km double precision; e int; cid uuid; to_school boolean; fam uuid; drv uuid; nm text;
  rrow record; srow record; d double precision; a uuid; cur text; rs text;
  plat double precision; plng double precision; pat timestamptz; pmove double precision; pdt double precision;
  p2p double precision; spd double precision; stationary boolean; dwell int;
  near_m double precision := st.fence_near_m; stop_m double precision := st.fence_stop_m;
  leave_m double precision := st.fence_leave_m; miss_m double precision := st.fence_miss_m;
  gate_m double precision := st.school_gate_m; gate_leave_m double precision := st.school_gate_m + greatest(0, st.fence_leave_m - st.fence_stop_m);
  anomalies jsonb := '[]'::jsonb; ended boolean := false; near_any boolean; episode_start timestamptz;
  fin_total int; oth_total int; oth_done int; own_total int; fh_lat double precision; fh_lng double precision; all_done boolean; school_done boolean;
begin
  if not _ride_active(rid) then raise exception 'This trip has already ended.'; end if;
  if not _can_act_on_ride(rid) then raise exception 'Only the trip driver or a member can share location'; end if;
  km := _dist_km(clat,clng,st.school_lat,st.school_lng);
  select r.carpool_id, r.driver_user_id into cid, drv from rides r where r.id=rid;
  to_school := _ride_dir(rid) <> 'from_school';
  fam := _ride_family(rid);
  select name into nm from carpools where id=cid;

  -- previous ping → stationary flag + ping-to-ping speed
  select p.lat, p.lng, p.created_at into plat, plng, pat from ride_pings p where p.ride_id=rid order by p.id desc limit 1;
  pmove := case when plat is null then null else _dist_km(plat,plng,clat,clng)*1000 end;          -- metres
  pdt := case when pat is null then null else extract(epoch from (ts - pat)) end;                   -- seconds
  stationary := pmove is not null and pmove < st.stationary_m;
  p2p := case when pmove is not null and pdt is not null and pdt >= 3 then (pmove/1000.0)/(pdt/3600.0) else null end;
  spd := coalesce(app_post_location.speed_kmh, p2p);

  -- ---- child stops (pickup on a school run / drop on a home run) ----
  for srow in
    select s.id, s.status, s.child_id, s.lat, s.lng, s.stopped_at, s.planned_at, s.eta_min, ch.name child_name, pr.id parent_id
      from ride_stops s join children ch on ch.id=s.child_id join profiles pr on pr.id=ch.parent_id
     where s.ride_id=rid and s.kind in ('pickup','drop') and s.status in ('pending','arriving','stopped') order by s.seq
  loop
    rs := _rider_status(cid, srow.child_id);
    if not ((to_school and rs='waiting') or ((not to_school) and rs='boarded')) then continue; end if;
    d := _dist_km(clat,clng,srow.lat,srow.lng)*1000;
    if d is null then continue; end if;
    cur := srow.status;
    if cur='pending' and d < near_m then
      update ride_stops set status='arriving', arrived_at=ts where id=srow.id; cur := 'arriving';
      insert into ride_events(ride_id,type,note,child_id) values (rid,'arriving','Arriving at '||srow.child_name||'''s stop',srow.child_id);
      perform _notify(srow.parent_id, case when to_school then 'Driver arriving 🚗' else 'Reaching your home 🏡' end,
        case when to_school then 'Please have '||srow.child_name||' ready — the carpool reaches you in ~'||greatest(1,coalesce(srow.eta_min,1))||' min.'
             else srow.child_name||' is ~'||greatest(1,coalesce(srow.eta_min,1))||' min from home — please be ready to receive them.' end,'trip');
    end if;
    if cur='arriving' and d < stop_m and stationary then
      update ride_stops set status='stopped', stopped_at=ts, dwell_s=0 where id=srow.id; cur := 'stopped';
      insert into ride_events(ride_id,type,note,child_id) values (rid,'stopped','Stopped at '||srow.child_name||'''s stop',srow.child_id);
    elsif cur='stopped' then
      dwell := greatest(0, extract(epoch from (ts - srow.stopped_at)))::int;
      if d > leave_m then
        if dwell >= st.dwell_s then
          update ride_stops set status='done', done_at=ts, dwell_s=dwell,
            delay_min = case when planned_at is null then null else round(extract(epoch from (ts - planned_at))/60)::int end
           where id=srow.id;
          cur := 'done';
          if to_school then perform _ev_board(rid, srow.child_id, true); else perform _ev_drop(rid, srow.child_id, 'home', true); end if;
        else
          update ride_stops set status='arriving', stopped_at=null, dwell_s=null where id=srow.id; cur := 'arriving';   -- rolling stop
        end if;
      else
        update ride_stops set dwell_s=dwell where id=srow.id;
      end if;
    end if;
    if cur='arriving' and d > miss_m then
      update ride_stops set status='missed', stopped_at=null, dwell_s=null where id=srow.id;
      if to_school then
        insert into ride_events(ride_id,type,note,child_id) values (rid,'missed_pickup','Possible missed pickup — the car left '||srow.child_name||' at the stop without stopping',srow.child_id);
        perform _notify(srow.parent_id,'Missed pickup? ⚠️','The carpool left your area without stopping — '||srow.child_name||' is NOT marked on board. Call the driver if this is unexpected.','trip');
        if drv is not null then perform _notify(drv,'Missed a pickup? ⚠️','It looks like '||srow.child_name||' was not picked up. Turn back, or their parent will make other arrangements.','trip'); end if;
      else
        insert into ride_events(ride_id,type,note,child_id) values (rid,'missed_pickup','Possible missed drop-off — the car passed '||srow.child_name||'''s home without stopping',srow.child_id);
        perform _notify(srow.parent_id,'Drop-off skipped? ⚠️','The carpool passed your home without stopping — '||srow.child_name||' is still on board. Call the driver.','trip');
        if drv is not null then perform _notify(drv,'Missed a drop-off? ⚠️','It looks like '||srow.child_name||' was not dropped at home. Please turn back.','trip'); end if;
      end if;
    end if;
  end loop;

  -- ---- the school gate ----
  select s.id, s.status, s.stopped_at into srow from ride_stops s where s.ride_id=rid and s.kind='school';
  if srow.id is not null and srow.status in ('pending','arriving','stopped') and km is not null then
    d := km*1000; cur := srow.status;
    if cur='pending' and d < near_m then
      update ride_stops set status='arriving', arrived_at=ts where id=srow.id; cur := 'arriving';
      insert into ride_events(ride_id,type,note) values (rid,'arriving','Arriving at the school gate');
      if to_school then for a in select _audience(cid) loop perform _notify(a,'Arriving at school 🏫','The carpool is reaching the school gate.','trip'); end loop; end if;
    end if;
    if to_school then
      if cur='arriving' and d < gate_m then
        update ride_stops set status='done', done_at=ts,
          delay_min = case when planned_at is null then null else round(extract(epoch from (ts - planned_at))/60)::int end where id=srow.id;
      end if;
    else
      if cur='arriving' and d < gate_m and stationary then
        update ride_stops set status='stopped', stopped_at=ts, dwell_s=0 where id=srow.id; cur := 'stopped';
        insert into ride_events(ride_id,type,note) values (rid,'stopped','Stopped at the school gate');
      elsif cur='stopped' then
        dwell := greatest(0, extract(epoch from (ts - srow.stopped_at)))::int;
        if d > gate_leave_m then
          if dwell >= st.dwell_s then
            update ride_stops set status='done', done_at=ts, dwell_s=dwell,
              delay_min = case when planned_at is null then null else round(extract(epoch from (ts - planned_at))/60)::int end where id=srow.id;
            for rrow in select ch.id from carpool_members m join profiles pr on pr.id=m.parent_id join children ch on ch.parent_id=pr.id
               where m.carpool_id=cid and m.status='joined' and _rider_status(cid, ch.id)='waiting'
                 and not exists(select 1 from absences ab where ab.carpool_id=cid and ab.child_id=ch.id and ab.on_date=current_date)
            loop perform _ev_board(rid, rrow.id, true); end loop;
          else
            update ride_stops set status='arriving', stopped_at=null, dwell_s=null where id=srow.id;
          end if;
        else
          update ride_stops set dwell_s=dwell where id=srow.id;
        end if;
      end if;
    end if;
  end if;
  -- school run: anyone still on board inside the gate fence has reached school
  if to_school and km is not null and km*1000 < gate_m then
    for rrow in select ch.id from carpool_members m join profiles pr on pr.id=m.parent_id join children ch on ch.parent_id=pr.id
       where m.carpool_id=cid and m.status='joined' and _rider_status(cid, ch.id)='boarded'
    loop perform _ev_drop(rid, rrow.id, 'school', true); end loop;
  end if;

  -- ---- home_end (home run): arriving alert only; completion is the auto-end below ----
  select s.id, s.status, s.lat, s.lng into srow from ride_stops s where s.ride_id=rid and s.kind='home_end';
  if srow.id is not null and srow.status='pending' and _dist_km(clat,clng,srow.lat,srow.lng)*1000 < near_m then
    update ride_stops set status='arriving', arrived_at=ts where id=srow.id;
    insert into ride_events(ride_id,type,note) values (rid,'arriving','Arriving at the organiser''s home');
  end if;

  -- ---- live ETAs for the remaining stops (returns the ETA of the final stop) ----
  e := _eta_pass(rid, clat, clng, _recent_speed_kmh(rid), ts, false);

  -- ---- anomalies ----
  -- off-route (> offroute_km from the planned corridor), once per trip
  d := _corridor_km(rid, clat, clng);
  if d is not null and d > st.offroute_km and not exists(select 1 from ride_events ev where ev.ride_id=rid and ev.type='route_alert') then
    insert into ride_events(ride_id,type,note) values (rid,'route_alert','Route alert — the car is ~'||round(d::numeric,1)||' km off the planned route');
    for a in select _audience(cid) loop perform _notify(a,'Route alert 🚨','The carpool is about '||round(d::numeric,1)||' km off its planned route. Open Track and call the driver if this is unexpected.','sos'); end loop;
    anomalies := anomalies || to_jsonb('route_alert'::text);
  end if;
  -- long stop: stationary ≥ long_stop_s away from every stop / the gate, once per stationary episode
  if stationary then
    near_any := exists(select 1 from ride_stops s where s.ride_id=rid
      and _dist_km(clat,clng,s.lat,s.lng)*1000 < case when s.kind in ('school','home_end') then greatest(stop_m, gate_m) else stop_m end);
    if not near_any then
      episode_start := coalesce(
        (select max(z.created_at) from (
            select q.created_at, q.lat, q.lng, lag(q.lat) over w plat, lag(q.lng) over w plng
              from (select p.id, p.lat, p.lng, p.created_at from ride_pings p where p.ride_id=rid order by p.id desc limit 200) q
            window w as (order by q.id)) z
          where z.plat is not null and _dist_km(z.plat,z.plng,z.lat,z.lng)*1000 >= st.stationary_m),
        (select min(p.created_at) from ride_pings p where p.ride_id=rid),
        (select r.started_at from rides r where r.id=rid));
      if extract(epoch from (ts - episode_start)) >= st.long_stop_s
         and not exists(select 1 from ride_events ev where ev.ride_id=rid and ev.type='anomaly_long_stop' and ev.created_at >= episode_start) then
        insert into ride_events(ride_id,type,note) values (rid,'anomaly_long_stop','Long stop — the car has been stationary for ~'||round(extract(epoch from (ts - episode_start))/60)||' min away from any stop');
        for a in select _audience(cid) loop perform _notify(a,'Long stop ⚠️','"'||nm||'" has been stationary for ~'||round(extract(epoch from (ts - episode_start))/60)||' min away from any stop. Check in with the driver.','trip'); end loop;
        anomalies := anomalies || to_jsonb('long_stop'::text);
      end if;
    end if;
  end if;
  -- speeding: ping-to-ping speed over the limit, interval ≥ 5 s, plausible distance (not a GPS teleport), max once per 5 min
  if p2p is not null and pdt >= 5 and pmove >= st.stationary_m and p2p > st.speed_max_kmh and p2p <= 250
     and not exists(select 1 from ride_events ev where ev.ride_id=rid and ev.type='anomaly_speed' and ev.created_at > ts - interval '5 minutes') then
    insert into ride_events(ride_id,type,note) values (rid,'anomaly_speed','Speeding — ~'||round(p2p)||' km/h between fixes (limit '||st.speed_max_kmh||' km/h)');
    for a in select _audience(cid) loop perform _notify(a,'Speeding ⚠️','"'||nm||'" was doing ~'||round(p2p)||' km/h (limit '||st.speed_max_kmh||').','trip'); end loop;
    anomalies := anomalies || to_jsonb('speed'::text);
  end if;

  -- ---- trail + car position ----
  update rides set last_lat=clat, last_lng=clng, last_heading=coalesce(app_post_location.heading,last_heading), last_update=ts where id=rid;
  insert into ride_pings(ride_id,lat,lng,eta_min,distance_km,speed_kmh,heading,created_at)
    values (rid,clat,clng,e,round(km::numeric,1),case when spd is null then null else round(spd::numeric,1) end,
            case when app_post_location.heading is null then null else round(app_post_location.heading::numeric,1) end,ts);

  -- ---- AUTO END: every travelling child accounted for (dropped, or flagged missed) ----
  select count(*),
    count(*) filter (where pr.id <> fam),
    count(*) filter (where pr.id <> fam and (_rider_status(cid, ch.id)='dropped' or exists(select 1 from ride_stops s where s.ride_id=rid and s.child_id=ch.id and s.status='missed'))),
    count(*) filter (where pr.id = fam)
    into fin_total, oth_total, oth_done, own_total
    from carpool_members m join profiles pr on pr.id=m.parent_id join children ch on ch.parent_id=pr.id
   where m.carpool_id=cid and m.status='joined'
     and not exists(select 1 from absences ab where ab.carpool_id=cid and ab.child_id=ch.id and ab.on_date=current_date);
  all_done := (select bool_and(_rider_status(cid, ch.id)='dropped' or exists(select 1 from ride_stops s where s.ride_id=rid and s.child_id=ch.id and s.status='missed'))
    from carpool_members m join children ch on ch.parent_id=m.parent_id where m.carpool_id=cid and m.status='joined'
      and not exists(select 1 from absences ab where ab.carpool_id=cid and ab.child_id=ch.id and ab.on_date=current_date));
  school_done := exists(select 1 from ride_stops s where s.ride_id=rid and s.kind='school' and s.status='done')
              or exists(select 1 from ride_events ev where ev.ride_id=rid and ev.type='reached_school');
  if fin_total > 0 then
    if to_school and all_done and school_done then
      perform _end_ride(rid, 'Trip completed — everyone reached school'); ended := true;
    elsif (not to_school) and oth_done = oth_total then
      if own_total = 0 and exists(select 1 from ride_events ev where ev.ride_id=rid and ev.type='reached_home') then
        update ride_stops set status='skipped' where ride_id=rid and kind='home_end' and status in ('pending','arriving');
        perform _end_ride(rid, 'Trip completed — everyone reached home'); ended := true;
      elsif own_total > 0 then
        select home_lat, home_lng into fh_lat, fh_lng from profiles where id=fam;
        if fh_lat is not null and _dist_km(clat,clng,fh_lat,fh_lng)*1000 < leave_m then
          update ride_stops set status='done', done_at=ts,
            delay_min = case when planned_at is null then null else round(extract(epoch from (ts - planned_at))/60)::int end
           where ride_id=rid and kind='home_end' and status in ('pending','arriving');
          perform _end_ride(rid, 'Trip completed — everyone reached home'); ended := true;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('ride_id',rid,'lat',clat,'lng',clng,'eta_min',e,'distance_km',round(km::numeric,1),
    'stops',_stops_json(rid),'ended',ended,'anomalies',anomalies);
end $$;

-- The stops array alone (cheap refetch for the realtime backup path).
create or replace function app_ride_stops(ride_id uuid) returns jsonb language sql stable security definer as $$
  select _stops_json(ride_id)
$$;

create or replace function app_ride_event(ride_id uuid, type text, note text, child_id uuid default null) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  if not _ride_active(app_ride_event.ride_id) then raise exception 'This trip has already ended.'; end if;
  if not _can_act_on_ride(app_ride_event.ride_id) then raise exception 'Only people on this carpool can report trip events'; end if;
  if type = 'sos' then raise exception 'SOS has been removed — call the driver or the school office directly.'; end if;
  insert into ride_events(ride_id,type,note,child_id) values (app_ride_event.ride_id,app_ride_event.type,app_ride_event.note,app_ride_event.child_id);
  return jsonb_build_object('ok',true);
end $$;

-- Manual board (driver/parent tap): the child's pickup stop is done.
create or replace function app_ride_board(ride_id uuid, child_id uuid, pin text default null) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare ts timestamptz := clock_timestamp();
begin
  if not _ride_active(app_ride_board.ride_id) then raise exception 'This trip has already ended.'; end if;
  if not _can_act_on_ride(app_ride_board.ride_id) then raise exception 'Only the trip driver or a carpool member can board children'; end if;
  perform _ev_board(app_ride_board.ride_id, app_ride_board.child_id, false);
  update ride_stops set status='done', done_at=ts, stopped_at=coalesce(stopped_at,ts), arrived_at=coalesce(arrived_at,ts),
      delay_min = case when planned_at is null then null else round(extract(epoch from (ts - planned_at))/60)::int end
    where ride_id=app_ride_board.ride_id and child_id=app_ride_board.child_id and kind='pickup' and status <> 'done';
  return jsonb_build_object('ok',true);
end $$;

-- Parent correction ("Didn't board?"): revert the check-in, alert the carpool,
-- and RE-ARM the child's stop (any state → pending).
create or replace function app_ride_unboard(ride_id uuid, child_id uuid) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare kidname text; a uuid; cid uuid;
begin
  if not _ride_active(app_ride_unboard.ride_id) then raise exception 'This trip has already ended.'; end if;
  if not _can_act_on_ride(app_ride_unboard.ride_id) then raise exception 'Only people on this carpool can correct a check-in'; end if;
  select name into kidname from children where id=app_ride_unboard.child_id;
  insert into ride_events(ride_id,type,note,child_id) values (app_ride_unboard.ride_id,'unboarded',kidname||' — NOT on board (corrected by parent)',app_ride_unboard.child_id);
  update ride_stops set status='pending', arrived_at=null, stopped_at=null, done_at=null, dwell_s=null, delay_min=null
    where ride_id=app_ride_unboard.ride_id and child_id=app_ride_unboard.child_id and kind in ('pickup','drop');
  select carpool_id into cid from rides where id=app_ride_unboard.ride_id;
  for a in select _audience(cid) loop perform _notify(a,'Correction ⚠️', kidname||' is NOT on board — their parent corrected the check-in. Driver, please check.','trip'); end loop;
  return jsonb_build_object('ok',true);
end $$;

-- Manual drop: a home drop completes the child's drop stop.
create or replace function app_ride_drop(ride_id uuid, child_id uuid, place text default 'school') returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare ts timestamptz := clock_timestamp();
begin
  if not _ride_active(app_ride_drop.ride_id) then raise exception 'This trip has already ended.'; end if;
  if not _can_act_on_ride(app_ride_drop.ride_id) then raise exception 'Only the trip driver or a carpool member can record a drop'; end if;
  perform _ev_drop(app_ride_drop.ride_id, app_ride_drop.child_id, app_ride_drop.place, false);
  if app_ride_drop.place = 'home' then
    update ride_stops set status='done', done_at=ts, stopped_at=coalesce(stopped_at,ts), arrived_at=coalesce(arrived_at,ts),
        delay_min = case when planned_at is null then null else round(extract(epoch from (ts - planned_at))/60)::int end
      where ride_id=app_ride_drop.ride_id and child_id=app_ride_drop.child_id and kind='drop' and status <> 'done';
  end if;
  return jsonb_build_object('ok',true);
end $$;

-- Absence today: the child's stop on the live trip (if any) is skipped; un-marking re-arms it.
create or replace function app_set_absence(carpool_id uuid, child_id uuid, absent boolean) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  if not exists(select 1 from children where id=app_set_absence.child_id and parent_id=_anchor()) then
    raise exception 'You can only mark your own child absent.';
  end if;
  if absent then
    insert into absences(carpool_id,child_id,on_date) values (app_set_absence.carpool_id, app_set_absence.child_id, current_date) on conflict do nothing;
    update ride_stops s set status='skipped' from rides r where r.id=s.ride_id and r.carpool_id=app_set_absence.carpool_id and r.status='active'
      and s.child_id=app_set_absence.child_id and s.status in ('pending','arriving','stopped');
  else
    delete from absences where carpool_id=app_set_absence.carpool_id and child_id=app_set_absence.child_id and on_date=current_date;
    update ride_stops s set status='pending' from rides r where r.id=s.ride_id and r.carpool_id=app_set_absence.carpool_id and r.status='active'
      and s.child_id=app_set_absence.child_id and s.status='skipped';
  end if;
  return _carpool_json(app_set_absence.carpool_id, auth.uid());
end $$;

create or replace function app_end_ride(ride_id uuid) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  if not (_is_admin() or exists(select 1 from rides r where r.id=app_end_ride.ride_id and (
      r.driver_user_id = auth.uid() or r.carpool_id in (select carpool_id from carpool_members where status='joined' and parent_id=_anchor())))) then
    raise exception 'Only the trip driver, a member, or the school admin can end the ride';
  end if;
  perform _end_ride(app_end_ride.ride_id, 'Trip completed');
  return jsonb_build_object('ok',true);
end $$;

-- TripSummary rows: punctuality + stop counts per completed trip.
create or replace function app_trip_history() returns jsonb language plpgsql security definer as $$
begin
  perform _sweep_stale_rides();
  return coalesce((select jsonb_agg(j order by st desc) from (
    select r.started_at st, jsonb_build_object(
      'id',r.id,'carpool_id',r.carpool_id,'carpool_name',c.name,'direction',coalesce(r.direction,'to_school'),
      'driver_name',r.driver_name,'started_at',r.started_at,'ended_at',r.ended_at,
      'on_time',r.on_time,'duration_min',r.actual_duration_min,'distance_km',r.distance_km,
      'missed_count',(select count(*) from ride_stops s where s.ride_id=r.id and s.status='missed'),
      'stops_done',(select count(*) from ride_stops s where s.ride_id=r.id and s.status='done'),
      'stops_total',(select count(*) from ride_stops s where s.ride_id=r.id and s.status <> 'skipped'),
      'events',_events_json(r.id)) j
    from rides r join carpools c on c.id=r.carpool_id
    where r.status <> 'active' and (_is_admin() or r.driver_user_id=auth.uid()
       or r.carpool_id in (select carpool_id from carpool_members where status='joined' and parent_id=_anchor()))
    order by r.started_at desc limit 30) sub),'[]'::jsonb);
end $$;

-- Replay: the full ping trail (with speed/heading) + stops + events for a trip the
-- caller belongs to (carpool member, the driver, or the admin).
create or replace function app_trip_replay(ride_id uuid) returns jsonb language plpgsql stable security definer as $$
#variable_conflict use_column
declare rid uuid := app_trip_replay.ride_id;
begin
  if not exists(select 1 from rides r where r.id=rid) then raise exception 'Trip not found'; end if;
  if not (_is_admin() or exists(select 1 from rides r where r.id=rid and (
      r.driver_user_id = auth.uid() or r.carpool_id in (select carpool_id from carpool_members where status='joined' and parent_id=_anchor())))) then
    raise exception 'You are not part of this trip';
  end if;
  return jsonb_build_object(
    'ride',_ride_json(rid),
    'stops',_stops_json(rid),
    'pings',coalesce((select jsonb_agg(jsonb_build_object('lat',p.lat,'lng',p.lng,'speed_kmh',p.speed_kmh,'heading',p.heading,
        'eta_min',p.eta_min,'distance_km',p.distance_km,'created_at',p.created_at) order by p.id) from ride_pings p where p.ride_id=rid),'[]'::jsonb),
    'events',_events_json(rid));
end $$;

-- ---- punctuality analytics (SPEC §3) ------------------------------------
-- cid null = school-wide. missed_rate is a FRACTION (0..1) of child stops; on_time_pct is 0..100.
create or replace function _carpool_stats(cid uuid) returns jsonb language plpgsql stable as $$
declare trips int; otp numeric; ad numeric; apd numeric; mr numeric; tr jsonb;
begin
  select count(*),
         round(100.0 * count(*) filter (where r.on_time) / nullif(count(*) filter (where r.on_time is not null),0), 0),
         round(avg(r.actual_duration_min)::numeric, 1)
    into trips, otp, ad
    from rides r where r.status='completed' and (cid is null or r.carpool_id=cid);
  select round(avg(s.delay_min) filter (where s.status='done')::numeric, 1),
         round((count(*) filter (where s.status='missed'))::numeric / nullif(count(*) filter (where s.status <> 'skipped'),0), 3)
    into apd, mr
    from ride_stops s join rides r on r.id=s.ride_id
   where r.status='completed' and (cid is null or r.carpool_id=cid) and s.kind in ('pickup','drop');
  tr := coalesce((select jsonb_agg(q.j order by q.st) from (
      select r.started_at st, jsonb_build_object(
        'date', to_char(r.started_at at time zone 'Asia/Kolkata','YYYY-MM-DD'),
        'on_time', r.on_time, 'duration_min', r.actual_duration_min,
        'delay_min', (select round(avg(s.delay_min))::int from ride_stops s where s.ride_id=r.id and s.kind in ('pickup','drop') and s.status='done')) j
        from rides r where r.status='completed' and (cid is null or r.carpool_id=cid)
        order by r.started_at desc limit 10) q),'[]'::jsonb);
  return jsonb_build_object('trips',trips,'on_time_pct',otp,'avg_pickup_delay_min',apd,'missed_rate',mr,'avg_duration_min',ad,'trend',tr);
end $$;

create or replace function app_carpool_stats(carpool_id uuid) returns jsonb language plpgsql stable security definer as $$
#variable_conflict use_column
begin
  if not (_is_admin()
    or exists(select 1 from carpool_members where carpool_id=app_carpool_stats.carpool_id and parent_id=_anchor() and status='joined')
    or exists(select 1 from carpools where id=app_carpool_stats.carpool_id and creator_id=auth.uid())) then
    raise exception 'You are not part of this carpool';
  end if;
  return _carpool_stats(app_carpool_stats.carpool_id);
end $$;

-- ------------------------------------------------- driver profile / docs ----
create or replace function app_get_driver_profile() returns jsonb language sql stable security definer as $$ select _profile_json(auth.uid()) $$;
create or replace function app_update_driver_profile(patch jsonb) returns jsonb language plpgsql security definer as $$
begin
  update profiles set vehicle = coalesce(vehicle,'{}'::jsonb) || coalesce(patch->'vehicle','{}'::jsonb),
    photo_url = coalesce(patch->>'photo_url', photo_url), phone = coalesce(patch->>'phone', phone) where id=auth.uid();
  return _profile_json(auth.uid());
end $$;
create or replace function _recompute_driver(did uuid) returns void language plpgsql security definer as $$
declare okd boolean;
begin
  okd := exists(select 1 from driver_documents where driver_id=did and type='licence' and (expiry is null or expiry>=current_date))
     and exists(select 1 from driver_documents where driver_id=did and type='insurance' and (expiry is null or expiry>=current_date));
  update profiles set driver_status = case when okd then 'verified' else 'incomplete' end where id=did and role='addon' and relation='driver';
end $$;
create or replace function app_add_driver_doc(doc jsonb) returns jsonb language plpgsql security definer as $$
begin
  insert into driver_documents(driver_id,type,number,expiry,status) values (auth.uid(),doc->>'type',doc->>'number',(doc->>'expiry')::date,'verified');
  perform _recompute_driver(auth.uid());
  return _profile_json(auth.uid());
end $$;
create or replace function app_remove_driver_doc(doc_id uuid) returns jsonb language plpgsql security definer as $$
begin delete from driver_documents where id=doc_id and driver_id=auth.uid(); perform _recompute_driver(auth.uid()); return _profile_json(auth.uid()); end $$;
create or replace function app_my_driver_carpools() returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_agg(_carpool_json(m.carpool_id, auth.uid())),'[]'::jsonb)
    from carpool_members m where m.parent_id=_anchor() and m.status='joined'
$$;

create or replace function app_update_child(child_id uuid, patch jsonb) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  update children set name=coalesce(nullif(trim(patch->>'name'),''),name), class_level=coalesce((patch->>'class_level')::int,class_level),
    allergies=coalesce(patch->>'allergies',allergies), emergency_name=coalesce(patch->>'emergency_name',emergency_name),
    emergency_phone=coalesce(patch->>'emergency_phone',emergency_phone), gender=coalesce(patch->>'gender',gender)
  where id=app_update_child.child_id and parent_id=auth.uid();
  return _profile_json(auth.uid());
end $$;

create or replace function app_add_trusted(t jsonb) returns jsonb language plpgsql security definer as $$
begin insert into trusted_pickups(parent_id,name,phone) values (auth.uid(),t->>'name',t->>'phone'); return _profile_json(auth.uid()); end $$;
drop function if exists app_remove_trusted(uuid);
create or replace function app_remove_trusted(trusted_id uuid) returns jsonb language plpgsql security definer as $$
begin delete from trusted_pickups t where t.id=trusted_id and t.parent_id=auth.uid(); return _profile_json(auth.uid()); end $$;

-- ---------------------------------------------------------------- chat ----
-- Chat is private to the carpool: joined households (incl. their add-ons) and the school admin.
create or replace function _chat_member(cid uuid) returns boolean language sql stable as $$
  select _is_admin() or exists(select 1 from carpool_members m where m.carpool_id=cid and m.status='joined' and m.parent_id=_anchor())
$$;
create or replace function app_get_chat(carpool_id uuid) returns jsonb language plpgsql stable security definer as $$
#variable_conflict use_column
begin
  if not _chat_member(app_get_chat.carpool_id) then raise exception 'Only members of this carpool can read its chat.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'carpool_id',m.carpool_id,'sender_id',m.sender_id,
    'sender_name',(select name from profiles where id=m.sender_id),'body',m.body,'created_at',m.created_at) order by m.created_at),'[]'::jsonb)
  from chat_messages m where m.carpool_id=app_get_chat.carpool_id);
end $$;
create or replace function app_send_chat(carpool_id uuid, body text) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare mid uuid; myname text; a uuid;
begin
  if not _chat_member(app_send_chat.carpool_id) then raise exception 'Only members of this carpool can post in its chat.'; end if;
  if coalesce(trim(app_send_chat.body),'') = '' then raise exception 'Message is empty.'; end if;
  insert into chat_messages(carpool_id,sender_id,body) values (app_send_chat.carpool_id, auth.uid(), left(app_send_chat.body, 1000)) returning id into mid;
  select name into myname from profiles where id=auth.uid();
  for a in select _audience(app_send_chat.carpool_id) loop if a<>auth.uid() then perform _notify(a,'New message',myname||': '||left(body,40),'chat'); end if; end loop;
  return jsonb_build_object('id',mid,'carpool_id',carpool_id,'sender_id',auth.uid(),'sender_name',myname,'body',body,'created_at',now());
end $$;

-- --------------------------------------------------------- notifications ----
create or replace function app_notifications() returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'kind',kind,'read',read,'created_at',created_at) order by created_at desc),'[]'::jsonb)
  from notifications where user_id=auth.uid()
$$;
create or replace function app_mark_notifications_read() returns jsonb language plpgsql security definer as $$
begin update notifications set read=true where user_id=auth.uid(); return jsonb_build_object('ok',true); end $$;

-- --------------------------------------------------------------- admin ----
create or replace function app_admin_registrations(status text default 'pending') returns jsonb language plpgsql stable security definer as $$
#variable_conflict use_column
begin
  if not _is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(_profile_json(p.id)) from profiles p where p.role='parent' and p.status=app_admin_registrations.status),'[]'::jsonb);
end $$;
create or replace function app_admin_decision(user_id uuid, decision text, reason text default null) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  if not _is_admin() then raise exception 'admin only'; end if;
  update profiles set status=decision where id=app_admin_decision.user_id;
  perform _notify(app_admin_decision.user_id, case when decision='approved' then 'Registration approved ✅' else 'Registration not approved' end,
    case when decision='approved' then 'You can now find families and create carpools.' else coalesce(reason,'Please contact the school office.') end,
    case when decision='approved' then 'approved' else 'info' end);
  return jsonb_build_object('ok',true);
end $$;
create or replace function app_admin_stats() returns jsonb language plpgsql stable security definer as $$
declare s jsonb := app_get_school();
begin
  if not _is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'pending',(select count(*) from profiles where role='parent' and status='pending'),
    'approved',(select count(*) from profiles where role='parent' and status='approved'),
    'rejected',(select count(*) from profiles where role='parent' and status='rejected'),
    'carpools',(select count(*) from carpools),'live',(select count(*) from rides where status='active'),
    'addons',(select count(*) from profiles where role='addon'),'academic_year',2026,'school',s);
end $$;
create or replace function app_admin_carpools() returns jsonb language plpgsql stable security definer as $$
begin if not _is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(_carpool_json(id, auth.uid())) from carpools),'[]'::jsonb); end $$;
create or replace function app_publish_tnc(body text) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare v int; a uuid;
begin
  if not _is_admin() then raise exception 'admin only'; end if;
  v := _latest_tnc()+1; insert into tnc(version,body) values (v, app_publish_tnc.body);
  for a in select id from profiles where role='parent' loop perform _notify(a,'Terms updated','New Terms & Conditions (v'||v||'). Please review and accept.','system'); end loop;
  return jsonb_build_object('version',v);
end $$;
create or replace function app_admin_tnc_list() returns jsonb language plpgsql stable security definer as $$
begin if not _is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.version desc) from tnc t),'[]'::jsonb); end $$;
create or replace function app_set_school(name text, lat double precision, lng double precision) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin if not _is_admin() then raise exception 'admin only'; end if;
  update settings set school_name=app_set_school.name, school_lat=app_set_school.lat, school_lng=app_set_school.lng where id=1;
  return app_get_school(); end $$;
create or replace function app_promote_year() returns jsonb language plpgsql security definer as $$
begin if not _is_admin() then raise exception 'admin only'; end if;
  update children set class_level = case when class_level>=12 then 13 else class_level+1 end;
  return jsonb_build_object('academic_year',2027); end $$;
create or replace function app_admin_broadcast(title text, body text) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
declare bid uuid; a uuid;
begin if not _is_admin() then raise exception 'admin only'; end if;
  insert into broadcasts(title,body) values (app_admin_broadcast.title, app_admin_broadcast.body) returning id into bid;
  for a in select id from profiles where role='parent' loop perform _notify(a,'📢 '||title, body,'system'); end loop;
  return jsonb_build_object('id',bid,'title',title,'body',body,'created_at',now());
end $$;
create or replace function app_get_broadcasts() returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at desc),'[]'::jsonb) from broadcasts b
$$;
create or replace function app_admin_attendance() returns jsonb language plpgsql stable security definer as $$
begin if not _is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'child_name',ch.name,'parent_name',pr.name,'carpool',c.name,'reached_at',e.created_at) order by e.created_at desc)
    from ride_events e join rides r on r.id=e.ride_id join carpools c on c.id=r.carpool_id
    left join children ch on ch.id=e.child_id left join profiles pr on pr.id=ch.parent_id
    where e.type in ('reached_school','reached_home')),'[]'::jsonb);
end $$;
-- AdminAnalytics = school-wide CarpoolStats + registration funnel + per-carpool table.
create or replace function app_admin_analytics() returns jsonb language plpgsql stable security definer as $$
declare ap int; matched int;
begin
  if not _is_admin() then raise exception 'admin only'; end if;
  ap := (select count(*) from profiles where role='parent' and status='approved');
  matched := (select count(distinct p.id) from profiles p join carpool_members m on m.parent_id=p.id where p.status='approved' and m.status='joined');
  return _carpool_stats(null) || jsonb_build_object('approved',ap,'matched',matched,'unmatched',ap-matched,
    'completed_trips',(select count(*) from rides where status='completed'),
    'arrivals',(select count(*) from ride_events where type in ('reached_school','reached_home')),
    'per_carpool',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'stats',_carpool_stats(c.id)) order by c.name) from carpools c),'[]'::jsonb));
end $$;
-- Incident log: anomalies + missed stops + off-route, newest first (Incident shape).
create or replace function app_admin_incidents() returns jsonb language plpgsql stable security definer as $$
begin if not _is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'ride_id',e.ride_id,'carpool',coalesce(c.name,'—'),'type',e.type,
      'note',coalesce(e.note,e.type),'child_name',(select name from children where id=e.child_id),'created_at',e.created_at) order by e.created_at desc)
    from (select * from ride_events where type in ('route_alert','missed_pickup','anomaly_long_stop','anomaly_speed') order by created_at desc limit 300) e
    join rides r on r.id=e.ride_id join carpools c on c.id=r.carpool_id),'[]'::jsonb);
end $$;

-- ------------------------------------------------------------ settings ----
-- Settings shape (types.ts). Any signed-in user may read; only the admin writes.
-- Public (pre-login) config: whether demo quick-logins are seeded (seed_demo.sql).
alter table settings add column if not exists demo_logins boolean not null default false;
create or replace function app_public_config() returns jsonb language sql stable security definer as $$
  select jsonb_build_object('demo_logins', coalesce(demo_logins,false), 'school_name', school_name) from settings where id=1
$$;
grant execute on function app_public_config() to anon, authenticated;

create or replace function app_get_settings() returns jsonb language plpgsql stable security definer as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return (select jsonb_build_object(
    'school_name',school_name,'school_lat',school_lat,'school_lng',school_lng,
    'fence_near_m',fence_near_m,'fence_stop_m',fence_stop_m,'fence_leave_m',fence_leave_m,'fence_miss_m',fence_miss_m,
    'dwell_s',dwell_s,'stationary_m',stationary_m,'school_gate_m',school_gate_m,'offroute_km',offroute_km,
    'long_stop_s',long_stop_s,'speed_max_kmh',speed_max_kmh,
    'school_start_time',to_char(school_start_time,'HH24:MI'),'school_end_time',to_char(school_end_time,'HH24:MI'),
    'city_speed_kmh',city_speed_kmh,'road_factor',road_factor) from settings where id=1);
end $$;

create or replace function _patch_int(patch jsonb, k text, cur int, lo int, hi int) returns int language plpgsql immutable as $$
declare v int;
begin
  if not (patch ? k) or patch->>k is null then return cur; end if;
  begin v := round((patch->>k)::numeric)::int; exception when others then raise exception '% must be a number', k; end;
  if v < lo or v > hi then raise exception '% must be between % and %', k, lo, hi; end if;
  return v;
end $$;
create or replace function _patch_num(patch jsonb, k text, cur numeric, lo numeric, hi numeric) returns numeric language plpgsql immutable as $$
declare v numeric;
begin
  if not (patch ? k) or patch->>k is null then return cur; end if;
  begin v := (patch->>k)::numeric; exception when others then raise exception '% must be a number', k; end;
  if v < lo or v > hi then raise exception '% must be between % and %', k, lo, hi; end if;
  return v;
end $$;
create or replace function _patch_time(patch jsonb, k text, cur time) returns time language plpgsql immutable as $$
declare v time;
begin
  if not (patch ? k) or patch->>k is null then return cur; end if;
  begin v := (patch->>k)::time; exception when others then raise exception '% must be a time like 07:50', k; end;
  return v;
end $$;

create or replace function app_set_settings(patch jsonb) returns jsonb language plpgsql security definer as $$
declare st settings%rowtype := _settings(); n_stop int; n_leave int; n_miss int; n_near int;
begin
  if not _is_admin() then raise exception 'admin only'; end if;
  n_near := _patch_int(patch,'fence_near_m',st.fence_near_m,50,5000);
  n_stop := _patch_int(patch,'fence_stop_m',st.fence_stop_m,20,2000);
  n_leave := _patch_int(patch,'fence_leave_m',st.fence_leave_m,30,3000);
  n_miss := _patch_int(patch,'fence_miss_m',st.fence_miss_m,50,5000);
  if not (n_stop < n_leave and n_leave <= n_miss) then raise exception 'Fences must satisfy stop < leave ≤ miss'; end if;
  update settings set
    school_name = coalesce(nullif(trim(patch->>'school_name'),''), school_name),
    school_lat = coalesce(_patch_num(patch,'school_lat',null,-90,90)::double precision, school_lat),
    school_lng = coalesce(_patch_num(patch,'school_lng',null,-180,180)::double precision, school_lng),
    fence_near_m = n_near, fence_stop_m = n_stop, fence_leave_m = n_leave, fence_miss_m = n_miss,
    dwell_s = _patch_int(patch,'dwell_s',st.dwell_s,1,600),
    stationary_m = _patch_int(patch,'stationary_m',st.stationary_m,5,500),
    school_gate_m = _patch_int(patch,'school_gate_m',st.school_gate_m,50,2000),
    offroute_km = _patch_num(patch,'offroute_km',st.offroute_km,0.2,50),
    long_stop_s = _patch_int(patch,'long_stop_s',st.long_stop_s,30,7200),
    speed_max_kmh = _patch_int(patch,'speed_max_kmh',st.speed_max_kmh,20,200),
    school_start_time = _patch_time(patch,'school_start_time',st.school_start_time),
    school_end_time = _patch_time(patch,'school_end_time',st.school_end_time),
    city_speed_kmh = _patch_int(patch,'city_speed_kmh',st.city_speed_kmh,5,120),
    road_factor = _patch_num(patch,'road_factor',st.road_factor,1,3),
    vapid_public_key = case when patch ? 'vapid_public_key' then nullif(trim(patch->>'vapid_public_key'),'') else vapid_public_key end
  where id=1;
  return app_get_settings();
end $$;

-- ------------------------------------------------------------ web push ----
create or replace function app_push_public_key() returns text language sql stable security definer as $$
  select vapid_public_key from settings where id=1
$$;
create or replace function app_save_push_subscription(sub jsonb, ua text default null) returns jsonb language plpgsql security definer as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(sub->>'endpoint','')='' or coalesce(sub->'keys'->>'p256dh','')='' or coalesce(sub->'keys'->>'auth','')='' then
    raise exception 'Invalid push subscription';
  end if;
  insert into push_subscriptions(endpoint,user_id,p256dh,auth,ua)
    values (sub->>'endpoint', auth.uid(), sub->'keys'->>'p256dh', sub->'keys'->>'auth', left(app_save_push_subscription.ua, 300))
    on conflict (endpoint) do update set user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, ua=excluded.ua, created_at=now();
  return jsonb_build_object('ok',true);
end $$;
create or replace function app_remove_push_subscription(endpoint text) returns jsonb language plpgsql security definer as $$
#variable_conflict use_column
begin
  delete from push_subscriptions where endpoint=app_remove_push_subscription.endpoint and user_id=auth.uid();
  return jsonb_build_object('ok',true);
end $$;

-- ----------------------------------------------------------------- RLS ----
alter table profiles enable row level security;
alter table children enable row level security;
alter table addon_invites enable row level security;
alter table carpools enable row level security;
alter table carpool_members enable row level security;
alter table rides enable row level security;
alter table ride_pings enable row level security;
alter table ride_events enable row level security;
alter table absences enable row level security;
alter table chat_messages enable row level security;
alter table notifications enable row level security;
alter table tnc enable row level security;
alter table settings enable row level security;
alter table driver_documents enable row level security;
alter table trusted_pickups enable row level security;
alter table broadcasts enable row level security;
alter table ride_stops enable row level security;
alter table push_subscriptions enable row level security;

do $$ begin
  -- readable-to-authenticated tables (writes still go through SECURITY DEFINER RPCs)
  if not exists (select 1 from pg_policies where tablename='settings' and policyname='read_settings') then
    create policy read_settings on settings for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='tnc' and policyname='read_tnc') then
    create policy read_tnc on tnc for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='read_profiles') then
    create policy read_profiles on profiles for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='children' and policyname='read_children') then
    create policy read_children on children for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='carpools' and policyname='read_carpools') then
    create policy read_carpools on carpools for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='carpool_members' and policyname='read_members') then
    create policy read_members on carpool_members for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='rides' and policyname='read_rides') then
    create policy read_rides on rides for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='ride_pings' and policyname='read_pings') then
    create policy read_pings on ride_pings for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='ride_events' and policyname='read_events') then
    create policy read_events on ride_events for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='chat_messages' and policyname='read_chat') then
    create policy read_chat on chat_messages for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='read_notifs') then
    create policy read_notifs on notifications for select using (user_id = auth.uid()); end if;
  if not exists (select 1 from pg_policies where tablename='broadcasts' and policyname='read_broadcasts') then
    create policy read_broadcasts on broadcasts for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='driver_documents' and policyname='read_docs') then
    create policy read_docs on driver_documents for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='trusted_pickups' and policyname='read_trusted') then
    create policy read_trusted on trusted_pickups for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='absences' and policyname='read_absences') then
    create policy read_absences on absences for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='addon_invites' and policyname='read_invites') then
    create policy read_invites on addon_invites for select using (true); end if;
  -- v8: stop rail is readable like ride_events; push subscriptions are private to their owner
  if not exists (select 1 from pg_policies where tablename='ride_stops' and policyname='read_stops') then
    create policy read_stops on ride_stops for select using (true); end if;
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='read_own_push') then
    create policy read_own_push on push_subscriptions for select using (user_id = auth.uid()); end if;
end $$;

-- --------------------------------------------------------- realtime pub ----
-- Each table is added in its own block so a table already in the publication
-- never blocks the others (re-runnable).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array['ride_pings','ride_events','ride_stops','rides','notifications','chat_messages','push_subscriptions'] loop
      begin execute format('alter publication supabase_realtime add table %I', t);
      exception when duplicate_object then null; when others then null; end;
    end loop;
  end if;
end $$;

-- ============================================================================
-- WEB PUSH — Database Webhook setup (Supabase dashboard → Database → Webhooks)
--
--   Name:      push-on-notification
--   Table:     public.notifications
--   Events:    INSERT
--   Type:      Supabase Edge Function  →  function `push`
--   Method:    POST   (default headers; the dashboard adds the service-role
--              Authorization header for you when you pick an Edge Function)
--
-- Every _notify() call inserts one notifications row per recipient, so the
-- `push` Edge Function receives {type:'INSERT', table:'notifications',
-- record:{id,user_id,title,body,kind,read,created_at}}. The function looks up
-- public.push_subscriptions where user_id = record.user_id (service role
-- bypasses RLS), sends a Web Push (VAPID) to each endpoint, and deletes rows
-- whose endpoint returns 404/410 (expired). The VAPID public key is published
-- to browsers via app_push_public_key() (settings.vapid_public_key — set it with
-- app_set_settings('{"vapid_public_key":"..."}') as the admin); the private key
-- lives only in the Edge Function's secrets (VAPID_PRIVATE_KEY, VAPID_SUBJECT).
-- The in-app inbox (app_notifications + realtime on `notifications`) remains
-- the fallback when push is unavailable.
--
-- After running: sign up once in the app with your admin email + password, then
--   update profiles set role='admin', status='approved' where email='YOUR_EMAIL';
-- ============================================================================
