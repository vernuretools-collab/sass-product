-- Hosted organizations only (plan, subscription_status, Stripe id columns).
-- A public purchase stays pending until Stripe pays, then the company and its admin are created.

do $outer$
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

  execute $sql$
    create table if not exists private.company_purchases (
      id uuid primary key default gen_random_uuid(),
      company_name text not null,
      admin_name text not null,
      email text not null,
      password_hash text not null,
      stripe_checkout_session_id text,
      stripe_customer_id text,
      stripe_subscription_id text,
      org_id uuid,
      status text not null default 'pending' check (status in ('pending', 'opened', 'failed')),
      failure_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $sql$;

  execute 'alter table private.company_purchases enable row level security';
  execute 'revoke all on table private.company_purchases from public, anon, authenticated';
  execute 'create unique index if not exists company_purchases_checkout_session_idx on private.company_purchases (stripe_checkout_session_id) where stripe_checkout_session_id is not null';
  execute 'create unique index if not exists company_purchases_subscription_idx on private.company_purchases (stripe_subscription_id) where stripe_subscription_id is not null';

  execute $fn$
    create or replace function private.assert_billing_service()
    returns void
    language plpgsql
    stable
    security definer
    set search_path = public
    as $body$
    begin
      if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
        raise exception 'Only the billing service can do this';
      end if;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.hash_password(p_password text)
    returns text
    language plpgsql
    security definer
    set search_path = public, extensions
    as $body$
    declare
      hashed_password text;
    begin
      begin
        execute 'select extensions.crypt($1, extensions.gen_salt(''bf''))'
          into hashed_password
          using p_password;
      exception
        when undefined_function or invalid_schema_name then
          execute 'select public.crypt($1, public.gen_salt(''bf''))'
            into hashed_password
            using p_password;
      end;
      return hashed_password;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.provision_company_admin(
      p_company_name text,
      p_admin_name text,
      p_email text,
      p_password_hash text,
      p_plan text,
      p_subscription_status text,
      p_stripe_customer_id text,
      p_stripe_subscription_id text
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      clean_company text := btrim(coalesce(p_company_name, ''));
      clean_name text := btrim(coalesce(p_admin_name, ''));
      clean_email text := lower(btrim(coalesce(p_email, '')));
      clean_slug text;
      base_slug text;
      suffix integer := 1;
      new_user_id uuid := gen_random_uuid();
      new_org_id uuid;
    begin
      if length(clean_company) < 2 then
        raise exception 'Company name is required';
      end if;
      if clean_name = '' then
        raise exception 'Admin name is required';
      end if;
      if exists (select 1 from auth.users where lower(email) = clean_email) then
        raise exception 'An account with this email already exists';
      end if;

      clean_slug := lower(regexp_replace(clean_company, '[^a-z0-9]+', '-', 'g'));
      clean_slug := trim(both '-' from clean_slug);
      if length(clean_slug) < 2 then
        clean_slug := 'company';
      end if;
      base_slug := clean_slug;
      while exists (select 1 from public.organizations where slug = clean_slug) loop
        suffix := suffix + 1;
        clean_slug := base_slug || '-' || suffix;
      end loop;

      insert into public.organizations (
        name, slug, plan, subscription_status, stripe_customer_id, stripe_subscription_id
      ) values (
        clean_company,
        clean_slug,
        p_plan,
        p_subscription_status,
        nullif(btrim(coalesce(p_stripe_customer_id, '')), ''),
        nullif(btrim(coalesce(p_stripe_subscription_id, '')), '')
      )
      returning id into new_org_id;

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        new_user_id,
        'authenticated',
        'authenticated',
        clean_email,
        p_password_hash,
        now(),
        jsonb_build_object(
          'provider', 'email',
          'providers', jsonb_build_array('email'),
          'role', 'owner',
          'orgId', new_org_id::text
        ),
        jsonb_build_object('displayName', clean_name, 'full_name', clean_name),
        now(),
        now(),
        '',
        '',
        '',
        ''
      );

      insert into auth.identities (
        user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) values (
        new_user_id,
        jsonb_build_object('sub', new_user_id::text, 'email', clean_email, 'email_verified', true),
        'email',
        new_user_id::text,
        now(),
        now(),
        now()
      );

      insert into public.org_members (org_id, user_id, email, role)
      values (new_org_id, new_user_id, clean_email, 'owner');

      insert into public.employees (org_id, user_id, full_name, email)
      values (new_org_id, new_user_id, clean_name, clean_email);

      return jsonb_build_object('orgId', new_org_id, 'userId', new_user_id, 'status', 'opened');
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.prepare_company_purchase(
      p_company_name text,
      p_admin_name text,
      p_email text,
      p_password text
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      clean_email text := lower(btrim(p_email));
      clean_company text := btrim(p_company_name);
      clean_name text := btrim(p_admin_name);
      purchase_id uuid;
    begin
      perform private.assert_billing_service();

      if length(clean_company) < 2 then
        raise exception 'Company name is required';
      end if;
      if clean_name = '' then
        raise exception 'Admin name is required';
      end if;
      if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'A valid email is required';
      end if;
      if length(coalesce(p_password, '')) < 6 then
        raise exception 'Password must be at least 6 characters';
      end if;
      if exists (select 1 from auth.users where lower(email) = clean_email) then
        raise exception 'An account with this email already exists';
      end if;

      insert into private.company_purchases (company_name, admin_name, email, password_hash)
      values (clean_company, clean_name, clean_email, private.hash_password(p_password))
      returning id into purchase_id;

      return purchase_id;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.attach_stripe_checkout(
      p_purchase_id uuid,
      p_session_id text
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      clean_session text := btrim(coalesce(p_session_id, ''));
    begin
      perform private.assert_billing_service();
      if clean_session = '' then
        raise exception 'Checkout session is required';
      end if;

      update private.company_purchases
      set stripe_checkout_session_id = clean_session, updated_at = now()
      where id = p_purchase_id and status = 'pending';

      if not found then
        raise exception 'Purchase not found';
      end if;

      return jsonb_build_object('purchaseId', p_purchase_id, 'sessionId', clean_session);
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.record_stripe_payment(
      p_purchase_id uuid,
      p_customer_id text,
      p_subscription_id text
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      perform private.assert_billing_service();

      update private.company_purchases
      set
        stripe_customer_id = coalesce(nullif(btrim(coalesce(p_customer_id, '')), ''), stripe_customer_id),
        stripe_subscription_id = coalesce(nullif(btrim(coalesce(p_subscription_id, '')), ''), stripe_subscription_id),
        updated_at = now()
      where id = p_purchase_id;

      if not found then
        return jsonb_build_object('status', 'missing');
      end if;

      return jsonb_build_object('purchaseId', p_purchase_id, 'status', 'recorded');
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.open_paid_company(p_purchase_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      purchase private.company_purchases%rowtype;
      opened jsonb;
    begin
      perform private.assert_billing_service();

      select * into purchase
      from private.company_purchases
      where id = p_purchase_id
      for update;

      if not found then
        return jsonb_build_object('status', 'missing');
      end if;

      if purchase.status = 'opened' and purchase.org_id is not null then
        update public.organizations
        set
          plan = 'apps',
          subscription_status = 'active',
          stripe_customer_id = coalesce(nullif(purchase.stripe_customer_id, ''), stripe_customer_id),
          stripe_subscription_id = coalesce(nullif(purchase.stripe_subscription_id, ''), stripe_subscription_id)
        where id = purchase.org_id;

        return jsonb_build_object('orgId', purchase.org_id, 'status', 'opened', 'alreadyOpened', true);
      end if;

      if purchase.status <> 'pending' then
        return jsonb_build_object('status', purchase.status, 'error', purchase.failure_reason);
      end if;

      begin
        opened := private.provision_company_admin(
          purchase.company_name,
          purchase.admin_name,
          purchase.email,
          purchase.password_hash,
          'apps',
          'active',
          purchase.stripe_customer_id,
          purchase.stripe_subscription_id
        );

        update private.company_purchases
        set
          org_id = (opened->>'orgId')::uuid,
          status = 'opened',
          failure_reason = null,
          updated_at = now()
        where id = purchase.id;

        return opened;
      exception
        when others then
          if SQLERRM <> 'An account with this email already exists' then
            raise;
          end if;
          update private.company_purchases
          set status = 'failed', failure_reason = SQLERRM, updated_at = now()
          where id = purchase.id;
          return jsonb_build_object('status', 'failed', 'error', SQLERRM);
      end;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.set_company_billing_status(
      p_subscription_id text,
      p_status text
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      next_status text := lower(btrim(coalesce(p_status, '')));
      clean_subscription text := btrim(coalesce(p_subscription_id, ''));
      updated_org uuid;
    begin
      perform private.assert_billing_service();

      if next_status not in ('active', 'past_due', 'canceled') then
        raise exception 'Status must be active, past_due, or canceled';
      end if;
      if clean_subscription = '' then
        return jsonb_build_object('updated', false);
      end if;

      update public.organizations
      set subscription_status = next_status
      where stripe_subscription_id = clean_subscription
      returning id into updated_org;

      if updated_org is null then
        return jsonb_build_object('updated', false, 'subscriptionId', clean_subscription);
      end if;

      return jsonb_build_object('updated', true, 'orgId', updated_org, 'status', next_status);
    end;
    $body$
  $fn$;

  execute $fn$
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
    as $body$
    declare
      clean_email text := lower(btrim(p_email));
      clean_name text := btrim(p_admin_name);
    begin
      if auth.uid() is null or not public.is_platform_operator() then
        raise exception 'Only a platform operator can create a company';
      end if;
      if length(btrim(coalesce(p_company_name, ''))) < 2 then
        raise exception 'Company name is required';
      end if;
      if clean_name = '' then
        raise exception 'Admin name is required';
      end if;
      if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'A valid email is required';
      end if;
      if length(coalesce(p_password, '')) < 6 then
        raise exception 'Password must be at least 6 characters';
      end if;

      return private.provision_company_admin(
        p_company_name,
        clean_name,
        clean_email,
        private.hash_password(p_password),
        'apps',
        'active',
        null,
        null
      ) || jsonb_build_object('purchased', false);
    end;
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
              o.plan,
              coalesce(nullif(o.account_status, ''), 'active') as status,
              coalesce(
                (
                  select m.email
                  from public.org_members m
                  where m.org_id = o.id and m.role = 'owner'
                  order by m.created_at
                  limit 1
                ),
                ''
              ) as owner_email,
              o.created_at,
              (nullif(btrim(coalesce(o.stripe_subscription_id, '')), '') is not null) as purchased
            from public.organizations o
          ) c
        ),
        '[]'::jsonb
      );
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.prepare_company_purchase(p_company_name text, p_admin_name text, p_email text, p_password text)
    returns uuid language sql security invoker set search_path = public
    as $body$ select private.prepare_company_purchase(p_company_name, p_admin_name, p_email, p_password); $body$
  $fn$;

  execute $fn$
    create or replace function public.attach_stripe_checkout(p_purchase_id uuid, p_session_id text)
    returns jsonb language sql security invoker set search_path = public
    as $body$ select private.attach_stripe_checkout(p_purchase_id, p_session_id); $body$
  $fn$;

  execute $fn$
    create or replace function public.record_stripe_payment(p_purchase_id uuid, p_customer_id text, p_subscription_id text)
    returns jsonb language sql security invoker set search_path = public
    as $body$ select private.record_stripe_payment(p_purchase_id, p_customer_id, p_subscription_id); $body$
  $fn$;

  execute $fn$
    create or replace function public.open_paid_company(p_purchase_id uuid)
    returns jsonb language sql security invoker set search_path = public
    as $body$ select private.open_paid_company(p_purchase_id); $body$
  $fn$;

  execute $fn$
    create or replace function public.set_company_billing_status(p_subscription_id text, p_status text)
    returns jsonb language sql security invoker set search_path = public
    as $body$ select private.set_company_billing_status(p_subscription_id, p_status); $body$
  $fn$;

  execute $fn$
    create or replace function public.create_company_as_operator(p_company_name text, p_admin_name text, p_email text, p_password text)
    returns jsonb language sql security invoker set search_path = public
    as $body$ select private.create_company_as_operator(p_company_name, p_admin_name, p_email, p_password); $body$
  $fn$;

  execute 'revoke all on function private.assert_billing_service() from public, anon, authenticated';
  execute 'revoke all on function private.hash_password(text) from public, anon, authenticated';
  execute 'revoke all on function private.provision_company_admin(text, text, text, text, text, text, text, text) from public, anon, authenticated';
  execute 'revoke all on function private.prepare_company_purchase(text, text, text, text) from public, anon, authenticated';
  execute 'revoke all on function private.attach_stripe_checkout(uuid, text) from public, anon, authenticated';
  execute 'revoke all on function private.record_stripe_payment(uuid, text, text) from public, anon, authenticated';
  execute 'revoke all on function private.open_paid_company(uuid) from public, anon, authenticated';
  execute 'revoke all on function private.set_company_billing_status(text, text) from public, anon, authenticated';
  execute 'revoke all on function private.create_company_as_operator(text, text, text, text) from public, anon, authenticated';

  execute 'revoke all on function public.prepare_company_purchase(text, text, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.attach_stripe_checkout(uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.record_stripe_payment(uuid, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.open_paid_company(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.set_company_billing_status(text, text) from public, anon, authenticated';
  execute 'revoke all on function public.create_company_as_operator(text, text, text, text) from public, anon, authenticated';

  execute 'grant execute on function private.assert_billing_service() to service_role';
  execute 'grant execute on function private.hash_password(text) to service_role';
  execute 'grant execute on function private.provision_company_admin(text, text, text, text, text, text, text, text) to service_role';
  execute 'grant execute on function private.prepare_company_purchase(text, text, text, text) to service_role';
  execute 'grant execute on function private.attach_stripe_checkout(uuid, text) to service_role';
  execute 'grant execute on function private.record_stripe_payment(uuid, text, text) to service_role';
  execute 'grant execute on function private.open_paid_company(uuid) to service_role';
  execute 'grant execute on function private.set_company_billing_status(text, text) to service_role';
  execute 'grant execute on function private.create_company_as_operator(text, text, text, text) to service_role, authenticated';

  execute 'grant execute on function public.prepare_company_purchase(text, text, text, text) to service_role';
  execute 'grant execute on function public.attach_stripe_checkout(uuid, text) to service_role';
  execute 'grant execute on function public.record_stripe_payment(uuid, text, text) to service_role';
  execute 'grant execute on function public.open_paid_company(uuid) to service_role';
  execute 'grant execute on function public.set_company_billing_status(text, text) to service_role';
  execute 'grant execute on function public.create_company_as_operator(text, text, text, text) to authenticated, service_role';
end
$outer$;

notify pgrst, 'reload schema';
