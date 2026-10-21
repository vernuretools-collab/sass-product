-- Portal rows stay inside a paid, unsuspended company.
-- Membership itself stays readable so the company can open checkout while locked.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'subscription_status'
  ) then
    return;
  end if;

  execute $fn$
    create or replace function private.member_org_ids_any()
    returns setof uuid
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select org_id
      from public.org_members
      where user_id = auth.uid()
    $body$
  $fn$;

  execute $fn$
    create or replace function private.member_org_ids()
    returns setof uuid
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select m.org_id
      from public.org_members m
      join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
        and o.account_status = 'active'
        and o.subscription_status in ('active', 'trialing')
    $body$
  $fn$;

  execute $fn$
    create or replace function private.member_org_ids_with_roles(roles text[])
    returns setof uuid
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select m.org_id
      from public.org_members m
      join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
        and m.role = any (roles)
        and o.account_status = 'active'
        and o.subscription_status in ('active', 'trialing')
    $body$
  $fn$;

  execute 'revoke all on function private.member_org_ids_any() from public, anon';
  execute 'grant execute on function private.member_org_ids_any() to authenticated, service_role';

  execute 'drop policy if exists organizations_select on public.organizations';
  execute 'create policy organizations_select on public.organizations for select to authenticated using (id in (select private.member_org_ids_any()))';
  execute 'drop policy if exists org_members_select on public.org_members';
  execute 'create policy org_members_select on public.org_members for select to authenticated using (org_id in (select private.member_org_ids_any()))';

  execute $fn$
    create or replace function public.current_membership()
    returns jsonb
    language sql
    stable
    set search_path = public
    as $body$
      select jsonb_build_object(
        'org_id', o.id,
        'org_name', o.name,
        'slug', o.slug,
        'plan', o.plan,
        'subscription_status', o.subscription_status,
        'account_status', o.account_status,
        'access', o.account_status = 'active' and o.subscription_status in ('active', 'trialing'),
        'reason', case
          when o.account_status = 'suspended' then 'suspended'
          when o.subscription_status in ('active', 'trialing') then 'active'
          else o.subscription_status
        end,
        'logo_url', o.logo_url,
        'timezone', o.timezone,
        'currency', o.currency,
        'bank_details', o.bank_details,
        'role', m.role,
        'email', m.email
      )
      from public.org_members m
      join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
      limit 1
    $body$
  $fn$;

  execute $fn$
    create or replace function public.check_desktop_entitlement()
    returns jsonb
    language sql
    stable
    set search_path = public
    as $body$
      select coalesce(
        (
          select jsonb_build_object(
            'allowed', o.plan = 'apps'
              and o.account_status = 'active'
              and o.subscription_status in ('active', 'trialing'),
            'plan', o.plan,
            'subscription_status', o.subscription_status,
            'account_status', o.account_status,
            'reason', case
              when o.account_status = 'suspended' then 'suspended'
              when o.plan <> 'apps' then 'plan'
              when o.subscription_status not in ('active', 'trialing') then o.subscription_status
              else 'active'
            end,
            'org_id', o.id,
            'org_name', o.name,
            'role', m.role
          )
          from public.org_members m
          join public.organizations o on o.id = m.org_id
          where m.user_id = auth.uid()
          limit 1
        ),
        jsonb_build_object('allowed', false, 'reason', 'no_org')
      )
    $body$
  $fn$;
end $$;

notify pgrst, 'reload schema';
