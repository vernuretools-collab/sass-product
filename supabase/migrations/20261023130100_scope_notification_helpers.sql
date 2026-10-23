-- Scope notification helpers to one company (review H1, M9, L3).
-- collect_admin_identity_ids() used to return every tenant's admin/owner ids and was callable by
-- anon. It now takes the company id, and every notification row carries the company id of the
-- row that caused it. Execute grants are revoked in 20261023130600.

do $outer$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_items' and column_name = 'data'
  ) then
    return;
  end if;

  execute $fn$
    create or replace function public.collect_admin_identity_ids(p_org_id text)
    returns table(user_id text)
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      select distinct uid
      from (
        select unnest(array[p.id, p.auth_id::text, nullif(p.data->>'uid', ''), nullif(p.user_id, '')]) as uid
        from public.profiles p
        where p.org_id = p_org_id
          and lower(coalesce(p.data->>'role', '')) in ('admin', 'owner', 'superadmin')
        union
        select unnest(array[e.id, e.auth_id::text, nullif(e.data->>'uid', ''), nullif(e.user_id, '')])
        from public.employees e
        where e.org_id = p_org_id
          and lower(coalesce(e.data->>'role', '')) in ('admin', 'owner', 'superadmin')
      ) s
      where coalesce(p_org_id, '') <> ''
        and uid is not null
        and uid <> '';
    $body$
  $fn$;

  -- The old unscoped variant is removed so nothing can enumerate admins across tenants.
  execute 'drop function if exists public.collect_admin_identity_ids()';

  execute $fn$
    create or replace function public.insert_inbox_notification(p_user_id text, p_data jsonb, p_org_id text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    begin
      if coalesce(p_user_id, '') = '' or coalesce(p_org_id, '') = '' then
        return;
      end if;
      insert into public.notification_items (id, org_id, user_id, data)
      values (gen_random_uuid()::text, p_org_id, p_user_id, coalesce(p_data, '{}'::jsonb) || jsonb_build_object('orgId', p_org_id));
    end;
    $body$
  $fn$;

  execute 'drop function if exists public.insert_inbox_notification(text, jsonb)';

  execute $fn$
    create or replace function public.notify_admins_on_employee_project()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      recip text;
      creator_name text;
      project_name text;
      payload jsonb;
      skip_ids text[];
    begin
      if lower(coalesce(new.data->>'createdByRole', '')) <> 'employee' then
        return new;
      end if;

      skip_ids := public.text_array_from_ids(array_remove(array[
        new.data->>'createdBy',
        new.data->>'createdByUid'
      ], null));

      project_name := coalesce(nullif(new.data->>'name', ''), 'a project');
      creator_name := coalesce(nullif(new.data->>'createdByName', ''), 'An employee');
      payload := jsonb_build_object(
        'title', 'New project created',
        'message', concat(creator_name, ' created "', project_name, '"'),
        'type', 'project',
        'isRead', false,
        'projectId', new.id,
        'link', '/projects/list',
        'adminLink', '/projects/list',
        'tag', concat('project-created-', new.id),
        'createdAt', now()::text
      );

      for recip in
        select a.user_id
        from public.collect_admin_identity_ids(new.org_id) a
        where not (a.user_id = any (coalesce(skip_ids, '{}'::text[])))
      loop
        perform public.insert_inbox_notification(recip, payload, new.org_id);
      end loop;

      return new;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.notify_on_project_assignment()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      recip text;
      project_name text;
      actor_name text;
      payload jsonb;
      old_ids text[];
      new_ids text[];
      added_ids text[];
      creator_ids text[];
    begin
      old_ids := '{}'::text[];
      if tg_op = 'UPDATE' then
        old_ids := public.text_array_from_ids(array(
          select c.user_id from public.collect_project_member_ids(coalesce(old.data, '{}'::jsonb)) c
        ));
      end if;
      new_ids := public.text_array_from_ids(array(
        select c.user_id from public.collect_project_member_ids(coalesce(new.data, '{}'::jsonb)) c
      ));
      creator_ids := public.text_array_from_ids(array_remove(array[
        new.data->>'createdBy',
        new.data->>'createdByUid'
      ], null));

      select coalesce(array_agg(x), '{}'::text[]) into added_ids
      from (
        select unnest(new_ids) as x
        except select unnest(old_ids)
        except select unnest(creator_ids)
      ) s;

      if added_ids is null or array_length(added_ids, 1) is null then
        return new;
      end if;

      project_name := coalesce(nullif(new.data->>'name', ''), 'a project');
      actor_name := coalesce(nullif(new.data->>'createdByName', ''), nullif(new.data->>'ownerName', ''), 'Your team');
      payload := jsonb_build_object(
        'title', 'Assigned to a project',
        'message', concat('You were assigned to "', project_name, '"'),
        'type', 'project',
        'isRead', false,
        'projectId', new.id,
        'link', '/projects/list',
        'adminLink', '/projects/list',
        'tag', concat('project-assigned-', new.id, '-', extract(epoch from now())::bigint),
        'createdAt', now()::text,
        'actorName', actor_name
      );

      for recip in select distinct unnest(added_ids) loop
        perform public.insert_inbox_notification(recip, payload, new.org_id);
      end loop;

      return new;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.notify_on_employee_task_status()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      recip text;
      actor_ids text[];
      proj record;
      project_name text;
      task_name text;
      actor_name text;
      payload jsonb;
      seed text[];
    begin
      if coalesce(old.data->>'status', '') is not distinct from coalesce(new.data->>'status', '') then
        return new;
      end if;
      if lower(coalesce(new.data->>'statusChangedByRole', '')) is distinct from 'employee' then
        return new;
      end if;

      seed := array_remove(array[new.data->>'statusChangedBy', new.data->>'statusChangedByUid'], null);
      if jsonb_typeof(new.data->'statusChangedByIds') = 'array' then
        seed := seed || array(
          select coalesce(nullif(elem #>> '{}', ''), elem->>'uid', elem->>'id')
          from jsonb_array_elements(new.data->'statusChangedByIds') elem
          where coalesce(nullif(elem #>> '{}', ''), elem->>'uid', elem->>'id') is not null
        );
      end if;
      actor_ids := public.text_array_from_ids(seed);

      -- Only look up the project inside the task's own company.
      select * into proj
      from public.projects p
      where p.org_id is not distinct from new.org_id
        and (p.id = coalesce(new.data->>'projectId', '') or p.data->>'projectId' = coalesce(new.data->>'projectId', ''))
      limit 1;

      project_name := coalesce(nullif(new.data->>'projectName', ''), nullif(proj.data->>'name', ''), 'a project');
      task_name := coalesce(nullif(new.data->>'title', ''), nullif(new.data->>'name', ''), 'a task');
      actor_name := coalesce(nullif(new.data->>'statusChangedByName', ''), 'An employee');

      payload := jsonb_build_object(
        'title', 'Task status updated',
        'message', concat(
          actor_name, ' moved "', task_name, '" from ', public.humanize_task_status(old.data->>'status'),
          ' to ', public.humanize_task_status(new.data->>'status'), ' on "', project_name, '"'
        ),
        'type', 'task',
        'isRead', false,
        'taskId', new.id,
        'projectId', coalesce(new.data->>'projectId', proj.id),
        'link', '/projects/tasks',
        'adminLink', '/projects/tasks',
        'tag', concat('task-status-', new.id, '-', coalesce(new.data->>'status', '')),
        'createdAt', now()::text
      );

      for recip in
        select distinct r.user_id
        from (
          select m.user_id
          from public.expand_person_ids(array(
            select c.user_id from public.collect_project_member_ids(coalesce(proj.data, '{}'::jsonb)) c
          )) m
          union
          select a.user_id
          from public.expand_person_ids(array(
            select t.user_id from public.collect_task_assignee_ids(coalesce(new.data, '{}'::jsonb)) t
          )) a
          union
          select ad.user_id from public.collect_admin_identity_ids(new.org_id) ad
        ) r
        where r.user_id is not null
          and r.user_id <> ''
          and not (r.user_id = any (coalesce(actor_ids, '{}'::text[])))
      loop
        perform public.insert_inbox_notification(recip, payload, new.org_id);
      end loop;

      return new;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.fanout_announcement()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    begin
      if coalesce(new.org_id, '') = '' then
        return new;
      end if;
      insert into public.notification_items (id, org_id, user_id, data)
      select
        gen_random_uuid()::text,
        new.org_id,
        e.id,
        jsonb_build_object(
          'title', concat('📢 ', coalesce(new.data->>'title', 'New Announcement')),
          'message', left(coalesce(new.data->>'body', ''), 120),
          'type', 'announcement',
          'isRead', false,
          'announcementId', new.id,
          'link', '/announcements',
          'createdAt', now()::text,
          'orgId', new.org_id
        )
      from public.employees e
      where e.org_id = new.org_id
        and coalesce(e.data->>'status', 'active') not in ('inactive', 'terminated');
      return new;
    end;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.purge_announcement_inbox()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    begin
      delete from public.notification_items
      where data->>'announcementId' = old.id
        and org_id is not distinct from old.org_id;
      return old;
    end;
    $body$
  $fn$;
end;
$outer$;
