-- The admin Team directory reads employees, attendance logs, departments, and
-- profiles through the document-shaped client (parent_id, data, auth_id).
-- Hosted companies use relational employees/attendance_logs and had no
-- profiles or departments tables, which surfaced as
-- "column employees.parent_id does not exist" and GET /profiles 404.

alter table public.employees
  add column if not exists parent_id text,
  add column if not exists collection_name text,
  add column if not exists auth_id uuid,
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.attendance_logs
  add column if not exists parent_id text,
  add column if not exists collection_name text,
  add column if not exists auth_id uuid,
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'full_name'
  ) then
    update public.employees e
    set
      auth_id = coalesce(e.auth_id, e.user_id),
      data = jsonb_strip_nulls(jsonb_build_object(
        'orgId', e.org_id::text,
        'uid', e.user_id::text,
        'employeeId', e.id::text,
        'email', e.email,
        'fullName', e.full_name,
        'displayName', e.full_name,
        'name', e.full_name,
        'role', coalesce((
          select m.role
          from public.org_members m
          where m.user_id = e.user_id
            and m.org_id = e.org_id
          limit 1
        ), 'employee')
      )),
      updated_at = now()
    where e.data is null or e.data = '{}'::jsonb;
  end if;
end $$;

create table if not exists public.profiles (
  id text primary key,
  org_id text,
  user_id text,
  parent_id text,
  collection_name text,
  auth_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_auth_id_idx on public.profiles (auth_id);
create index if not exists profiles_org_idx on public.profiles (org_id);

alter table public.profiles enable row level security;

do $$
begin
  if to_regprocedure('private.member_org_ids_with_roles(text[])') is null then
    return;
  end if;

  execute 'drop policy if exists profiles_select on public.profiles';
  execute 'drop policy if exists profiles_write on public.profiles';

  execute $pol$
    create policy profiles_select on public.profiles
      for select to authenticated
      using (
        auth_id = auth.uid()
        or id = auth.uid()::text
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin', 'employee'])
          )
        )
      )
  $pol$;

  execute $pol$
    create policy profiles_write on public.profiles
      for all to authenticated
      using (
        auth_id = auth.uid()
        or id = auth.uid()::text
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
      )
      with check (
        auth_id = auth.uid()
        or id = auth.uid()::text
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
      )
  $pol$;

  execute 'revoke all on table public.profiles from public, anon';
  execute 'grant select, insert, update, delete on table public.profiles to authenticated, service_role';
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'org_members'
      and column_name = 'role'
  ) then
    insert into public.profiles (id, org_id, user_id, auth_id, data)
    select distinct on (u.id)
      u.id::text,
      m.org_id::text,
      u.id::text,
      u.id,
      jsonb_strip_nulls(jsonb_build_object(
        'email', coalesce(m.email, u.email),
        'role', m.role,
        'orgId', m.org_id::text,
        'uid', u.id::text,
        'displayName', coalesce(
          u.raw_user_meta_data->>'displayName',
          u.raw_user_meta_data->>'full_name'
        )
      ))
    from auth.users u
    join public.org_members m on m.user_id = u.id
    order by u.id, m.created_at desc
    on conflict (id) do nothing;
  end if;
end $$;

create table if not exists public.departments (
  id text primary key,
  org_id text,
  user_id text,
  parent_id text,
  collection_name text,
  auth_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.departments enable row level security;

do $$
begin
  if to_regprocedure('private.member_org_ids_with_roles(text[])') is null then
    return;
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'departments'
      and policyname = 'departments_select'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'full_name'
  ) then
    return;
  end if;

  execute 'drop policy if exists departments_select on public.departments';
  execute 'drop policy if exists departments_write on public.departments';

  execute $pol$
    create policy departments_select on public.departments
      for select to authenticated
      using (
        org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and org_id::uuid in (
          select private.member_org_ids_with_roles(array['owner', 'admin', 'employee'])
        )
      )
  $pol$;

  execute $pol$
    create policy departments_write on public.departments
      for all to authenticated
      using (
        org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and org_id::uuid in (
          select private.member_org_ids_with_roles(array['owner', 'admin'])
        )
      )
      with check (
        org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and org_id::uuid in (
          select private.member_org_ids_with_roles(array['owner', 'admin'])
        )
      )
  $pol$;

  execute 'revoke all on table public.departments from public, anon';
  execute 'grant select, insert, update, delete on table public.departments to authenticated, service_role';
end $$;

notify pgrst, 'reload schema';
