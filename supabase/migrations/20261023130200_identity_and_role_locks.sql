-- In-company privilege locks (review H5, H6, M2, M3, M5).
--
-- RLS lets users write their own profiles/employees rows. Before this migration a user could
-- rewrite the identity columns of that row (auth_id, data.uid, data.employeeId, data.role, ...),
-- which self_identity_ids()/owns_row() and sync_profile_claims() trust. That allowed taking over
-- other people's rows and files, re-pointing another auth user's business_uid, and self-promotion
-- in code that reads data.role.
--
-- The guards below are invoker triggers that only apply to end-user requests
-- (current_user = authenticated/anon). Definer functions and the service role are unaffected.
-- Company admins keep full access inside their company, except that nobody can re-point an
-- auth link (auth_id) to a different auth user through the API.

create or replace function private.is_end_user_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

create or replace function private.self_claim_ids()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array_remove(array[auth.uid()::text, public.jwt_uid()], null);
$$;

-- Shared check for profiles and employees.
create or replace function private.guard_person_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  admin_caller boolean;
  protected_keys text[] := array[
    'role', 'uid', 'employeeId', 'email', 'orgId', 'tier', 'status', 'platform_role',
    'business_uid', 'auth_id', 'authId', 'isAdmin', 'permissions', 'skipAgreements',
    'approvedAt', 'approvedBy', 'rejectionReason'
  ];
  -- Keys an employee may change on their own employees row (profile photo, quote, contact).
  employee_self_keys text[] := array[
    'quote', 'proverb', 'quoteUpdatedAt', 'updatedAt', 'photoURL', 'avatar', 'photoStoragePath',
    'phoneNumber', 'displayName', 'lastSeenAt', 'fcmTokens', 'notificationPrefs', 'timezone', 'locale'
  ];
  k text;
  old_data jsonb;
  new_data jsonb;
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not private.is_end_user_request() then
    return coalesce(new, old);
  end if;

  admin_caller := public.is_company_admin();

  if tg_op = 'INSERT' then
    -- An upsert on an existing row first fires BEFORE INSERT with the proposed row; the
    -- BEFORE UPDATE check below then applies, so only genuinely new rows are checked here.
    if tg_table_name = 'profiles' then
      perform 1 from public.profiles where id = new.id;
    else
      perform 1 from public.employees where id = new.id;
    end if;
    if found then
      return new;
    end if;

    if new.auth_id is not null and new.auth_id is distinct from auth.uid() then
      raise exception 'auth_id can only point at your own account' using errcode = '42501';
    end if;

    if admin_caller then
      return new;
    end if;

    new_data := coalesce(new.data, '{}'::jsonb);
    if not (new.id = any (private.self_claim_ids())) then
      raise exception 'You can only create your own record' using errcode = '42501';
    end if;
    if nullif(new_data->>'uid', '') is not null and not ((new_data->>'uid') = any (private.self_claim_ids())) then
      raise exception 'uid must be your own' using errcode = '42501';
    end if;
    if nullif(new_data->>'employeeId', '') is not null and not ((new_data->>'employeeId') = any (private.self_claim_ids())) then
      raise exception 'employeeId must be your own' using errcode = '42501';
    end if;
    if nullif(new_data->>'email', '') is not null and lower(new_data->>'email') <> jwt_email then
      raise exception 'email must be your sign-in email' using errcode = '42501';
    end if;
    if nullif(new_data->>'role', '') is not null and lower(new_data->>'role') <> public.app_role() then
      raise exception 'role is assigned by your company admin' using errcode = '42501';
    end if;
    if coalesce(nullif(new_data->>'status', ''), 'active') <> 'active' then
      raise exception 'status is assigned by your company admin' using errcode = '42501';
    end if;
    foreach k in array array['tier', 'platform_role', 'business_uid', 'isAdmin', 'permissions',
                             'skipAgreements', 'approvedAt', 'approvedBy'] loop
      if new_data ? k then
        raise exception '% is assigned by your company admin', k using errcode = '42501';
      end if;
    end loop;
    if tg_table_name = 'profiles'
       and coalesce(new_data->>'onboardingStatus', '') not in ('', 'pending', 'pending_signature', 'pending_approval') then
      raise exception 'onboardingStatus is assigned by your company admin' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not admin_caller then
      raise exception 'Only a company admin can delete people' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.id is distinct from old.id then
    raise exception 'id cannot be changed' using errcode = '42501';
  end if;
  if new.org_id is distinct from old.org_id then
    raise exception 'company cannot be changed' using errcode = '42501';
  end if;
  if new.auth_id is distinct from old.auth_id
     and not (old.auth_id is null and new.auth_id = auth.uid()) then
    raise exception 'auth_id cannot be changed' using errcode = '42501';
  end if;

  if admin_caller then
    return new;
  end if;

  -- The browser recomputes user_id from data; keep the stored owner.
  new.user_id := old.user_id;

  old_data := coalesce(old.data, '{}'::jsonb);
  new_data := coalesce(new.data, '{}'::jsonb);

  if tg_table_name = 'employees' then
    for k in
      select key from (
        select key from jsonb_each(new_data)
        union
        select key from jsonb_each(old_data)
      ) s
    loop
      if (new_data -> k) is distinct from (old_data -> k) and not (k = any (employee_self_keys)) then
        raise exception 'Only your company admin can change "%"', k using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;

  -- profiles
  foreach k in array protected_keys loop
    if (new_data -> k) is distinct from (old_data -> k) then
      if k = 'email' and nullif(old_data->>'email', '') is null and lower(new_data->>'email') = jwt_email then
        continue;
      end if;
      if k = 'uid' and nullif(old_data->>'uid', '') is null and (new_data->>'uid') = any (private.self_claim_ids()) then
        continue;
      end if;
      raise exception 'Only your company admin can change "%"', k using errcode = '42501';
    end if;
  end loop;

  if (new_data -> 'onboardingStatus') is distinct from (old_data -> 'onboardingStatus')
     and coalesce(new_data->>'onboardingStatus', '') not in ('pending_signature', 'pending_approval') then
    raise exception 'onboardingStatus is set by your company admin' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Plaintext passwords are never stored in profile documents (review C4).
create or replace function private.strip_profile_secrets()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.data ? 'loginPassword' or new.data ? 'password' then
    new.data := new.data - 'loginPassword' - 'password';
  end if;
  return new;
end;
$$;

do $outer$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'data'
  ) then
    return;
  end if;

  -- Trigger names sort after trg_default_org_id so they see the final org stamp.
  execute 'drop trigger if exists zz_guard_person_row on public.profiles';
  execute 'create trigger zz_guard_person_row before insert or update or delete on public.profiles
           for each row execute function private.guard_person_row()';
  execute 'drop trigger if exists zz_guard_person_row on public.employees';
  execute 'create trigger zz_guard_person_row before insert or update or delete on public.employees
           for each row execute function private.guard_person_row()';
  execute 'drop trigger if exists aa_strip_profile_secrets on public.profiles';
  execute 'create trigger aa_strip_profile_secrets before insert or update on public.profiles
           for each row execute function private.strip_profile_secrets()';

  -- sync_profile_claims writes auth.users.raw_app_meta_data. It must never re-target an auth user
  -- that belongs to another company, and an end user may only sync their own account.
  execute $fn$
    create or replace function public.sync_profile_claims()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      target uuid;
      existing jsonb;
      next_meta jsonb;
      next_org text;
      row_org text := coalesce(nullif(new.org_id, ''), nullif(new.data->>'orgId', ''));
      caller_role text := coalesce(auth.jwt() ->> 'role', '');
    begin
      target := coalesce(new.auth_id, case when new.id ~* '^[0-9a-f-]{36}$' then new.id::uuid else null end);
      if target is null then
        return new;
      end if;

      if caller_role in ('authenticated', 'anon') and target is distinct from auth.uid() then
        -- Admin edits of other people's rows never rewrite those people's sign-in claims.
        return new;
      end if;

      select coalesce(raw_app_meta_data, '{}'::jsonb)
        into existing
      from auth.users
      where id = target;

      if not found then
        return new;
      end if;

      if nullif(existing->>'orgId', '') is not null
         and row_org is not null
         and existing->>'orgId' <> row_org then
        return new;
      end if;

      if caller_role in ('authenticated', 'anon') then
        -- Self-service writes never move an existing business id or tier.
        next_meta := existing || jsonb_build_object(
          'business_uid', coalesce(nullif(existing->>'business_uid', ''), new.id),
          'tier', coalesce(nullif(existing->>'tier', ''), 'company')
        );
      else
        next_meta := existing || jsonb_build_object(
          'business_uid', new.id,
          'tier', coalesce(nullif(new.data->>'tier', ''), nullif(existing->>'tier', ''), 'company')
        );
      end if;

      if nullif(existing->>'orgId', '') is null and caller_role not in ('authenticated', 'anon') then
        next_org := row_org;
        if next_org is not null then
          next_meta := next_meta || jsonb_build_object('orgId', next_org);
        end if;
      end if;

      if nullif(existing->>'role', '') is null and caller_role not in ('authenticated', 'anon') then
        next_meta := next_meta || jsonb_build_object(
          'role', coalesce(nullif(new.data->>'role', ''), 'employee')
        );
      end if;

      if next_meta is distinct from existing then
        update auth.users
        set raw_app_meta_data = next_meta
        where id = target;
      end if;

      return new;
    end;
    $body$
  $fn$;
end;
$outer$;

-- Invoices: clients may only mark their own invoice as paid (existing client-portal flow);
-- every other change is admin-only.
create or replace function private.guard_invoice_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed_keys text[] := array['status', 'paidAt', 'updatedAt'];
  k text;
begin
  if not private.is_end_user_request() or public.is_company_admin() then
    return new;
  end if;

  new.user_id := old.user_id;
  new.org_id := old.org_id;
  for k in
    select key from (
      select key from jsonb_each(coalesce(new.data, '{}'::jsonb))
      union
      select key from jsonb_each(coalesce(old.data, '{}'::jsonb))
    ) s
  loop
    if (new.data -> k) is distinct from (old.data -> k) and not (k = any (allowed_keys)) then
      raise exception 'Only your company admin can change "%"', k using errcode = '42501';
    end if;
  end loop;
  if (new.data -> 'status') is distinct from (old.data -> 'status')
     and coalesce(new.data->>'status', '') <> 'Paid' then
    raise exception 'Invoice status can only be marked Paid' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Client onboarding: the client fills in the form, the admin approves it.
create or replace function private.guard_client_onboarding_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_end_user_request() or public.is_company_admin() then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.org_id := old.org_id;
    if (new.data -> 'onboardingStatus') is not distinct from (old.data -> 'onboardingStatus') then
      return new;
    end if;
  end if;
  if coalesce(new.data->>'onboardingStatus', '') not in ('', 'pending', 'pending_signature', 'pending_approval') then
    raise exception 'onboardingStatus is set by your company admin' using errcode = '42501';
  end if;
  if (new.data ? 'approvedAt' or new.data ? 'approvedBy')
     and (tg_op = 'INSERT' or (new.data->'approvedAt') is distinct from (old.data->'approvedAt')
          or (new.data->'approvedBy') is distinct from (old.data->'approvedBy')) then
    raise exception 'Approval is set by your company admin' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $outer$
begin
  if to_regclass('public.invoices') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'data'
  ) then
    execute 'drop trigger if exists zz_guard_invoice_row on public.invoices';
    execute 'create trigger zz_guard_invoice_row before update on public.invoices
             for each row execute function private.guard_invoice_row()';
  end if;
  if to_regclass('public.client_onboarding') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'client_onboarding' and column_name = 'data'
  ) then
    execute 'drop trigger if exists zz_guard_client_onboarding_row on public.client_onboarding';
    execute 'create trigger zz_guard_client_onboarding_row before insert or update on public.client_onboarding
             for each row execute function private.guard_client_onboarding_row()';
  end if;
end;
$outer$;

revoke all on function private.is_end_user_request() from public, anon, authenticated;
revoke all on function private.self_claim_ids() from public, anon, authenticated;
revoke all on function private.guard_person_row() from public, anon, authenticated;
revoke all on function private.strip_profile_secrets() from public, anon, authenticated;
revoke all on function private.guard_invoice_row() from public, anon, authenticated;
revoke all on function private.guard_client_onboarding_row() from public, anon, authenticated;
-- The guards are invoker functions that call these helpers as the requesting role.
grant execute on function private.is_end_user_request() to authenticated, service_role;
grant execute on function private.self_claim_ids() to authenticated, service_role;
