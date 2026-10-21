-- Paid signups. The browser cannot open a company; only the billing service can.

create table private.company_purchases (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  admin_name text not null,
  email text not null,
  password_hash text not null,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  org_id text,
  status text not null default 'pending' check (status in ('pending', 'opened', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.company_purchases enable row level security;

revoke all on table private.company_purchases from public, anon, authenticated;

create unique index company_purchases_checkout_session_idx
  on private.company_purchases (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index company_purchases_subscription_idx
  on private.company_purchases (stripe_subscription_id)
  where stripe_subscription_id is not null;

create or replace function private.assert_billing_service()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Only the billing service can do this';
  end if;
end;
$$;

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
as $$
declare
  clean_email text := lower(btrim(p_email));
  clean_company text := btrim(p_company_name);
  clean_name text := btrim(p_admin_name);
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
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;
  if exists (select 1 from auth.users where lower(email) = clean_email) then
    raise exception 'An account with this email already exists';
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
$$;

create or replace function private.attach_stripe_checkout(
  p_purchase_id uuid,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_session text := btrim(coalesce(p_session_id, ''));
begin
  perform private.assert_billing_service();

  if clean_session = '' then
    raise exception 'Checkout session is required';
  end if;

  update private.company_purchases
  set
    stripe_checkout_session_id = clean_session,
    updated_at = now()
  where id = p_purchase_id
    and status = 'pending';

  if not found then
    raise exception 'Purchase not found';
  end if;

  return jsonb_build_object('purchaseId', p_purchase_id, 'sessionId', clean_session);
end;
$$;

create or replace function private.record_stripe_payment(
  p_purchase_id uuid,
  p_customer_id text,
  p_subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.open_paid_company(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase private.company_purchases%rowtype;
  new_user_id uuid := gen_random_uuid();
  new_org_id text := 'org_' || replace(gen_random_uuid()::text, '-', '');
begin
  perform private.assert_billing_service();

  select *
  into purchase
  from private.company_purchases
  where id = p_purchase_id
  for update;

  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  if purchase.status = 'opened' then
    update public.organizations
    set
      data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'status', 'active',
        'stripeCustomerId', purchase.stripe_customer_id,
        'stripeSubscriptionId', purchase.stripe_subscription_id
      ),
      updated_at = now()
    where id = purchase.org_id;

    return jsonb_build_object(
      'orgId', purchase.org_id,
      'status', 'opened',
      'alreadyOpened', true
    );
  end if;

  if purchase.status <> 'pending' then
    return jsonb_build_object('status', purchase.status, 'error', purchase.failure_reason);
  end if;

  if exists (select 1 from auth.users where lower(email) = purchase.email) then
    update private.company_purchases
    set
      status = 'failed',
      failure_reason = 'An account with this email already exists',
      updated_at = now()
    where id = purchase.id;

    return jsonb_build_object('status', 'failed', 'error', 'An account with this email already exists');
  end if;

  begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
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
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'identities'
      and column_name = 'provider_id'
  ) then
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', purchase.email, 'email_verified', true),
      'email',
      new_user_id::text,
      now(),
      now(),
      now()
    );
  else
    insert into auth.identities (
      id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', purchase.email, 'email_verified', true),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  insert into public.organizations (id, org_id, user_id, data)
  values (
    new_org_id,
    new_org_id,
    new_user_id::text,
    jsonb_build_object(
      'name', purchase.company_name,
      'orgId', new_org_id,
      'ownerId', new_user_id::text,
      'createdAt', now(),
      'status', 'active',
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
      'uid', new_user_id::text,
      'email', purchase.email,
      'displayName', purchase.admin_name,
      'role', 'owner',
      'tier', 'company',
      'orgId', new_org_id,
      'status', 'active'
    )
  where id = new_user_id::text;

  if not found then
    insert into public.profiles (id, org_id, user_id, auth_id, data)
    values (
      new_user_id::text,
      new_org_id,
      new_user_id::text,
      new_user_id,
      jsonb_build_object(
        'uid', new_user_id::text,
        'email', purchase.email,
        'displayName', purchase.admin_name,
        'role', 'owner',
        'tier', 'company',
        'orgId', new_org_id,
        'status', 'active'
      )
    );
  end if;

  insert into public.org_members (id, org_id, user_id, auth_id, data)
  values (
    new_org_id || '_' || new_user_id::text,
    new_org_id,
    new_user_id::text,
    new_user_id,
    jsonb_build_object(
      'role', 'owner',
      'email', purchase.email,
      'displayName', purchase.admin_name,
      'orgId', new_org_id
    )
  );

  update private.company_purchases
  set
    org_id = new_org_id,
    status = 'opened',
    failure_reason = null,
    updated_at = now()
  where id = purchase.id;

  return jsonb_build_object('orgId', new_org_id, 'userId', new_user_id::text, 'status', 'opened');
  exception
    when unique_violation then
      update private.company_purchases
      set
        status = 'failed',
        failure_reason = 'An account with this email already exists',
        updated_at = now()
      where id = purchase.id;

      return jsonb_build_object('status', 'failed', 'error', 'An account with this email already exists');
  end;
end;
$$;

create or replace function private.set_company_billing_status(
  p_subscription_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status text := lower(btrim(coalesce(p_status, '')));
  clean_subscription text := btrim(coalesce(p_subscription_id, ''));
  updated_org text;
begin
  perform private.assert_billing_service();

  if next_status not in ('active', 'suspended') then
    raise exception 'Status must be active or suspended';
  end if;
  if clean_subscription = '' then
    return jsonb_build_object('updated', false);
  end if;

  update public.organizations o
  set
    data = coalesce(o.data, '{}'::jsonb) || jsonb_build_object('status', next_status),
    updated_at = now()
  from private.company_purchases p
  where p.stripe_subscription_id = clean_subscription
    and p.status = 'opened'
    and p.org_id is not null
    and o.id = p.org_id
  returning o.id into updated_org;

  if updated_org is null then
    return jsonb_build_object('updated', false, 'subscriptionId', clean_subscription);
  end if;

  return jsonb_build_object('updated', true, 'orgId', updated_org, 'status', next_status);
end;
$$;

-- Public wrappers stay security invoker so the Data API can reach them.
-- Execute is limited to service_role. Privileged work stays in private.

create or replace function public.prepare_company_purchase(
  p_company_name text,
  p_admin_name text,
  p_email text,
  p_password text
)
returns uuid
language sql
security invoker
set search_path = public
as $$
  select private.prepare_company_purchase(p_company_name, p_admin_name, p_email, p_password);
$$;

create or replace function public.attach_stripe_checkout(
  p_purchase_id uuid,
  p_session_id text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.attach_stripe_checkout(p_purchase_id, p_session_id);
$$;

create or replace function public.record_stripe_payment(
  p_purchase_id uuid,
  p_customer_id text,
  p_subscription_id text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.record_stripe_payment(p_purchase_id, p_customer_id, p_subscription_id);
$$;

create or replace function public.open_paid_company(p_purchase_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.open_paid_company(p_purchase_id);
$$;

create or replace function public.set_company_billing_status(
  p_subscription_id text,
  p_status text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.set_company_billing_status(p_subscription_id, p_status);
$$;

revoke all on function private.assert_billing_service() from public, anon, authenticated;
revoke all on function private.prepare_company_purchase(text, text, text, text) from public, anon, authenticated;
revoke all on function private.attach_stripe_checkout(uuid, text) from public, anon, authenticated;
revoke all on function private.record_stripe_payment(uuid, text, text) from public, anon, authenticated;
revoke all on function private.open_paid_company(uuid) from public, anon, authenticated;
revoke all on function private.set_company_billing_status(text, text) from public, anon, authenticated;

revoke all on function public.prepare_company_purchase(text, text, text, text) from public, anon, authenticated;
revoke all on function public.attach_stripe_checkout(uuid, text) from public, anon, authenticated;
revoke all on function public.record_stripe_payment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.open_paid_company(uuid) from public, anon, authenticated;
revoke all on function public.set_company_billing_status(text, text) from public, anon, authenticated;

grant usage on schema private to service_role;
grant execute on function private.assert_billing_service() to service_role;
grant execute on function private.prepare_company_purchase(text, text, text, text) to service_role;
grant execute on function private.attach_stripe_checkout(uuid, text) to service_role;
grant execute on function private.record_stripe_payment(uuid, text, text) to service_role;
grant execute on function private.open_paid_company(uuid) to service_role;
grant execute on function private.set_company_billing_status(text, text) to service_role;

grant execute on function public.prepare_company_purchase(text, text, text, text) to service_role;
grant execute on function public.attach_stripe_checkout(uuid, text) to service_role;
grant execute on function public.record_stripe_payment(uuid, text, text) to service_role;
grant execute on function public.open_paid_company(uuid) to service_role;
grant execute on function public.set_company_billing_status(text, text) to service_role;

notify pgrst, 'reload schema';
