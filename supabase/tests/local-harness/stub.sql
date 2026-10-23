-- Minimal stand-in for the parts of a Supabase project that the migrations
-- rely on. Local testing only: this is close to, not identical to, Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create schema auth;
create schema storage;

create table auth.users (
  instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text,
  email text, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  confirmation_token text, email_change text, email_change_token_new text, recovery_token text,
  phone text, last_sign_in_at timestamptz, is_sso_user boolean default false, deleted_at timestamptz
);
create unique index users_email_partial_key on auth.users (email) where is_sso_user = false;
create table auth.identities (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb, provider text, provider_id text, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz, email text
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
create function auth.email() returns text language sql stable as $$
  select auth.jwt() ->> 'email'
$$;

create table storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create policy buckets_read on storage.buckets for select using (true);
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;
create function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create publication supabase_realtime;

-- Supabase default grants.
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
