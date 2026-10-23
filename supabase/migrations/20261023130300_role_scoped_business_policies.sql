-- Role-scoped write policies for business tables (review C3 organizations, H4, H6, M1).
--
-- Before: every *_write policy was circle_business_access(), so any employee could rewrite the
-- organizations row (including data.status / billingStatus), org_members, company settings,
-- invoices, expenses, leads, and so on.
-- After:
--   * organizations: members can read their own company; no browser writes at all. Operator and
--     billing changes go through set_company_status / set_company_billing_status.
--   * company configuration and finance tables: company admins write; employees read where the
--     portals need it; finance rows are readable only by admins and the row owner.
--   * shared work tables (deliverables, client documents, help desk, app docs): staff write;
--     clients write only their own rows.
--   * personal records (leave, attendance): admins or the owner.
--   * task_statuses: fixes "admin of any company" (OR is_admin() without a company check).
-- Admins keep full access inside their own company.

create or replace function public.is_company_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_company_admin() or public.app_role() = 'employee';
$$;

do $outer$
declare
  t text;
  admin_write text[] := array[
    'org_members', 'company_settings', 'expenses', 'expense_categories', 'retainers', 'leads',
    'crm_stages', 'health_scores', 'workflows', 'workflow_runs', 'departments', 'company_calendar',
    'company_holidays', 'company_policies', 'kpi_definitions', 'knowledge', 'knowledge_articles',
    'announcements', 'org_notifications', 'invoices'
  ];
  owner_read text[] := array[
    'expenses', 'expense_categories', 'retainers', 'leads', 'health_scores', 'workflows', 'workflow_runs'
  ];
  staff_write text[] := array['deliverables', 'client_documents', 'help_desk_tickets', 'app_docs'];
  owner_write text[] := array['leave_requests', 'attendance', 'attendance_logs', 'work_idle_days'];
begin
  -- Only the document-shaped schema uses these policy names; the hosted relational schema is
  -- covered by 20261023120000_company_policies.sql and its own role checks.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'data'
  ) then
    return;
  end if;

  -- organizations
  execute 'drop policy if exists organizations_select on public.organizations';
  execute 'drop policy if exists organizations_write on public.organizations';
  execute $p$
    create policy organizations_select on public.organizations
      for select to authenticated
      using (auth.uid() is not null and public.in_current_circle(id))
  $p$;

  foreach t in array admin_write loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (auth.uid() is not null and public.in_current_circle(org_id) and public.is_company_admin())
         with check (auth.uid() is not null and public.in_current_circle(org_id) and public.is_company_admin())',
      t || '_write', t
    );
  end loop;

  foreach t in array owner_read loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (auth.uid() is not null and public.in_current_circle(org_id)
                and (public.is_company_admin() or public.owns_row(user_id)))',
      t || '_select', t
    );
  end loop;

  -- Invoices: admins, the row owner, or the client named on the invoice can read; that client can
  -- mark it Paid (zz_guard_invoice_row limits the change).
  execute 'drop policy if exists invoices_select on public.invoices';
  execute $p$
    create policy invoices_select on public.invoices
      for select to authenticated
      using (
        auth.uid() is not null and public.in_current_circle(org_id)
        and (
          public.is_company_admin()
          or public.owns_row(user_id)
          or coalesce(data->>'clientId', '') = any (public.self_identity_ids())
        )
      )
  $p$;
  execute 'drop policy if exists invoices_client_mark_paid on public.invoices';
  execute $p$
    create policy invoices_client_mark_paid on public.invoices
      for update to authenticated
      using (
        auth.uid() is not null and public.in_current_circle(org_id)
        and (public.owns_row(user_id) or coalesce(data->>'clientId', '') = any (public.self_identity_ids()))
      )
      with check (
        auth.uid() is not null and public.in_current_circle(org_id)
        and (public.owns_row(user_id) or coalesce(data->>'clientId', '') = any (public.self_identity_ids()))
      )
  $p$;

  foreach t in array staff_write loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (auth.uid() is not null and public.in_current_circle(org_id)
                and (public.is_company_staff() or public.owns_row(user_id)))
         with check (auth.uid() is not null and public.in_current_circle(org_id)
                and (public.is_company_staff() or public.owns_row(user_id)))',
      t || '_write', t
    );
  end loop;

  foreach t in array owner_write loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (auth.uid() is not null and public.in_current_circle(org_id)
                and (public.is_company_admin() or public.owns_row(user_id)))
         with check (auth.uid() is not null and public.in_current_circle(org_id)
                and (public.is_company_admin() or public.owns_row(user_id)))',
      t || '_write', t
    );
  end loop;

  -- task_statuses: "or is_admin()" granted admins of any company access to every company's rows.
  if to_regclass('public.task_statuses') is not null then
    execute 'drop policy if exists task_statuses_select on public.task_statuses';
    execute 'drop policy if exists task_statuses_write on public.task_statuses';
    execute $p$
      create policy task_statuses_select on public.task_statuses
        for select to authenticated using (public.circle_business_access(org_id, user_id))
    $p$;
    execute $p$
      create policy task_statuses_write on public.task_statuses
        for all to authenticated
        using (public.circle_business_access(org_id, user_id))
        with check (public.circle_business_access(org_id, user_id))
    $p$;
  end if;

  -- Employee onboarding: the employee row is filled in through save/submit RPCs; admins manage it.
  -- (No change needed: employee_onboarding_admin_all + self_select already scope to the company.)
end;
$outer$;
