-- Persona security tests for the local harness.
-- Usage (after apply.sh): psql -X -d harness -f supabase/tests/local-harness/security-tests.sql
-- Every check prints PASS/FAIL as a NOTICE; everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create schema t;
grant usage on schema t to anon, authenticated, service_role;

create table t.personas (name text primary key, db_role text not null, claims jsonb not null);
grant select on t.personas to anon, authenticated, service_role;

create function t.login(p_name text) returns void language plpgsql as $$
declare p t.personas;
begin
  select * into strict p from t.personas where name = p_name;
  perform set_config('request.jwt.claims', p.claims::text, true);
  perform set_config('role', p.db_role, true);
end $$;

create function t.ok(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %', label;
exception when others then
  raise notice 'FAIL  % (unexpected error: %)', label, sqlerrm;
end $$;

create function t.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  % (blocked: %)', label, left(sqlerrm, 90);
    return;
  end;
  raise notice 'FAIL  % (statement succeeded)', label;
end $$;

create function t.rows(label text, query text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) s', query) into n;
  if n = expected then raise notice 'PASS  % (% rows)', label, n;
  else raise notice 'FAIL  % (expected %, got %)', label, expected, n; end if;
exception when others then
  raise notice 'FAIL  % (error: %)', label, sqlerrm;
end $$;

create function t.affects(label text, stmt text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n = expected then raise notice 'PASS  % (% rows)', label, n;
  else raise notice 'FAIL  % (expected % rows, got %)', label, expected, n; end if;
exception when others then
  if expected = 0 then raise notice 'PASS  % (blocked: %)', label, left(sqlerrm, 90);
  else raise notice 'FAIL  % (error: %)', label, sqlerrm; end if;
end $$;

create function t.eq(label text, query text, expected text) returns void language plpgsql as $$
declare v text;
begin
  execute query into v;
  if v is not distinct from expected then raise notice 'PASS  % (= %)', label, v;
  else raise notice 'FAIL  % (expected %, got %)', label, expected, v; end if;
exception when others then
  raise notice 'FAIL  % (error: %)', label, sqlerrm;
end $$;

grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------------------------------------------------------------- personas
insert into t.personas values
 ('anon', 'anon', '{"role":"anon"}'),
 ('service', 'service_role', '{"role":"service_role"}'),
 ('adminA', 'authenticated', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated","email":"admin@a.test","app_metadata":{"role":"admin","orgId":"orgA"}}'),
 ('empA', 'authenticated', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated","email":"emp@a.test","app_metadata":{"role":"employee","orgId":"orgA"}}'),
 ('clientA', 'authenticated', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated","email":"client@a.test","app_metadata":{"role":"client","orgId":"orgA"}}'),
 ('adminB', 'authenticated', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","email":"admin@b.test","app_metadata":{"role":"admin","orgId":"orgB"}}'),
 ('adminS', 'authenticated', '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated","email":"admin@s.test","app_metadata":{"role":"admin","orgId":"orgS"}}'),
 ('adminP', 'authenticated', '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated","email":"admin@p.test","app_metadata":{"role":"admin","orgId":"orgP"}}'),
 ('adminM', 'authenticated', '{"sub":"eeeeeeee-0000-0000-0000-000000000001","role":"authenticated","email":"admin@m.test","app_metadata":{"role":"admin","orgId":"orgM"}}'),
 ('operator', 'authenticated', '{"sub":"ffffffff-0000-0000-0000-000000000001","role":"authenticated","email":"op@platform.test","app_metadata":{"platform_role":"operator"}}');

-- ---------------------------------------------------------------- seed (as postgres)
insert into auth.users (id, email, raw_app_meta_data)
select (claims->>'sub')::uuid, claims->>'email', claims->'app_metadata'
from t.personas where claims ? 'sub';

insert into public.organizations (id, data) values
 ('orgA', '{"name":"A","status":"active","billingStatus":"active"}'),
 ('orgB', '{"name":"B","status":"active","billingStatus":"active"}'),
 ('orgS', '{"name":"S","status":"suspended","billingStatus":"active"}'),
 ('orgP', '{"name":"P","status":"active","billingStatus":"past_due"}');
-- orgM deliberately has no organizations row.

insert into public.profiles (id, org_id, user_id, auth_id, data)
select claims->>'sub', claims->'app_metadata'->>'orgId', claims->>'sub', (claims->>'sub')::uuid,
       jsonb_build_object('uid', claims->>'sub', 'email', claims->>'email',
                          'role', claims->'app_metadata'->>'role', 'orgId', claims->'app_metadata'->>'orgId',
                          'displayName', name, 'loginPassword', 'hunter2')
from t.personas where claims->'app_metadata' ? 'orgId'
on conflict (id) do update set org_id = excluded.org_id, user_id = excluded.user_id,
  auth_id = excluded.auth_id, data = excluded.data;

insert into public.employees (id, org_id, user_id, auth_id, data) values
 ('emp-A', 'orgA', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
  '{"uid":"aaaaaaaa-0000-0000-0000-000000000002","email":"emp@a.test","role":"employee","displayName":"Emp A"}'),
 ('emp-B', 'orgB', 'bbbbbbbb-0000-0000-0000-000000000002', null,
  '{"uid":"bbbbbbbb-0000-0000-0000-000000000002","email":"emp@b.test","role":"employee","displayName":"Emp B"}');

insert into public.invoices (id, org_id, user_id, data) values
 ('inv-A', 'orgA', 'aaaaaaaa-0000-0000-0000-000000000001',
  '{"clientId":"aaaaaaaa-0000-0000-0000-000000000003","status":"Sent","total":100}'),
 ('inv-B', 'orgB', 'bbbbbbbb-0000-0000-0000-000000000001', '{"status":"Sent","total":50}');
insert into public.leads (id, org_id, user_id, data) values
 ('lead-A', 'orgA', 'aaaaaaaa-0000-0000-0000-000000000001', '{"name":"Lead","estimatedValue":1000}');
insert into public.task_statuses (id, org_id, user_id, data) values
 ('ts-A', 'orgA', 'aaaaaaaa-0000-0000-0000-000000000002', '{"label":"Doing"}'),
 ('ts-B', 'orgB', 'bbbbbbbb-0000-0000-0000-000000000002', '{"label":"Doing"}');
insert into public.deliverables (id, org_id, user_id, data) values
 ('del-B', 'orgB', 'bbbbbbbb-0000-0000-0000-000000000001', '{"title":"B secret"}');
insert into public.profiles (id, org_id, user_id, data) values
 ('prof-S-other', 'orgS', 'x', '{"displayName":"suspended co member"}'),
 ('prof-P-other', 'orgP', 'y', '{"displayName":"past due co member"}');

insert into storage.objects (bucket_id, name) values
 ('employees', 'orgA/aaaaaaaa-0000-0000-0000-000000000002/documents/id.pdf'),
 ('employees', 'orgB/bbbbbbbb-0000-0000-0000-000000000002/documents/id.pdf'),
 ('payslips',  'orgA/aaaaaaaa-0000-0000-0000-000000000002/2026-09.pdf'),
 ('payslips',  'orgA/aaaaaaaa-0000-0000-0000-000000000001/2026-09.pdf'),
 ('deliverables', 'orgA/aaaaaaaa-0000-0000-0000-000000000003/report.pdf'),
 ('deliverables', 'orgA/other-client/report.pdf'),
 ('deliverables', 'orgB/client-b/report.pdf'),
 ('deliverables', 'orgS/client-s/report.pdf'),
 ('avatars', 'orgA/aaaaaaaa-0000-0000-0000-000000000002/avatar');

-- billing fixtures: an opened purchase for orgB
insert into private.company_purchases (company_name, admin_name, email, password_hash, status, org_id, stripe_subscription_id, stripe_checkout_session_id)
values ('B', 'Admin B', 'admin@b.test', '', 'opened', 'orgB', 'sub_B', 'cs_B');

select t.eq('seed: loginPassword stripped from profiles on insert',
  $q$select count(*)::text from public.profiles where data ? 'loginPassword'$q$, '0');
select t.eq('employee_onboarding.login_password column dropped',
  $q$select count(*)::text from information_schema.columns where table_name='employee_onboarding' and column_name='login_password'$q$, '0');
select t.eq('deliverables bucket is private',
  $q$select public::text from storage.buckets where id='deliverables'$q$, 'false');

-- ================================================================= anon
select t.login('anon');
select t.rows('anon: cannot read profiles', 'select * from public.profiles', 0);
select t.rows('anon: cannot read organizations', 'select * from public.organizations', 0);
select t.fails('anon: collect_admin_identity_ids not executable', $q$select * from public.collect_admin_identity_ids('orgA')$q$);
select t.fails('anon: insert_inbox_notification not executable', $q$select public.insert_inbox_notification('x','{}'::jsonb,'orgA')$q$);
select t.fails('anon: expand_person_ids not executable', $q$select * from public.expand_person_ids(array['x'])$q$);
select t.fails('anon: prepare_company_purchase not executable', $q$select public.prepare_company_purchase('X','Y','z@z.test','longpassword1')$q$);
select t.fails('anon: open_paid_company not executable', $q$select public.open_paid_company(gen_random_uuid())$q$);
select t.fails('anon: set_company_billing_status not executable', $q$select public.set_company_billing_status('sub_B','active')$q$);
select t.fails('anon: mark_stripe_event_processed not executable', $q$select public.mark_stripe_event_processed('evt_x','t')$q$);
select t.rows('anon: deliverables objects not readable', $q$select * from storage.objects where bucket_id='deliverables'$q$, 0);
select t.rows('anon: avatars stay publicly readable', $q$select * from storage.objects where bucket_id='avatars'$q$, 1);
select t.fails('anon: cannot upload to deliverables', $q$insert into storage.objects (bucket_id, name) values ('deliverables','orgA/x/evil.html')$q$);
reset role;

-- ================================================================= admin of company A (cross-company)
select t.login('adminA');
select t.rows('adminA: sees own company profiles only', $q$select * from public.profiles where org_id <> 'orgA'$q$, 0);
select t.rows('adminA: sees only own organizations row', 'select * from public.organizations', 1);
select t.rows('adminA: cannot read company B employees', $q$select * from public.employees where org_id='orgB'$q$, 0);
select t.rows('adminA: cannot read company B invoices', $q$select * from public.invoices where org_id='orgB'$q$, 0);
select t.rows('adminA: cannot read company B deliverables', $q$select * from public.deliverables where org_id='orgB'$q$, 0);
select t.rows('adminA: cannot read company B task_statuses', $q$select * from public.task_statuses where org_id='orgB'$q$, 0);
select t.affects('adminA: cannot update company B task_statuses', $q$update public.task_statuses set data='{"label":"pwned"}' where id='ts-B'$q$, 0);
select t.affects('adminA: cannot update company B employee', $q$update public.employees set data = data || '{"role":"admin"}' where id='emp-B'$q$, 0);
select t.affects('adminA: cannot delete company B invoice', $q$delete from public.invoices where id='inv-B'$q$, 0);
select t.fails('adminA: collect_admin_identity_ids not executable', $q$select * from public.collect_admin_identity_ids('orgB')$q$);
select t.fails('adminA: insert_inbox_notification not executable', $q$select public.insert_inbox_notification('bbbbbbbb-0000-0000-0000-000000000001','{"title":"phish"}'::jsonb,'orgB')$q$);
select t.fails('adminA: aggregate_health_scores not executable', 'select public.aggregate_health_scores()');
select t.fails('adminA: provision_company_admin not executable', $q$select private.provision_company_admin('x','y','z@z','h','apps','active',null,null)$q$);
select t.fails('adminA: cannot suspend another company', $q$select public.set_company_status('orgB','suspended')$q$);
select t.fails('adminA: cannot change billing status', $q$select public.set_company_billing_status('sub_B','active')$q$);
select t.fails('adminA: cannot read failed purchases', 'select public.list_failed_purchases()');
select t.affects('adminA: cannot edit the organizations row', $q$update public.organizations set data = data || '{"billingStatus":"active"}' where id='orgA'$q$, 0);
select t.fails('adminA: cannot write files into company B storage', $q$insert into storage.objects (bucket_id, name) values ('employees','orgB/bbbbbbbb-0000-0000-0000-000000000002/x.pdf')$q$);
select t.rows('adminA: cannot list company B storage', $q$select * from storage.objects where name like 'orgB/%'$q$, 0);
select t.fails('adminA: cannot write an avatar for company B', $q$insert into storage.objects (bucket_id, name) values ('avatars','orgB/bbbbbbbb-0000-0000-0000-000000000002/avatar')$q$);
-- in-company admin access stays complete
select t.rows('adminA: sees company A employees', $q$select * from public.employees where org_id='orgA'$q$, 1);
select t.rows('adminA: sees company A leads', 'select * from public.leads', 1);
select t.affects('adminA: can change an employee role in own company', $q$update public.employees set data = data || '{"role":"manager"}' where id='emp-A'$q$, 1);
select t.affects('adminA: can update an invoice total', $q$update public.invoices set data = data || '{"total":120}' where id='inv-A'$q$, 1);
select t.ok('adminA: can insert a lead', $q$insert into public.leads (id, data) values ('lead-A2','{"name":"L2"}')$q$);
select t.eq('adminA: new rows are forced into own company', $q$select org_id from public.leads where id='lead-A2'$q$, 'orgA');
select t.ok('adminA: can upload an employee document in own company', $q$insert into storage.objects (bucket_id, name) values ('employees','orgA/aaaaaaaa-0000-0000-0000-000000000002/documents/new.pdf')$q$);
select t.ok('adminA: can upload a payslip', $q$insert into storage.objects (bucket_id, name) values ('payslips','orgA/aaaaaaaa-0000-0000-0000-000000000002/2026-10.pdf')$q$);
select t.rows('adminA: reads all own-company deliverables files', $q$select * from storage.objects where bucket_id='deliverables'$q$, 2);
select t.eq('adminA: current_company_status is active', 'select public.current_company_status()', 'active');
reset role;
update public.employees set data = data || '{"role":"employee"}' where id='emp-A';

-- ================================================================= employee of company A (role escalation)
select t.login('empA');
select t.fails('empA: cannot promote own profile to admin', $q$update public.profiles set data = data || '{"role":"admin"}' where id='aaaaaaaa-0000-0000-0000-000000000002'$q$);
select t.ok('empA: attempt to move own profile to company B', $q$update public.profiles set data = data || '{"orgId":"orgB"}' where id='aaaaaaaa-0000-0000-0000-000000000002'$q$);
select t.eq('empA: profile still belongs to company A', $q$select org_id || '/' || (data->>'orgId') from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000002'$q$, 'orgA/orgA');
select t.fails('empA: cannot claim a business_uid', $q$update public.profiles set data = data || '{"business_uid":"aaaaaaaa-0000-0000-0000-000000000001"}' where id='aaaaaaaa-0000-0000-0000-000000000002'$q$);
select t.fails('empA: cannot set own email to the admin email', $q$update public.profiles set data = data || '{"email":"admin@a.test"}' where id='aaaaaaaa-0000-0000-0000-000000000002'$q$);
select t.affects('empA: can update own display name', $q$update public.profiles set data = data || '{"displayName":"New name"}' where id='aaaaaaaa-0000-0000-0000-000000000002'$q$, 1);
select t.fails('empA: cannot change own employee role', $q$update public.employees set data = data || '{"role":"admin"}' where id='emp-A'$q$);
select t.fails('empA: cannot change own employee uid', $q$update public.employees set data = data || '{"uid":"aaaaaaaa-0000-0000-0000-000000000001"}' where id='emp-A'$q$);
select t.fails('empA: cannot take over auth_id', $q$update public.employees set auth_id='aaaaaaaa-0000-0000-0000-000000000001' where id='emp-A'$q$);
select t.affects('empA: can update own quote', $q$update public.employees set data = data || '{"quote":"Ship it"}' where id='emp-A'$q$, 1);
select t.fails('empA: cannot delete own employee row', $q$delete from public.employees where id='emp-A'$q$);
select t.fails('empA: cannot insert an employee row claiming the admin id', $q$insert into public.employees (id, data) values ('aaaaaaaa-0000-0000-0000-000000000001','{"role":"admin","email":"admin@a.test"}')$q$);
select t.fails('empA: cannot insert an admin profile for itself', $q$insert into public.profiles (id, auth_id, data) values ('emp-new', 'aaaaaaaa-0000-0000-0000-000000000002','{"role":"admin","email":"emp@a.test"}')$q$);
select t.affects('empA: cannot update the organizations row', $q$update public.organizations set data = data || '{"status":"active"}' where id='orgA'$q$, 0);
select t.affects('empA: cannot delete the organizations row', $q$delete from public.organizations where id='orgA'$q$, 0);
select t.rows('empA: cannot read leads it does not own', 'select * from public.leads', 0);
select t.fails('empA: cannot create leads', $q$insert into public.leads (id, data) values ('lead-E','{"name":"x"}')$q$);
select t.rows('empA: cannot read invoices', 'select * from public.invoices', 0);
select t.affects('empA: cannot mark an invoice paid', $q$update public.invoices set data = data || '{"status":"Paid"}' where id='inv-A'$q$, 0);
select t.fails('empA: cannot write company policies', $q$insert into public.company_policies (id, data) values ('pol-x','{"title":"x"}')$q$);
select t.rows('empA: still sees company task statuses', 'select * from public.task_statuses', 1);
select t.ok('empA: can upload own document', $q$insert into storage.objects (bucket_id, name) values ('employees','orgA/aaaaaaaa-0000-0000-0000-000000000002/documents/cv.pdf')$q$);
select t.fails('empA: cannot upload into another person''s folder', $q$insert into storage.objects (bucket_id, name) values ('employees','orgA/aaaaaaaa-0000-0000-0000-000000000001/documents/cv.pdf')$q$);
select t.rows('empA: reads own payslips', $q$select * from storage.objects where bucket_id='payslips' and name like 'orgA/aaaaaaaa-0000-0000-0000-000000000002/%'$q$, 2);
select t.rows('empA: cannot read the admin payslip', $q$select * from storage.objects where bucket_id='payslips' and name like 'orgA/aaaaaaaa-0000-0000-0000-000000000001/%'$q$, 0);
select t.fails('empA: cannot write payslips', $q$insert into storage.objects (bucket_id, name) values ('payslips','orgA/aaaaaaaa-0000-0000-0000-000000000002/fake.pdf')$q$);
select t.ok('empA: staff can upload a client deliverable', $q$insert into storage.objects (bucket_id, name) values ('deliverables','orgA/aaaaaaaa-0000-0000-0000-000000000003/v2.pdf')$q$);
select t.ok('empA: can update own avatar', $q$insert into storage.objects (bucket_id, name) values ('avatars','orgA/aaaaaaaa-0000-0000-0000-000000000002/avatar2')$q$);
select t.fails('empA: cannot replace the admin avatar', $q$insert into storage.objects (bucket_id, name) values ('avatars','orgA/aaaaaaaa-0000-0000-0000-000000000001/avatar')$q$);
reset role;
select t.eq('empA: JWT role in auth.users unchanged after profile edits',
  $q$select raw_app_meta_data->>'role' from auth.users where id='aaaaaaaa-0000-0000-0000-000000000002'$q$, 'employee');
select t.eq('empA: profile role unchanged',
  $q$select data->>'role' from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000002'$q$, 'employee');

-- ================================================================= legitimate notification flows still work
select t.login('adminA');
select t.ok('adminA: create a task for empA', $q$insert into public.tasks (id, data) values ('task-A', '{"title":"Build","status":"todo","assigneeId":"aaaaaaaa-0000-0000-0000-000000000002"}')$q$);
select t.ok('adminA: post an announcement', $q$insert into public.announcements (id, data) values ('ann-A', '{"title":"Hello team","message":"hi"}')$q$);
reset role;
select t.rows('announcement fans out only inside company A', $q$select * from public.notification_items where org_id <> 'orgA'$q$, 0);
select t.login('empA');
select t.affects('empA: move own task status', $q$update public.tasks set data = data || '{"status":"done","statusChangedByRole":"employee","statusChangedBy":"aaaaaaaa-0000-0000-0000-000000000002"}' where id='task-A'$q$, 1);
reset role;
select t.rows('task status change notifies company A admins', $q$select * from public.notification_items where org_id='orgA' and user_id='aaaaaaaa-0000-0000-0000-000000000001' and data->>'type'='task'$q$, 1);
select t.rows('no notification leaked to company B', $q$select * from public.notification_items where org_id='orgB'$q$, 0);

-- ================================================================= client of company A
select t.login('clientA');
select t.rows('clientA: sees its own invoice', 'select * from public.invoices', 1);
select t.fails('clientA: cannot change the invoice total', $q$update public.invoices set data = data || '{"total":1}' where id='inv-A'$q$);
select t.affects('clientA: can mark its invoice paid', $q$update public.invoices set data = data || '{"status":"Paid"}' where id='inv-A'$q$, 1);
select t.rows('clientA: reads only its own deliverable files', $q$select * from storage.objects where bucket_id='deliverables'$q$, 2);
select t.fails('clientA: cannot upload deliverables', $q$insert into storage.objects (bucket_id, name) values ('deliverables','orgA/aaaaaaaa-0000-0000-0000-000000000003/x.pdf')$q$);
select t.rows('clientA: cannot read employee documents', $q$select * from storage.objects where bucket_id='employees'$q$, 0);
select t.rows('clientA: cannot list the employee directory', 'select * from public.employees', 0);
select t.fails('clientA: cannot promote itself', $q$update public.profiles set data = data || '{"role":"admin"}' where id='aaaaaaaa-0000-0000-0000-000000000003'$q$);
reset role;

-- ================================================================= suspended / past due / missing companies
select t.login('adminS');
select t.rows('suspended admin: no data access', 'select * from public.profiles', 0);
select t.eq('suspended admin: status reported', 'select public.current_company_status()', 'suspended');
select t.rows('suspended admin: no storage access', 'select * from storage.objects where bucket_id <> $$avatars$$', 0);
select t.fails('suspended admin: cannot upload', $q$insert into storage.objects (bucket_id, name) values ('deliverables','orgS/c/x.pdf')$q$);
reset role;
select t.login('adminP');
select t.rows('past_due admin: no data access', 'select * from public.profiles', 0);
select t.eq('past_due admin: status reported', 'select public.current_company_status()', 'past_due');
reset role;
select t.login('adminM');
select t.rows('missing-org admin: no data access', 'select * from public.profiles', 0);
select t.eq('missing-org admin: company_is_active false', $q$select public.company_is_active('orgM')::text$q$, 'false');
select t.eq('missing-org admin: status reported inactive', 'select public.current_company_status()', 'inactive');
reset role;

-- ================================================================= operator + billing
select t.login('operator');
select t.ok('operator: can suspend company B', $q$select public.set_company_status('orgB','suspended')$q$);
select t.ok('operator: can list companies', 'select public.list_companies()');
select t.fails('operator: cannot set billing status (service only)', $q$select public.set_company_billing_status('sub_B','active')$q$);
reset role;

select t.login('service');
select t.eq('webhook: first delivery of an event is new', $q$select public.mark_stripe_event_processed('evt_1','invoice.paid')::text$q$, 'true');
select t.eq('webhook: replayed event is detected', $q$select public.mark_stripe_event_processed('evt_1','invoice.paid')::text$q$, 'false');
select t.eq('webhook: stripe_event_processed sees it', $q$select public.stripe_event_processed('evt_1')::text$q$, 'true');
select t.ok('webhook: paid invoice sets billing active', $q$select public.set_company_billing_status('sub_B','active')$q$);
reset role;
select t.eq('billing: paid invoice does not lift an operator suspension', $q$select public.company_is_active('orgB')::text$q$, 'false');
select t.login('operator');
select t.ok('operator: re-activates company B', $q$select public.set_company_status('orgB','active')$q$);
reset role;
select t.eq('billing: company B active again', $q$select public.company_is_active('orgB')::text$q$, 'true');
select t.login('service');
select t.ok('webhook: payment failed -> past_due', $q$select public.set_company_billing_status('sub_B','past_due')$q$);
reset role;
select t.eq('billing: past_due loses access', $q$select public.company_is_active('orgB')::text$q$, 'false');
select t.login('adminB');
select t.rows('billing: past_due admin sees nothing', 'select * from public.profiles', 0);
reset role;
select t.login('service');
select t.ok('webhook: subscription canceled', $q$select public.set_company_billing_status('sub_B','canceled')$q$);
select t.ok('webhook: late invoice.paid after cancel', $q$select public.set_company_billing_status('sub_B','active')$q$);
reset role;
select t.eq('billing: canceled stays canceled', $q$select data->>'billingStatus' from public.organizations where id='orgB'$q$, 'canceled');
select t.eq('billing: canceled loses access', $q$select public.company_is_active('orgB')::text$q$, 'false');
select t.login('service');
select t.eq('checkout: unknown session reports unknown', $q$select public.purchase_status_for_session('cs_nope')->>'status'$q$, 'unknown');
select t.eq('checkout: opened session reports opened', $q$select public.purchase_status_for_session('cs_B')->>'status'$q$, 'opened');
reset role;
select t.login('adminA');
select t.fails('checkout: purchase status is not exposed to users', $q$select public.purchase_status_for_session('cs_B')$q$);
select t.fails('webhook helpers are not exposed to users', $q$select public.mark_stripe_event_processed('evt_2','x')$q$);
reset role;

-- ================================================================= grants overview
select t.eq('no public/private function is executable by anon',
  $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and has_function_privilege('anon', p.oid, 'execute')$q$, '0');
select t.eq('no SECURITY DEFINER function lacks a fixed search_path',
  $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and p.prosecdef and p.proconfig is null$q$, '0');

rollback;
