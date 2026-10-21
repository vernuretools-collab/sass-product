-- Mark companies opened by a paid purchase so the parent app can tell them apart
-- from companies the operator created by hand.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'data'
  ) then
    return;
  end if;

  execute $fn$
    create or replace function private.list_companies()
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      if auth.uid() is null or not public.is_platform_operator() then
        raise exception 'Only a platform operator can list companies';
      end if;

      return coalesce(
        (
          select jsonb_agg(row_to_json(c)::jsonb order by c.created_at desc)
          from (
            select
              o.id,
              coalesce(nullif(o.data->>'name', ''), o.id) as name,
              coalesce(nullif(o.data->>'status', ''), 'active') as status,
              coalesce(
                nullif(p.data->>'email', ''),
                nullif(m.data->>'email', ''),
                ''
              ) as owner_email,
              o.created_at,
              exists (
                select 1
                from private.company_purchases cp
                where cp.org_id = o.id
                  and cp.status = 'opened'
              ) as purchased
            from public.organizations o
            left join public.profiles p on p.id = nullif(o.data->>'ownerId', '')
            left join lateral (
              select om.data
              from public.org_members om
              where om.org_id = o.id
                and lower(coalesce(om.data->>'role', '')) = 'owner'
              order by om.created_at
              limit 1
            ) m on true
          ) c
        ),
        '[]'::jsonb
      );
    end;
    $body$
  $fn$;
end $$;

notify pgrst, 'reload schema';
