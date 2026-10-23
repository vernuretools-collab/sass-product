-- Company access and billing (review C5, H2 "missing org row", H7, H8, webhook idempotency).
--
-- Document-shaped organizations (organizations.data jsonb) now keep two independent fields:
--   data.status         operator hold: 'active' | 'suspended'. Only the platform operator writes it.
--   data.billingStatus  Stripe-derived: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid'.
--                       Only the billing service (stripe-webhook, service role) writes it.
-- A company is active only when its row exists, it is not on operator hold, and billing is
-- active or trialing. A missing organizations row is no longer treated as active.
--
-- The hosted relational shape already keeps account_status and subscription_status apart; only
-- the "already opened" path of open_paid_company is fixed there.

-- ---------------------------------------------------------------------------
-- 1. Stripe event idempotency (both shapes)
-- ---------------------------------------------------------------------------
create table if not exists private.stripe_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);
alter table private.stripe_events enable row level security;
revoke all on table private.stripe_events from public, anon, authenticated;
grant select, insert on table private.stripe_events to service_role;

create or replace function private.stripe_event_processed(p_event_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_service();
  return exists (select 1 from private.stripe_events where event_id = btrim(coalesce(p_event_id, '')));
end;
$$;

create or replace function private.mark_stripe_event_processed(p_event_id text, p_event_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  perform private.assert_billing_service();
  if btrim(coalesce(p_event_id, '')) = '' then
    raise exception 'Event id is required';
  end if;
  insert into private.stripe_events (event_id, event_type)
  values (btrim(p_event_id), coalesce(p_event_type, ''))
  on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$$;

create or replace function public.stripe_event_processed(p_event_id text)
returns boolean
language sql
set search_path = ''
as $$ select private.stripe_event_processed(p_event_id); $$;

create or replace function public.mark_stripe_event_processed(p_event_id text, p_event_type text)
returns boolean
language sql
set search_path = ''
as $$ select private.mark_stripe_event_processed(p_event_id, p_event_type); $$;

revoke all on function private.stripe_event_processed(text) from public, anon, authenticated;
revoke all on function private.mark_stripe_event_processed(text, text) from public, anon, authenticated;
revoke all on function public.stripe_event_processed(text) from public, anon, authenticated;
revoke all on function public.mark_stripe_event_processed(text, text) from public, anon, authenticated;
grant execute on function private.stripe_event_processed(text) to service_role;
grant execute on function private.mark_stripe_event_processed(text, text) to service_role;
grant execute on function public.stripe_event_processed(text) to service_role;
grant execute on function public.mark_stripe_event_processed(text, text) to service_role;

-- Purchases can now also expire (checkout.session.expired / async payment failed) or be refunded
-- after a failed opening.
do $$
begin
  if to_regclass('private.company_purchases') is not null then
    alter table private.company_purchases drop constraint if exists company_purchases_status_check;
    alter table private.company_purchases
      add constraint company_purchases_status_check
      check (status in ('pending', 'opened', 'failed', 'expired'));
  end if;
end;
$$;

-- Session-keyed purchase status for the website success page. Service role only; the
-- create-checkout function exposes it by unguessable Checkout Session id.
create or replace function private.purchase_status_for_session(p_session_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found_status text;
begin
  perform private.assert_billing_service();
  select p.status into found_status
  from private.company_purchases p
  where p.stripe_checkout_session_id = btrim(coalesce(p_session_id, ''))
  limit 1;
  return jsonb_build_object('status', coalesce(found_status, 'unknown'));
end;
$$;

create or replace function public.purchase_status_for_session(p_session_id text)
returns jsonb
language sql
set search_path = ''
as $$ select private.purchase_status_for_session(p_session_id); $$;

-- Marks a still-pending purchase as expired (checkout abandoned or async payment failed).
create or replace function private.expire_company_purchase(p_purchase_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_billing_service();
  update private.company_purchases
  set status = 'expired',
      failure_reason = left(coalesce(p_reason, 'Checkout expired'), 200),
      password_hash = '',
      updated_at = now()
  where id = p_purchase_id
    and status = 'pending';
  return jsonb_build_object('expired', found);
end;
$$;

create or replace function public.expire_company_purchase(p_purchase_id uuid, p_reason text)
returns jsonb
language sql
set search_path = ''
as $$ select private.expire_company_purchase(p_purchase_id, p_reason); $$;

revoke all on function private.purchase_status_for_session(text) from public, anon, authenticated;
revoke all on function public.purchase_status_for_session(text) from public, anon, authenticated;
revoke all on function private.expire_company_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.expire_company_purchase(uuid, text) from public, anon, authenticated;
grant execute on function private.purchase_status_for_session(text) to service_role;
grant execute on function public.purchase_status_for_session(text) to service_role;
grant execute on function private.expire_company_purchase(uuid, text) to service_role;
grant execute on function public.expire_company_purchase(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Document shape
-- ---------------------------------------------------------------------------
do $outer$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'data'
  ) then
    return;
  end if;

  -- Keep existing companies working: every org id that people already belong to gets an
  -- organizations row (active) so that "missing row = inactive" does not lock them out.
  execute $sql$
    insert into public.organizations (id, org_id, data)
    select s.org_id, s.org_id,
           jsonb_build_object('name', s.org_id, 'orgId', s.org_id, 'status', 'active',
                              'backfilledAt', now())
    from (
      select distinct org_id from public.profiles where coalesce(org_id, '') <> ''
      union
      select distinct org_id from public.employees where coalesce(org_id, '') <> ''
    ) s
    where not exists (select 1 from public.organizations o where o.id = s.org_id)
  $sql$;

  execute $fn$
    create or replace function public.company_is_active(row_org text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      select coalesce(
        (
          select coalesce(nullif(o.data->>'status', ''), 'active') = 'active'
             and coalesce(nullif(o.data->>'billingStatus', ''), 'active') in ('active', 'trialing')
          from public.organizations o
          where o.id = row_org
        ),
        false
      );
    $body$
  $fn$;

  execute $fn$
    create or replace function public.current_company_status()
    returns text
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      select case
        when public.current_org_id() is null then 'none'
        else coalesce(
          (
            select case
              when coalesce(nullif(o.data->>'status', ''), 'active') <> 'active' then 'suspended'
              when coalesce(nullif(o.data->>'billingStatus', ''), 'active') in ('active', 'trialing') then 'active'
              else o.data->>'billingStatus'
            end
            from public.organizations o
            where o.id = public.current_org_id()
          ),
          'inactive'
        )
      end;
    $body$
  $fn$;

  -- Billing status only touches data.billingStatus; an operator hold (data.status) is never cleared.
  -- 'canceled' is terminal for a subscription, so a late invoice.paid cannot re-open it.
  execute $fn$
    create or replace function private.set_company_billing_status(p_subscription_id text, p_status text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      next_status text := lower(btrim(coalesce(p_status, '')));
      clean_subscription text := btrim(coalesce(p_subscription_id, ''));
      updated_org text;
    begin
      perform private.assert_billing_service();

      if next_status not in ('active', 'trialing', 'past_due', 'canceled', 'unpaid') then
        raise exception 'Status must be active, trialing, past_due, canceled, or unpaid';
      end if;
      if clean_subscription = '' then
        return jsonb_build_object('updated', false);
      end if;

      update public.organizations o
      set
        data = coalesce(o.data, '{}'::jsonb) || jsonb_build_object(
          'billingStatus', next_status,
          'billingUpdatedAt', now()
        ),
        updated_at = now()
      from private.company_purchases p
      where p.stripe_subscription_id = clean_subscription
        and p.status = 'opened'
        and p.org_id is not null
        and o.id = p.org_id
        and not (
          coalesce(o.data->>'billingStatus', '') = 'canceled'
          and next_status <> 'canceled'
        )
      returning o.id into updated_org;

      if updated_org is null then
        return jsonb_build_object('updated', false, 'subscriptionId', clean_subscription);
      end if;

      return jsonb_build_object('updated', true, 'orgId', updated_org, 'status', next_status);
    end;
    $body$
  $fn$;

  -- Operator status: same contract as before ('active' | 'suspended'), billing untouched.
  execute $fn$
    create or replace function private.set_company_status(p_org_id text, p_status text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      next_status text := lower(btrim(coalesce(p_status, '')));
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
        data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
          'status', next_status,
          'statusChangedBy', 'operator',
          'statusChangedAt', now()
        ),
        updated_at = now()
      where id = p_org_id;

      return jsonb_build_object('orgId', p_org_id, 'status', next_status);
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function private.list_companies()
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
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
              coalesce(nullif(o.data->>'name', ''), o.id) as name,
              coalesce(nullif(o.data->>'status', ''), 'active') as status,
              coalesce(nullif(o.data->>'billingStatus', ''), 'active') as billing_status,
              coalesce(nullif(p.data->>'email', ''), nullif(m.data->>'email', ''), '') as owner_email,
              o.created_at,
              exists (
                select 1 from private.company_purchases cp
                where cp.org_id = o.id and cp.status = 'opened'
              ) as purchased
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
    $body$
  $fn$;

  -- Operator-only view of paid purchases that could not open a company (H8).
  execute $fn$
    create or replace function private.list_failed_purchases()
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    begin
      if auth.uid() is null or not public.is_platform_operator() then
        raise exception 'Only a platform operator can list purchases';
      end if;
      return coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'company_name', p.company_name, 'email', p.email, 'status', p.status,
          'failure_reason', p.failure_reason, 'stripe_customer_id', p.stripe_customer_id,
          'stripe_subscription_id', p.stripe_subscription_id, 'updated_at', p.updated_at
        ) order by p.updated_at desc)
        from private.company_purchases p
        where p.status = 'failed'
      ), '[]'::jsonb);
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.list_failed_purchases()
    returns jsonb
    language sql
    set search_path = ''
    as $body$ select private.list_failed_purchases(); $body$
  $fn$;

  -- Refuse a second purchase for an email that already has a recent pending checkout, so two
  -- paid checkouts cannot race for the same account (H8). Checkout sessions expire after 30 min.
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
    set search_path = ''
    as $body$
    declare
      clean_email text := lower(btrim(coalesce(p_email, '')));
      clean_company text := btrim(coalesce(p_company_name, ''));
      clean_name text := btrim(coalesce(p_admin_name, ''));
      hashed_password text;
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
      if length(coalesce(p_password, '')) < 10 then
        raise exception 'Password must be at least 10 characters';
      end if;
      if exists (select 1 from auth.users where lower(email) = clean_email) then
        raise exception 'checkout-unavailable';
      end if;

      -- Stale pending purchases for this email are expired; a fresh one blocks a new checkout.
      update private.company_purchases
      set status = 'expired', failure_reason = 'Superseded', password_hash = '', updated_at = now()
      where email = clean_email and status = 'pending' and created_at < now() - interval '35 minutes';
      if exists (
        select 1 from private.company_purchases
        where email = clean_email and status = 'pending'
      ) then
        raise exception 'checkout-in-progress';
      end if;

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

      insert into private.company_purchases (company_name, admin_name, email, password_hash)
      values (clean_company, clean_name, clean_email, hashed_password)
      returning id into purchase_id;

      return purchase_id;
    end;
    $body$
  $fn$;

  -- open_paid_company: the already-opened path no longer touches status (H7); a new company starts
  -- with billingStatus 'active'; the password hash is discarded once used or failed.
  execute $fn$
    create or replace function private.open_paid_company(p_purchase_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      purchase private.company_purchases%rowtype;
      new_user_id uuid := gen_random_uuid();
      new_org_id text := 'org_' || replace(gen_random_uuid()::text, '-', '');
    begin
      perform private.assert_billing_service();

      select * into purchase
      from private.company_purchases
      where id = p_purchase_id
      for update;

      if not found then
        return jsonb_build_object('status', 'missing');
      end if;

      if purchase.status = 'opened' then
        update public.organizations
        set
          data = coalesce(data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'stripeCustomerId', purchase.stripe_customer_id,
            'stripeSubscriptionId', purchase.stripe_subscription_id
          )),
          updated_at = now()
        where id = purchase.org_id;
        return jsonb_build_object('orgId', purchase.org_id, 'status', 'opened', 'alreadyOpened', true);
      end if;

      if purchase.status <> 'pending' then
        return jsonb_build_object('status', 'failed', 'previousStatus', purchase.status,
                                  'error', coalesce(purchase.failure_reason, 'Purchase is not pending'));
      end if;

      if exists (select 1 from auth.users where lower(email) = purchase.email) then
        update private.company_purchases
        set status = 'failed',
            failure_reason = 'An account with this email already exists',
            password_hash = '',
            updated_at = now()
        where id = purchase.id;
        return jsonb_build_object('status', 'failed', 'error', 'An account with this email already exists');
      end if;

      begin
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, email_change, email_change_token_new, recovery_token
        ) values (
          '00000000-0000-0000-0000-000000000000',
          new_user_id,
          'authenticated',
          'authenticated',
          purchase.email,
          purchase.password_hash,
          now(),
          jsonb_build_object(
            'provider', 'email',
            'providers', jsonb_build_array('email'),
            'role', 'owner',
            'orgId', new_org_id,
            'tier', 'company',
            'business_uid', new_user_id::text
          ),
          jsonb_build_object('displayName', purchase.admin_name, 'full_name', purchase.admin_name),
          now(), now(), '', '', '', ''
        );

        if exists (
          select 1 from information_schema.columns
          where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
        ) then
          insert into auth.identities (
            id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
          ) values (
            gen_random_uuid(), new_user_id,
            jsonb_build_object('sub', new_user_id::text, 'email', purchase.email, 'email_verified', true),
            'email', new_user_id::text, now(), now(), now()
          );
        else
          insert into auth.identities (
            id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
          ) values (
            gen_random_uuid(), new_user_id,
            jsonb_build_object('sub', new_user_id::text, 'email', purchase.email, 'email_verified', true),
            'email', now(), now(), now()
          );
        end if;

        insert into public.organizations (id, org_id, user_id, data)
        values (
          new_org_id, new_org_id, new_user_id::text,
          jsonb_build_object(
            'name', purchase.company_name,
            'orgId', new_org_id,
            'ownerId', new_user_id::text,
            'createdAt', now(),
            'status', 'active',
            'billingStatus', 'active',
            'stripeCustomerId', purchase.stripe_customer_id,
            'stripeSubscriptionId', purchase.stripe_subscription_id
          )
        );

        update public.profiles
        set
          org_id = new_org_id,
          user_id = new_user_id::text,
          auth_id = new_user_id,
          data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
            'uid', new_user_id::text, 'email', purchase.email, 'displayName', purchase.admin_name,
            'role', 'owner', 'tier', 'company', 'orgId', new_org_id, 'status', 'active'
          )
        where id = new_user_id::text;

        if not found then
          insert into public.profiles (id, org_id, user_id, auth_id, data)
          values (
            new_user_id::text, new_org_id, new_user_id::text, new_user_id,
            jsonb_build_object(
              'uid', new_user_id::text, 'email', purchase.email, 'displayName', purchase.admin_name,
              'role', 'owner', 'tier', 'company', 'orgId', new_org_id, 'status', 'active'
            )
          );
        end if;

        insert into public.org_members (id, org_id, user_id, auth_id, data)
        values (
          new_org_id || '_' || new_user_id::text, new_org_id, new_user_id::text, new_user_id,
          jsonb_build_object('role', 'owner', 'email', purchase.email,
                             'displayName', purchase.admin_name, 'orgId', new_org_id)
        );

        update private.company_purchases
        set org_id = new_org_id, status = 'opened', failure_reason = null,
            password_hash = '', updated_at = now()
        where id = purchase.id;

        return jsonb_build_object('orgId', new_org_id, 'userId', new_user_id::text, 'status', 'opened');
      exception
        when unique_violation then
          update private.company_purchases
          set status = 'failed',
              failure_reason = 'An account with this email already exists',
              password_hash = '',
              updated_at = now()
          where id = purchase.id;
          return jsonb_build_object('status', 'failed', 'error', 'An account with this email already exists');
      end;
    end;
    $body$
  $fn$;

  revoke all on function private.list_failed_purchases() from public, anon;
  revoke all on function public.list_failed_purchases() from public, anon;
  grant execute on function private.list_failed_purchases() to authenticated;
  grant execute on function public.list_failed_purchases() to authenticated;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- 3. Hosted shape: the already-opened path of open_paid_company must not re-activate billing.
-- ---------------------------------------------------------------------------
do $outer$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'subscription_status'
  ) then
    return;
  end if;

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
          stripe_customer_id = coalesce(nullif(purchase.stripe_customer_id, ''), stripe_customer_id),
          stripe_subscription_id = coalesce(nullif(purchase.stripe_subscription_id, ''), stripe_subscription_id)
        where id = purchase.org_id;
        return jsonb_build_object('orgId', purchase.org_id, 'status', 'opened', 'alreadyOpened', true);
      end if;

      if purchase.status <> 'pending' then
        return jsonb_build_object('status', 'failed', 'previousStatus', purchase.status,
                                  'error', purchase.failure_reason);
      end if;

      begin
        opened := private.provision_company_admin(
          purchase.company_name, purchase.admin_name, purchase.email, purchase.password_hash,
          'apps', 'active', purchase.stripe_customer_id, purchase.stripe_subscription_id
        );
        update private.company_purchases
        set org_id = (opened->>'orgId')::uuid, status = 'opened', failure_reason = null, updated_at = now()
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
end;
$outer$;
