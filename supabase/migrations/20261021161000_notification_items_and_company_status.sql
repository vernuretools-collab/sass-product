-- Admin shell listens on notification_items and calls current_company_status.
-- The hosted database had neither, so the console showed 404s (PGRST205 / missing RPC).

create table if not exists public.notification_items (
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

create table if not exists public.org_notifications (
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

create table if not exists public.app_docs (
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

create index if not exists notification_items_user_idx on public.notification_items (user_id);
create index if not exists notification_items_org_idx on public.notification_items (org_id);
create index if not exists org_notifications_org_idx on public.org_notifications (org_id);
create index if not exists app_docs_collection_idx on public.app_docs (collection_name);
create index if not exists app_docs_org_idx on public.app_docs (org_id);

alter table public.notification_items enable row level security;
alter table public.org_notifications enable row level security;
alter table public.app_docs enable row level security;

alter table public.notification_items replica identity full;
alter table public.org_notifications replica identity full;
alter table public.app_docs replica identity full;

do $$
begin
  if to_regprocedure('private.member_org_ids_with_roles(text[])') is null then
    return;
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'full_name'
  ) then
    return;
  end if;

  execute 'drop policy if exists notification_items_select on public.notification_items';
  execute 'drop policy if exists notification_items_write on public.notification_items';
  execute $pol$
    create policy notification_items_select on public.notification_items
      for select to authenticated
      using (
        auth_id = auth.uid()
        or user_id = auth.uid()::text
        or user_id in (
          select p.id from public.profiles p where p.auth_id = auth.uid()
          union
          select p.user_id from public.profiles p
          where p.auth_id = auth.uid() and p.user_id is not null
        )
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
        or exists (
          select 1
          from public.employees e
          where e.org_id in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
            and notification_items.user_id in (e.id::text, coalesce(e.user_id::text, ''))
        )
      )
  $pol$;

  execute $pol$
    create policy notification_items_write on public.notification_items
      for all to authenticated
      using (
        auth_id = auth.uid()
        or user_id = auth.uid()::text
        or user_id in (
          select p.id from public.profiles p where p.auth_id = auth.uid()
          union
          select p.user_id from public.profiles p
          where p.auth_id = auth.uid() and p.user_id is not null
        )
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
        or exists (
          select 1
          from public.employees e
          where e.org_id in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
            and notification_items.user_id in (e.id::text, coalesce(e.user_id::text, ''))
        )
      )
      with check (
        auth_id = auth.uid()
        or user_id = auth.uid()::text
        or user_id in (
          select p.id from public.profiles p where p.auth_id = auth.uid()
          union
          select p.user_id from public.profiles p
          where p.auth_id = auth.uid() and p.user_id is not null
        )
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
        or exists (
          select 1
          from public.employees e
          where e.org_id in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
            and notification_items.user_id in (e.id::text, coalesce(e.user_id::text, ''))
        )
      )
  $pol$;

  execute 'drop policy if exists org_notifications_select on public.org_notifications';
  execute 'drop policy if exists org_notifications_write on public.org_notifications';
  execute $pol$
    create policy org_notifications_select on public.org_notifications
      for select to authenticated
      using (
        auth_id = auth.uid()
        or user_id = auth.uid()::text
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin', 'employee'])
          )
        )
      )
  $pol$;
  execute $pol$
    create policy org_notifications_write on public.org_notifications
      for all to authenticated
      using (
        auth_id = auth.uid()
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
      )
      with check (
        auth_id = auth.uid()
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
      )
  $pol$;

  execute 'drop policy if exists app_docs_select on public.app_docs';
  execute 'drop policy if exists app_docs_write on public.app_docs';
  execute $pol$
    create policy app_docs_select on public.app_docs
      for select to authenticated
      using (
        auth_id = auth.uid()
        or user_id = auth.uid()::text
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin', 'employee'])
          )
        )
      )
  $pol$;
  execute $pol$
    create policy app_docs_write on public.app_docs
      for all to authenticated
      using (
        auth_id = auth.uid()
        or user_id = auth.uid()::text
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
      )
      with check (
        auth_id = auth.uid()
        or user_id = auth.uid()::text
        or (
          org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and org_id::uuid in (
            select private.member_org_ids_with_roles(array['owner', 'admin'])
          )
        )
      )
  $pol$;

  execute 'revoke all on table public.notification_items from public, anon';
  execute 'revoke all on table public.org_notifications from public, anon';
  execute 'revoke all on table public.app_docs from public, anon';
  execute 'grant select, insert, update, delete on table public.notification_items to authenticated, service_role';
  execute 'grant select, insert, update, delete on table public.org_notifications to authenticated, service_role';
  execute 'grant select, insert, update, delete on table public.app_docs to authenticated, service_role';
end $$;

do $$
declare
  t text;
begin
  if to_regclass('pg_publication') is null then
    return;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['notification_items', 'org_notifications', 'app_docs']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'account_status'
  ) then
    return;
  end if;

  execute $fn$
    create or replace function public.current_company_status()
    returns text
    language sql
    stable
    set search_path = public
    as $body$
      select coalesce(
        (
          select case
            when o.account_status = 'suspended' then 'suspended'
            else coalesce(nullif(o.account_status, ''), 'active')
          end
          from public.org_members m
          join public.organizations o on o.id = m.org_id
          where m.user_id = auth.uid()
          order by
            case
              when o.id::text = coalesce(auth.jwt() -> 'app_metadata' ->> 'orgId', '') then 0
              else 1
            end,
            m.created_at desc
          limit 1
        ),
        'none'
      )
    $body$
  $fn$;

  execute 'revoke all on function public.current_company_status() from public, anon';
  execute 'grant execute on function public.current_company_status() to authenticated';
end $$;

notify pgrst, 'reload schema';
