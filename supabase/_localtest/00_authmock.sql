-- Mock the Supabase auth surface so schema.sql runs on a plain Postgres.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
-- auth.uid() reads a session GUC the harness sets per "logged-in" user.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;
-- tiny assert helper for the scenario
create or replace function _assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'ok: %', label;
  else raise exception 'ASSERT FAILED: %', label; end if;
end $$;
-- Supabase's API roles, so GRANTs in schema.sql are valid on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
