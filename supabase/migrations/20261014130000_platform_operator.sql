-- Companies are opened from the parent app. A customer cannot create one.
-- platform_role lives in app_metadata and is set by the database, not by the user.

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'platform_role', '') = 'operator';
$$;

create or replace function public.company_is_active(row_org text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select coalesce(nullif(o.data->>'status', ''), 'active') = 'active'
      from public.organizations o
      where o.id = row_org
    ),
    true
  );
$$;

create or replace function public.in_current_circle(row_org text)
returns boolean
language sql
stable
as $$
  select
    public.current_org_id() is not null
    and row_org is not null
    and row_org <> ''
    and row_org = public.current_org_id()
    and public.company_is_active(row_org);
$$;

create or replace function public.current_company_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_org_id() is null then 'none'
    else coalesce(
      (
        select coalesce(nullif(o.data->>'status', ''), 'active')
        from public.organizations o
        where o.id = public.current_org_id()
      ),
      'active'
    )
  end;
$$;

revoke all on function public.create_company_circle(text, text, text, text) from public, anon, authenticated;
revoke all on function private.create_company_circle(text, text, text, text) from public, anon, authenticated;

create or replace function private.create_company_as_operator(
  p_company_name text,
  p_admin_name text,
  p_email text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created jsonb;
  new_org_id text;
begin
  if auth.uid() is null or not public.is_platform_operator() then
    raise exception 'Only a platform operator can create a company';
  end if;

  created := private.create_company_circle(p_company_name, p_admin_name, p_email, p_password);
  new_org_id := created->>'orgId';

  update public.organizations
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('status', 'active')
  where id = new_org_id;

  return created || jsonb_build_object('status', 'active');
end;
$$;

create or replace function public.create_company_as_operator(
  p_company_name text,
  p_admin_name text,
  p_email text,
  p_password text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.create_company_as_operator(p_company_name, p_admin_name, p_email, p_password);
$$;

create or replace function private.set_company_status(
  p_org_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status text := lower(btrim(p_status));
begin
  if auth.uid() is null or not public.is_platform_operator() then
    raise exception 'Only a platform operator can change a company';
  end if;
  if next_status not in ('active', 'suspended') then
    raise exception 'Status must be active or suspended';
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'Company not found';
  end if;

  update public.organizations
  set
    data = coalesce(data, '{}'::jsonb) || jsonb_build_object('status', next_status),
    updated_at = now()
  where id = p_org_id;

  return jsonb_build_object('orgId', p_org_id, 'status', next_status);
end;
$$;

create or replace function public.set_company_status(
  p_org_id text,
  p_status text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.set_company_status(p_org_id, p_status);
$$;

create or replace function private.list_companies()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_operator() then
    raise exception 'Only a platform operator can list companies';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_to_json(c)::jsonb order by c.created_at desc)
      from (
        select
          o.id,
          coalesce(nullif(o.data->>'name', ''), o.id) as name,
          coalesce(nullif(o.data->>'status', ''), 'active') as status,
          coalesce(
            nullif(p.data->>'email', ''),
            nullif(m.data->>'email', ''),
            ''
          ) as owner_email,
          o.created_at
        from public.organizations o
        left join public.profiles p on p.id = nullif(o.data->>'ownerId', '')
        left join lateral (
          select om.data
          from public.org_members om
          where om.org_id = o.id
            and lower(coalesce(om.data->>'role', '')) = 'owner'
          order by om.created_at
          limit 1
        ) m on true
      ) c
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.list_companies()
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.list_companies();
$$;

revoke all on function private.create_company_as_operator(text, text, text, text) from public;
revoke all on function public.create_company_as_operator(text, text, text, text) from public;
revoke all on function private.set_company_status(text, text) from public;
revoke all on function public.set_company_status(text, text) from public;
revoke all on function private.list_companies() from public;
revoke all on function public.list_companies() from public;
revoke all on function public.current_company_status() from public;
revoke all on function public.company_is_active(text) from public;

grant execute on function private.create_company_as_operator(text, text, text, text) to authenticated;
grant execute on function public.create_company_as_operator(text, text, text, text) to authenticated;
grant execute on function private.set_company_status(text, text) to authenticated;
grant execute on function public.set_company_status(text, text) to authenticated;
grant execute on function private.list_companies() to authenticated;
grant execute on function public.list_companies() to authenticated;
grant execute on function public.current_company_status() to authenticated;
grant execute on function public.company_is_active(text) to authenticated;
grant execute on function public.in_current_circle(text) to authenticated;

notify pgrst, 'reload schema';
