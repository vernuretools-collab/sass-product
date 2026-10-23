-- Company setup inserted the first admin into employees, so the owner
-- showed up in the staff directory. Keep owners and admins on org_members
-- and profiles only.

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
  profile_data jsonb;
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
      'orgId', new_org_id::text,
      'tier', 'company'
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

  profile_data := jsonb_build_object(
    'uid', new_user_id::text,
    'email', clean_email,
    'displayName', clean_name,
    'role', 'owner',
    'tier', 'company',
    'orgId', new_org_id::text,
    'status', 'active'
  );

  insert into public.profiles (id, org_id, user_id, auth_id, data)
  values (new_user_id::text, new_org_id::text, new_user_id::text, new_user_id, profile_data)
  on conflict (id) do update
  set
    org_id = excluded.org_id,
    user_id = excluded.user_id,
    auth_id = excluded.auth_id,
    data = coalesce(public.profiles.data, '{}'::jsonb) || excluded.data,
    updated_at = now();

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'role', 'owner',
    'orgId', new_org_id::text,
    'tier', 'company'
  )
  where id = new_user_id;

  return jsonb_build_object('orgId', new_org_id, 'userId', new_user_id, 'status', 'opened');
end;
$body$;

delete from public.employees e
using public.org_members m
where m.user_id = e.user_id
  and m.org_id = e.org_id
  and lower(m.role) in ('owner', 'admin');
