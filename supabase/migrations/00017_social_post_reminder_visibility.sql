-- Shared post reminders. Create the table when 00012 has not been applied,
-- then limit each row to its creator or assigned social media manager.

create table if not exists public.social_post_reminder_items (
  id text primary key,
  org_id text,
  user_id text,
  parent_id text,
  collection_name text,
  auth_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_post_reminder_items_org_idx
  on public.social_post_reminder_items (org_id);
create index if not exists social_post_reminder_items_user_idx
  on public.social_post_reminder_items (user_id);
create index if not exists social_post_reminder_items_parent_idx
  on public.social_post_reminder_items (parent_id);
create index if not exists social_post_reminder_items_data_gin
  on public.social_post_reminder_items using gin (data);
create index if not exists social_post_reminder_items_created_by_idx
  on public.social_post_reminder_items ((data->>'createdBy'));
create index if not exists social_post_reminder_items_assignee_idx
  on public.social_post_reminder_items ((data->>'assigneeId'));

alter table public.social_post_reminder_items replica identity full;
alter table public.social_post_reminder_items enable row level security;

grant select, insert, update, delete on public.social_post_reminder_items to authenticated;

create or replace function public.social_post_reminder_visible(row_data jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    public.is_admin()
    or coalesce(row_data->>'createdBy', '') = any (public.self_identity_ids())
    or coalesce(row_data->>'assigneeId', '') = any (public.self_identity_ids());
$$;

drop policy if exists social_post_reminder_items_select on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_write on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_insert on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_update on public.social_post_reminder_items;
drop policy if exists social_post_reminder_items_delete on public.social_post_reminder_items;

create policy social_post_reminder_items_select on public.social_post_reminder_items
  for select to authenticated
  using (public.social_post_reminder_visible(data));

create policy social_post_reminder_items_insert on public.social_post_reminder_items
  for insert to authenticated
  with check (public.social_post_reminder_visible(data));

create policy social_post_reminder_items_update on public.social_post_reminder_items
  for update to authenticated
  using (public.social_post_reminder_visible(data))
  with check (public.social_post_reminder_visible(data));

create policy social_post_reminder_items_delete on public.social_post_reminder_items
  for delete to authenticated
  using (public.social_post_reminder_visible(data));

revoke all on function public.social_post_reminder_visible(jsonb) from public;
grant execute on function public.social_post_reminder_visible(jsonb) to authenticated, service_role;

do $$
begin
  execute 'alter publication supabase_realtime add table public.social_post_reminder_items';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
