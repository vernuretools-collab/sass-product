-- Tenant-scoped storage (review C2, H3).
--
-- Object paths are now "<orgId>/<owner-or-client-id>/..." inside each bucket. Every policy
-- requires the first folder to be the caller's company and that company to be active
-- (in_current_circle). Before this, deliverables was a public bucket that any signed-in user of any
-- company could write, and employees/payslips/avatars were keyed only by person id.
--
-- Existing objects must be moved under their company folder (see the PR notes); the shared
-- storage adapter (shared/supabase/storageCompat.js) adds the company folder automatically.

update storage.buckets set public = false where id = 'deliverables';

drop policy if exists storage_employees_owner on storage.objects;
drop policy if exists storage_payslips_owner on storage.objects;
drop policy if exists storage_deliverables on storage.objects;
drop policy if exists storage_deliverables_public_read on storage.objects;
drop policy if exists storage_avatars_public_read on storage.objects;
drop policy if exists storage_avatars_owner_insert on storage.objects;
drop policy if exists storage_avatars_owner_update on storage.objects;
drop policy if exists storage_avatars_owner_delete on storage.objects;

-- employees: personal documents. Admins of the company, or the person named in folder 2.
create policy storage_employees_tenant on storage.objects
  for all to authenticated
  using (
    bucket_id = 'employees'
    and public.in_current_circle((storage.foldername(name))[1])
    and (public.is_company_admin() or (storage.foldername(name))[2] = any (public.self_identity_ids()))
  )
  with check (
    bucket_id = 'employees'
    and public.in_current_circle((storage.foldername(name))[1])
    and (public.is_company_admin() or (storage.foldername(name))[2] = any (public.self_identity_ids()))
  );

-- payslips: the employee can read their own; only admins write.
create policy storage_payslips_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payslips'
    and public.in_current_circle((storage.foldername(name))[1])
    and (public.is_company_admin() or (storage.foldername(name))[2] = any (public.self_identity_ids()))
  );
create policy storage_payslips_admin_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'payslips'
    and public.in_current_circle((storage.foldername(name))[1])
    and public.is_company_admin()
  )
  with check (
    bucket_id = 'payslips'
    and public.in_current_circle((storage.foldername(name))[1])
    and public.is_company_admin()
  );

-- deliverables: private. Staff of the company read and write; a client reads files in their own
-- folder (folder 2 = client id).
create policy storage_deliverables_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deliverables'
    and public.in_current_circle((storage.foldername(name))[1])
    and (
      public.is_company_staff()
      or (storage.foldername(name))[2] = any (public.self_identity_ids())
    )
  );
create policy storage_deliverables_staff_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'deliverables'
    and public.in_current_circle((storage.foldername(name))[1])
    and public.is_company_staff()
  )
  with check (
    bucket_id = 'deliverables'
    and public.in_current_circle((storage.foldername(name))[1])
    and public.is_company_staff()
  );

-- avatars: public read so directory cards can show photos; writes by the owner or an admin of
-- the same company.
create policy storage_avatars_public_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');
create policy storage_avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.in_current_circle((storage.foldername(name))[1])
    and (public.is_company_admin() or (storage.foldername(name))[2] = any (public.self_identity_ids()))
  );
create policy storage_avatars_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and public.in_current_circle((storage.foldername(name))[1])
    and (public.is_company_admin() or (storage.foldername(name))[2] = any (public.self_identity_ids()))
  )
  with check (
    bucket_id = 'avatars'
    and public.in_current_circle((storage.foldername(name))[1])
    and (public.is_company_admin() or (storage.foldername(name))[2] = any (public.self_identity_ids()))
  );
create policy storage_avatars_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and public.in_current_circle((storage.foldername(name))[1])
    and (public.is_company_admin() or (storage.foldername(name))[2] = any (public.self_identity_ids()))
  );
