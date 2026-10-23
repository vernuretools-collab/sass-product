-- Hire can save in-progress answers without submitting. Employment fields stay untouched.

create or replace function private.save_employee_onboarding_draft(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.employee_onboarding;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must be an object';
  end if;
  if octet_length(p_answers::text) > 1500000 then
    raise exception 'answers are too large';
  end if;

  update public.employee_onboarding
  set
    answers = p_answers,
    updated_at = now()
  where auth_id = auth.uid()
    and status = 'awaiting_answers'
  returning * into updated;

  if not found then
    raise exception 'no onboarding form is waiting for answers';
  end if;

  return jsonb_build_object('id', updated.id, 'status', updated.status);
end;
$$;

revoke all on function private.save_employee_onboarding_draft(jsonb) from public, anon, authenticated;
grant execute on function private.save_employee_onboarding_draft(jsonb) to authenticated, service_role;

-- Same as above: replace the 00016 version that returns the row type.
drop function if exists public.save_employee_onboarding_draft(jsonb);

create or replace function public.save_employee_onboarding_draft(p_answers jsonb)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select private.save_employee_onboarding_draft(p_answers);
$$;

revoke all on function public.save_employee_onboarding_draft(jsonb) from public, anon;
grant execute on function public.save_employee_onboarding_draft(jsonb) to authenticated, service_role;
