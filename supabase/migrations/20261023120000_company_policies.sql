-- Attendance reads and saves the office geofence as a document in
-- company_policies. Hosted companies never had that table, so the tracker
-- failed with "Could not find the table public.company_policies".

create table if not exists public.company_policies (
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

create index if not exists company_policies_org_idx on public.company_policies (org_id);

alter table public.company_policies enable row level security;
alter table public.company_policies replica identity full;

-- These policies use the hosted-only private.member_org_ids_with_roles().
-- A fresh database built from these migrations keeps the company-circle
-- policies from 20261014120000 instead.
do $guard$
begin
  if to_regprocedure('private.member_org_ids_with_roles(text[])') is null then
    return;
  end if;

  execute 'drop policy if exists company_policies_select on public.company_policies';
  execute 'drop policy if exists company_policies_write on public.company_policies';

  execute $pol$
    create policy company_policies_select on public.company_policies
      for select to authenticated
      using (
        org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and org_id::uuid in (
          select private.member_org_ids_with_roles(array['owner', 'admin', 'employee'])
        )
      )
  $pol$;

  execute $pol$
    create policy company_policies_write on public.company_policies
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
end
$guard$;

revoke all on table public.company_policies from public, anon;
grant select, insert, update, delete on table public.company_policies to authenticated, service_role;

do $$
begin
  if to_regclass('pg_publication') is null then
    return;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'company_policies'
  ) then
    alter publication supabase_realtime add table public.company_policies;
  end if;
end $$;

notify pgrst, 'reload schema';
