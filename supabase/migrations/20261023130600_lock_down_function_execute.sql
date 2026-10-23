-- Least-privilege EXECUTE on database functions (review C1, H1, M6).
--
-- Supabase grants EXECUTE on every new function to PUBLIC/anon/authenticated by default, and
-- PostgREST exposes every public function at /rest/v1/rpc. Internal SECURITY DEFINER helpers
-- (collect_admin_identity_ids, expand_person_ids, aggregate_health_scores, provision_company_admin,
-- trigger functions, ...) were therefore callable by anyone with the anon key.
--
-- This migration runs last in the security batch so it also covers the functions created above:
--   1. revoke EXECUTE on every function in public and private from PUBLIC, anon, authenticated;
--   2. grant authenticated only what RLS policies and the portals call;
--   3. service_role keeps everything;
--   4. stop granting EXECUTE on future functions by default (new functions need explicit grants).
-- Trigger functions do not need EXECUTE to fire, and helpers called from SECURITY DEFINER
-- functions run as the function owner.

do $outer$
declare
  fn record;
  allow text[] := array[
    -- helpers referenced by RLS policies (directly or through invoker helpers)
    'public.app_role()',
    'public.current_org_id()',
    'public.company_is_active(text)',
    'public.in_current_circle(text)',
    'public.is_company_admin()',
    'public.is_company_staff()',
    'public.is_admin()',
    'public.self_is_admin()',
    'public.jwt_claim(text)',
    'public.jwt_uid()',
    'public.owns_row(text)',
    'public.self_identity_ids()',
    'public.can_access_row(text, text)',
    'public.circle_business_access(text, text)',
    'public.can_access_project(text, jsonb)',
    'public.can_access_project_id(text)',
    'public.can_access_project_membership(text, jsonb)',
    'public.can_access_task(jsonb)',
    'public.social_post_reminder_visible(jsonb)',
    'public.same_company_org(text)',
    'public.company_org_id()',
    'public.is_platform_operator()',
    'private.is_end_user_request()',
    -- relational (hosted) shape helpers, only present there
    'private.member_org_ids()',
    'private.member_org_ids_any()',
    'private.member_org_ids_with_roles(text[])',
    'public.current_membership()',
    'public.check_desktop_entitlement()',
    'private.self_claim_ids()',
    -- RPCs called from the portals (each checks the caller itself)
    'public.current_company_status()',
    'public.list_work_timeline_entries(text[], text, text)',
    'public.save_employee_onboarding_draft(jsonb)',
    'private.save_employee_onboarding_draft(jsonb)',
    'public.submit_employee_onboarding(jsonb)',
    'private.submit_employee_onboarding(jsonb)',
    'public.create_company_as_operator(text, text, text, text)',
    'private.create_company_as_operator(text, text, text, text)',
    'public.list_companies()',
    'private.list_companies()',
    'public.list_failed_purchases()',
    'private.list_failed_purchases()',
    'public.set_company_status(text, text)',
    'private.set_company_status(text, text)',
    'public.set_company_status(uuid, text)',
    'private.set_company_status(uuid, text)',
    'public.trash_project(text, jsonb)',
    'public.restore_project(text)',
    'public.purge_project(text)'
  ];
  sig text;
begin
  for fn in
    select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated',
                   fn.nspname, fn.proname, fn.args);
    execute format('grant execute on function %I.%I(%s) to service_role',
                   fn.nspname, fn.proname, fn.args);
  end loop;

  foreach sig in array allow loop
    if to_regprocedure(sig) is not null then
      execute format('grant execute on function %s to authenticated', to_regprocedure(sig)::text);
    end if;
  end loop;
end;
$outer$;

-- anon has no business in the private schema.
revoke usage on schema private from anon;
revoke usage on schema private from public;
grant usage on schema private to authenticated, service_role;

-- New functions are no longer executable by everyone by default.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema private revoke execute on functions from anon, authenticated;
