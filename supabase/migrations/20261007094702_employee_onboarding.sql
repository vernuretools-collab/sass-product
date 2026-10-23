-- Joining accounts are not employee-portal users. Admins manage the row.
-- The hire can read their own row and submit answers only through the function below.

create schema if not exists private;

create table if not exists public.employee_onboarding (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  auth_id uuid not null unique,
  username text not null,
  status text not null default 'awaiting_answers',
  employment jsonb not null default '{}'::jsonb,
  kras jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_onboarding_status_check
    check (status in ('awaiting_answers', 'submitted')),
  constraint employee_onboarding_username_check
    check (username = lower(username) and length(username) >= 3)
);

create unique index if not exists employee_onboarding_org_username_idx
  on public.employee_onboarding (org_id, username);

create index if not exists employee_onboarding_org_idx
  on public.employee_onboarding (org_id, created_at desc);

alter table public.employee_onboarding enable row level security;

revoke all on table public.employee_onboarding from public, anon;
grant select, insert, update, delete on table public.employee_onboarding to authenticated;
grant select, insert, update, delete on table public.employee_onboarding to service_role;

drop policy if exists employee_onboarding_admin_all on public.employee_onboarding;
create policy employee_onboarding_admin_all
  on public.employee_onboarding
  for all
  to authenticated
  using (
    public.is_admin()
    and org_id = coalesce(nullif(public.jwt_claim('orgId'), ''), org_id)
  )
  with check (
    public.is_admin()
    and org_id = coalesce(nullif(public.jwt_claim('orgId'), ''), org_id)
  );

drop policy if exists employee_onboarding_self_select on public.employee_onboarding;
create policy employee_onboarding_self_select
  on public.employee_onboarding
  for select
  to authenticated
  using (auth_id = auth.uid());

create or replace function private.submit_employee_onboarding(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.employee_onboarding;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must be an object';
  end if;

  update public.employee_onboarding
  set
    answers = p_answers,
    status = 'submitted',
    submitted_at = now(),
    updated_at = now()
  where auth_id = auth.uid()
    and status = 'awaiting_answers'
  returning * into updated;

  if not found then
    raise exception 'no onboarding form is waiting for answers';
  end if;

  return jsonb_build_object(
    'id', updated.id,
    'status', updated.status,
    'submitted_at', updated.submitted_at
  );
end;
$$;

revoke all on function private.submit_employee_onboarding(jsonb) from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.submit_employee_onboarding(jsonb) to authenticated, service_role;

-- A fresh database already has the 00016 version of this function, which
-- returns public.employee_onboarding. Drop it so the jsonb version can be created.
drop function if exists public.submit_employee_onboarding(jsonb);

create or replace function public.submit_employee_onboarding(p_answers jsonb)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.submit_employee_onboarding(p_answers);
$$;

revoke all on function public.submit_employee_onboarding(jsonb) from public, anon;
grant execute on function public.submit_employee_onboarding(jsonb) to authenticated, service_role;
