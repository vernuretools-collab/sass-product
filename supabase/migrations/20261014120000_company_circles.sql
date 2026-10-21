-- Each company is a circle. Access uses app_metadata.orgId only.
-- A company admin cannot read another company's employees, clients, or projects.

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.current_org_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'orgId', '');
$$;

create or replace function public.jwt_claim(key text)
returns text
language sql
stable
as $$
  select case
    when key = 'role' then nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')
    else coalesce(
      auth.jwt() -> 'app_metadata' ->> key,
      case when key = 'role' then null else auth.jwt() ->> key end
    )
  end;
$$;

create or replace function public.app_role()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', ''));
$$;

create or replace function public.is_company_admin()
returns boolean
language sql
stable
as $$
  select
    public.current_org_id() is not null
    and public.app_role() in ('admin', 'owner', 'superadmin');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.is_company_admin();
$$;

create or replace function public.self_is_admin()
returns boolean
language sql
stable
as $$
  select public.is_company_admin();
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
    and row_org = public.current_org_id();
$$;

create or replace function public.same_company_org(row_org text)
returns boolean
language sql
stable
as $$
  select public.in_current_circle(row_org);
$$;

create or replace function public.company_org_id()
returns text
language sql
stable
as $$
  select public.current_org_id();
$$;

-- Identity aliases stay inside the signed-in circle.
create or replace function public.self_identity_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct v), '{}'::text[])
  from (
    select auth.uid()::text as v
    union select public.jwt_uid()
    union select p.id from public.profiles p
      where p.auth_id = auth.uid() and public.in_current_circle(p.org_id)
    union select p.user_id from public.profiles p
      where p.auth_id = auth.uid() and public.in_current_circle(p.org_id)
    union select p.data->>'uid' from public.profiles p
      where p.auth_id = auth.uid() and public.in_current_circle(p.org_id)
    union select p.data->>'employeeId' from public.profiles p
      where p.auth_id = auth.uid() and public.in_current_circle(p.org_id)
    union select e.id from public.employees e
      where e.auth_id = auth.uid() and public.in_current_circle(e.org_id)
    union select e.user_id from public.employees e
      where e.auth_id = auth.uid() and public.in_current_circle(e.org_id)
    union select e.data->>'uid' from public.employees e
      where e.auth_id = auth.uid() and public.in_current_circle(e.org_id)
    union select e.data->>'employeeId' from public.employees e
      where e.auth_id = auth.uid() and public.in_current_circle(e.org_id)
    union select e.id from public.employees e
      where public.in_current_circle(e.org_id)
        and nullif(lower(e.data->>'email'), '') = lower(auth.jwt() ->> 'email')
    union select e.user_id from public.employees e
      where public.in_current_circle(e.org_id)
        and nullif(lower(e.data->>'email'), '') = lower(auth.jwt() ->> 'email')
    union select e.data->>'uid' from public.employees e
      where public.in_current_circle(e.org_id)
        and nullif(lower(e.data->>'email'), '') = lower(auth.jwt() ->> 'email')
    union select p.id from public.profiles p
      where public.in_current_circle(p.org_id)
        and nullif(lower(p.data->>'email'), '') = lower(auth.jwt() ->> 'email')
    union select p.data->>'uid' from public.profiles p
      where public.in_current_circle(p.org_id)
        and nullif(lower(p.data->>'email'), '') = lower(auth.jwt() ->> 'email')
  ) s
  where v is not null and v <> '';
$$;

create or replace function public.can_access_row(org_id text, user_id text)
returns boolean
language sql
stable
as $$
  select
    auth.uid() is not null
    and public.in_current_circle(org_id)
    and (
      public.is_company_admin()
      or public.app_role() = 'employee'
      or public.owns_row(user_id)
    );
$$;

-- Stamp the signed-in circle. Never fall back to a shared org_demo.
create or replace function public.default_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_org_id() is not null then
    new.org_id := public.current_org_id();
  elsif new.org_id is null or new.org_id = '' then
    new.org_id := nullif(new.data->>'orgId', '');
  end if;
  if new.org_id is not null and new.org_id <> '' then
    new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('orgId', new.org_id);
  end if;
  return new;
end;
$$;

-- Keep an existing circle and role. A user cannot move themselves by editing profile data.
create or replace function public.sync_profile_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  existing jsonb;
  next_meta jsonb;
  next_org text;
begin
  target := coalesce(new.auth_id, case when new.id ~* '^[0-9a-f-]{36}$' then new.id::uuid else null end);
  if target is null then
    return new;
  end if;

  select coalesce(raw_app_meta_data, '{}'::jsonb)
    into existing
  from auth.users
  where id = target;

  next_meta := existing || jsonb_build_object(
    'business_uid', new.id,
    'tier', coalesce(nullif(new.data->>'tier', ''), nullif(existing->>'tier', ''), 'company')
  );

  if nullif(existing->>'orgId', '') is null then
    next_org := coalesce(nullif(new.data->>'orgId', ''), nullif(new.org_id, ''));
    if next_org is not null then
      next_meta := next_meta || jsonb_build_object('orgId', next_org);
    end if;
  end if;

  if nullif(existing->>'role', '') is null then
    next_meta := next_meta || jsonb_build_object(
      'role', coalesce(nullif(new.data->>'role', ''), 'employee')
    );
  end if;

  update auth.users
  set raw_app_meta_data = next_meta
  where id = target;

  return new;
end;
$$;

create or replace function public.circle_business_access(row_org text, row_user_id text)
returns boolean
language sql
stable
as $$
  select public.can_access_row(row_org, row_user_id);
$$;

-- Projects stay limited to the people on them, and also to this circle.
create or replace function public.can_access_project(row_id text, row_data jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      not exists (select 1 from public.projects p where p.id = row_id)
      or exists (
        select 1 from public.projects p
        where p.id = row_id and public.in_current_circle(p.org_id)
      )
    )
    and (
      public.is_company_admin()
      or exists (
        select 1
        from public.expand_person_ids(array(
          select c.user_id
          from public.collect_project_member_ids(coalesce(row_data, '{}'::jsonb)) c
        )) m
        where m.user_id = any (public.self_identity_ids())
      )
      or exists (
        select 1
        from public.tasks t
        where t.data->>'projectId' = row_id
          and public.in_current_circle(t.org_id)
          and exists (
            select 1
            from public.expand_person_ids(array(
              select a.user_id
              from public.collect_task_assignee_ids(coalesce(t.data, '{}'::jsonb)) a
            )) x
            where x.user_id = any (public.self_identity_ids())
          )
      )
      or (
        public.app_role() = 'client'
        and coalesce(row_data->>'clientId', '') <> ''
        and row_data->>'clientId' = any (public.self_identity_ids())
      )
    );
$$;

create or replace function public.can_access_project_id(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and public.in_current_circle(p.org_id)
      and public.can_access_project(p.id, p.data)
  );
$$;

create or replace function public.can_access_task(row_data jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.is_company_admin()
      or exists (
        select 1
        from public.expand_person_ids(array(
          select a.user_id
          from public.collect_task_assignee_ids(coalesce(row_data, '{}'::jsonb)) a
        )) x
        where x.user_id = any (public.self_identity_ids())
      )
      or public.can_access_project_id(coalesce(row_data->>'projectId', ''))
    );
$$;

create or replace function public.list_work_timeline_entries(
  p_uids text[],
  p_start text,
  p_end text
)
returns setof public.work_timeline_entries
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.work_timeline_entries e
  where public.in_current_circle(e.org_id)
    and (e.data->>'uid') = any (coalesce(p_uids, '{}'::text[]))
    and (e.data->>'date') >= coalesce(p_start, '')
    and (e.data->>'date') <= coalesce(p_end, '9999-12-31')
    and (
      public.is_company_admin()
      or e.user_id = any (public.self_identity_ids())
      or (e.data->>'uid') = any (public.self_identity_ids())
    )
  limit 500;
$$;

do $$
declare
  t text;
  business text[] := array[
    'organizations','org_members','leads','org_notifications',
    'invoices','health_scores','crm_stages','expenses','expense_categories','retainers','company_settings',
    'deliverables','client_documents','attendance','attendance_logs','leave_requests','departments',
    'company_calendar','company_holidays','company_policies','announcements','help_desk_tickets','knowledge',
    'knowledge_articles','kpi_definitions','workflows','workflow_runs','app_docs','work_idle_days'
  ];
  private_tables text[] := array[
    'payslip_records','document_files','notification_items',
    'employee_monthly_reports','goal_items'
  ];
begin
  foreach t in array business loop
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.circle_business_access(org_id, user_id))',
      t||'_select', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.circle_business_access(org_id, user_id)) with check (public.circle_business_access(org_id, user_id))',
      t||'_write', t
    );
  end loop;

  foreach t in array private_tables loop
    execute format('drop policy if exists %I on public.%I', t||'_select', t);
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format('drop policy if exists %I on public.%I', t||'_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.in_current_circle(org_id) and (public.is_company_admin() or public.owns_row(user_id)))
         with check (public.in_current_circle(org_id) and (public.is_company_admin() or public.owns_row(user_id)))',
      t||'_owner', t
    );
  end loop;
end $$;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_write on public.profiles;
drop policy if exists profiles_self on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.in_current_circle(org_id)
    and (
      public.is_company_admin()
      or public.app_role() = 'employee'
      or auth_id = auth.uid()
      or id = public.jwt_uid()
    )
  );

create policy profiles_write on public.profiles
  for all to authenticated
  using (
    public.in_current_circle(org_id)
    and (public.is_company_admin() or auth_id = auth.uid() or id = public.jwt_uid())
  )
  with check (
    public.in_current_circle(org_id)
    and (public.is_company_admin() or auth_id = auth.uid() or id = public.jwt_uid())
  );

-- Clients do not see another company's staff, or the staff directory at all.
drop policy if exists employees_select on public.employees;
drop policy if exists employees_write on public.employees;

create policy employees_select on public.employees
  for select to authenticated
  using (
    public.in_current_circle(org_id)
    and (
      public.is_company_admin()
      or public.app_role() = 'employee'
      or public.owns_row(user_id)
    )
  );

create policy employees_write on public.employees
  for all to authenticated
  using (
    public.in_current_circle(org_id)
    and (public.is_company_admin() or public.owns_row(user_id))
  )
  with check (
    public.in_current_circle(org_id)
    and (public.is_company_admin() or public.owns_row(user_id))
  );

drop policy if exists client_onboarding_select on public.client_onboarding;
drop policy if exists client_onboarding_write on public.client_onboarding;

create policy client_onboarding_select on public.client_onboarding
  for select to authenticated
  using (
    public.in_current_circle(org_id)
    and (
      public.is_company_admin()
      or public.owns_row(user_id)
      or id = any (public.self_identity_ids())
    )
  );

create policy client_onboarding_write on public.client_onboarding
  for all to authenticated
  using (
    public.in_current_circle(org_id)
    and (public.is_company_admin() or public.owns_row(user_id))
  )
  with check (
    public.in_current_circle(org_id)
    and (public.is_company_admin() or public.owns_row(user_id))
  );

drop policy if exists projects_select on public.projects;
drop policy if exists projects_write on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.in_current_circle(org_id) and public.can_access_project(id, data));
create policy projects_write on public.projects
  for all to authenticated
  using (public.in_current_circle(org_id) and public.can_access_project(id, data))
  with check (
    public.in_current_circle(org_id)
    and (
      public.can_access_project(id, data)
      or coalesce(data->>'createdBy', '') = any (public.self_identity_ids())
    )
  );

drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_write on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.in_current_circle(org_id) and public.can_access_task(data));
create policy tasks_write on public.tasks
  for all to authenticated
  using (public.in_current_circle(org_id) and public.can_access_task(data))
  with check (
    public.in_current_circle(org_id)
    and (
      public.can_access_task(data)
      or coalesce(data->>'createdBy', '') = any (public.self_identity_ids())
    )
  );

drop policy if exists project_process_steps_select on public.project_process_steps;
drop policy if exists project_process_steps_write on public.project_process_steps;
create policy project_process_steps_select on public.project_process_steps
  for select to authenticated
  using (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(parent_id, data->>'projectId', ''))
  );
create policy project_process_steps_write on public.project_process_steps
  for all to authenticated
  using (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(parent_id, data->>'projectId', ''))
  )
  with check (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(parent_id, data->>'projectId', ''))
  );

drop policy if exists project_timeline_select on public.project_timeline;
drop policy if exists project_timeline_write on public.project_timeline;
create policy project_timeline_select on public.project_timeline
  for select to authenticated
  using (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(parent_id, data->>'projectId', ''))
  );
create policy project_timeline_write on public.project_timeline
  for all to authenticated
  using (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(parent_id, data->>'projectId', ''))
  )
  with check (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(parent_id, data->>'projectId', ''))
  );

drop policy if exists project_notes_select on public.project_notes;
drop policy if exists project_notes_write on public.project_notes;
create policy project_notes_select on public.project_notes
  for select to authenticated
  using (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(data->>'projectId', parent_id, ''))
  );
create policy project_notes_write on public.project_notes
  for all to authenticated
  using (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(data->>'projectId', parent_id, ''))
  )
  with check (
    public.in_current_circle(org_id)
    and public.can_access_project_id(coalesce(data->>'projectId', parent_id, ''))
  );

drop policy if exists work_timeline_entries_select on public.work_timeline_entries;
drop policy if exists work_timeline_entries_write on public.work_timeline_entries;
create policy work_timeline_entries_select on public.work_timeline_entries
  for select to authenticated
  using (
    public.in_current_circle(org_id)
    and (
      public.is_company_admin()
      or user_id = any (public.self_identity_ids())
      or (data->>'uid') = any (public.self_identity_ids())
    )
  );
create policy work_timeline_entries_write on public.work_timeline_entries
  for all to authenticated
  using (
    public.in_current_circle(org_id)
    and (
      public.is_company_admin()
      or user_id = any (public.self_identity_ids())
      or (data->>'uid') = any (public.self_identity_ids())
    )
  )
  with check (
    public.in_current_circle(org_id)
    and (
      public.is_company_admin()
      or user_id = any (public.self_identity_ids())
      or (data->>'uid') = any (public.self_identity_ids())
    )
  );

drop policy if exists social_post_reminder_items_select on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_write on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_insert on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_update on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_delete on public.social_post_reminder_items;

create policy social_post_reminder_items_select on public.social_post_reminder_items
  for select to authenticated
  using (public.in_current_circle(org_id) and public.social_post_reminder_visible(data));
create policy social_post_reminder_items_insert on public.social_post_reminder_items
  for insert to authenticated
  with check (public.in_current_circle(org_id) and public.social_post_reminder_visible(data));
create policy social_post_reminder_items_update on public.social_post_reminder_items
  for update to authenticated
  using (public.in_current_circle(org_id) and public.social_post_reminder_visible(data))
  with check (public.in_current_circle(org_id) and public.social_post_reminder_visible(data));
create policy social_post_reminder_items_delete on public.social_post_reminder_items
  for delete to authenticated
  using (public.in_current_circle(org_id) and public.social_post_reminder_visible(data));

drop policy if exists employee_onboarding_admin on public.employee_onboarding;
drop policy if exists employee_onboarding_self on public.employee_onboarding;
drop policy if exists employee_onboarding_self_update on public.employee_onboarding;
drop policy if exists employee_onboarding_admin_all on public.employee_onboarding;
drop policy if exists employee_onboarding_self_select on public.employee_onboarding;

create policy employee_onboarding_admin_all on public.employee_onboarding
  for all to authenticated
  using (public.in_current_circle(org_id) and public.is_company_admin())
  with check (public.in_current_circle(org_id) and public.is_company_admin());

create policy employee_onboarding_self_select on public.employee_onboarding
  for select to authenticated
  using (auth_id = auth.uid() and public.in_current_circle(org_id));

-- Company signup. Privileged work stays in private; the public wrapper is what the app calls.
create or replace function private.create_company_circle(
  p_company_name text,
  p_admin_name text,
  p_email text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_user_id uuid := gen_random_uuid();
  new_org_id text := 'org_' || replace(gen_random_uuid()::text, '-', '');
  clean_email text := lower(btrim(p_email));
  clean_company text := btrim(p_company_name);
  clean_name text := btrim(p_admin_name);
  hashed_password text;
begin
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
    clean_email,
    hashed_password,
    now(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email'),
      'role', 'owner',
      'orgId', new_org_id,
      'tier', 'company',
      'business_uid', new_user_id::text
    ),
    jsonb_build_object('displayName', clean_name, 'full_name', clean_name),
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
      jsonb_build_object('sub', new_user_id::text, 'email', clean_email, 'email_verified', true),
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
      jsonb_build_object('sub', new_user_id::text, 'email', clean_email, 'email_verified', true),
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
      'name', clean_company,
      'orgId', new_org_id,
      'ownerId', new_user_id::text,
      'createdAt', now()
    )
  );

  update public.profiles
  set
    org_id = new_org_id,
    user_id = new_user_id::text,
    auth_id = new_user_id,
    data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
      'uid', new_user_id::text,
      'email', clean_email,
      'displayName', clean_name,
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
        'email', clean_email,
        'displayName', clean_name,
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
      'email', clean_email,
      'displayName', clean_name,
      'orgId', new_org_id
    )
  );

  return jsonb_build_object('orgId', new_org_id, 'userId', new_user_id::text);
end;
$$;

create or replace function public.create_company_circle(
  p_company_name text,
  p_admin_name text,
  p_email text,
  p_password text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_company_circle(p_company_name, p_admin_name, p_email, p_password);
$$;

grant usage on schema private to anon, authenticated;
revoke all on function private.create_company_circle(text, text, text, text) from public;
revoke all on function public.create_company_circle(text, text, text, text) from public;
grant execute on function private.create_company_circle(text, text, text, text) to anon, authenticated;
grant execute on function public.create_company_circle(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
