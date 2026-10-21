-- Hosted organizations table only.
-- subscription_status is Stripe billing (incomplete, trialing, active, past_due, canceled)
-- and private.protect_billing_columns restores it unless the caller is service_role.
-- Company suspend lives on account_status.

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

  execute 'alter table public.organizations add column if not exists account_status text not null default ''active''';
  execute 'alter table public.organizations drop constraint if exists organizations_account_status_check';
  execute 'alter table public.organizations add constraint organizations_account_status_check check (account_status in (''active'', ''suspended''))';

  execute $fn$
    create or replace function private.set_company_status(
      p_org_id uuid,
      p_status text
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
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
      set account_status = next_status
      where id = p_org_id;

      return jsonb_build_object('orgId', p_org_id, 'status', next_status);
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.set_company_status(
      p_org_id uuid,
      p_status text
    )
    returns jsonb
    language sql
    security invoker
    set search_path = public
    as $body$
      select private.set_company_status(p_org_id, p_status);
    $body$
  $fn$;

  execute $fn$
    create or replace function private.list_companies()
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
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
              o.name,
              coalesce(nullif(o.account_status, ''), 'active') as status,
              ''::text as owner_email,
              o.created_at
            from public.organizations o
          ) c
        ),
        '[]'::jsonb
      );
    end;
    $body$
  $fn$;

  execute 'revoke all on function private.set_company_status(uuid, text) from public, anon';
  execute 'revoke all on function public.set_company_status(uuid, text) from public, anon';
  execute 'grant execute on function private.set_company_status(uuid, text) to authenticated';
  execute 'grant execute on function public.set_company_status(uuid, text) to authenticated';
end $$;

notify pgrst, 'reload schema';
