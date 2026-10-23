-- Stop storing plaintext passwords (review C4).
-- create-user used to copy the joining password into employee_onboarding.login_password and the
-- admin portal into profiles.data.loginPassword so admins could read it back. Both are removed;
-- affected users must be asked to reset their password (see PR notes).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee_onboarding' and column_name = 'login_password'
  ) then
    execute 'update public.employee_onboarding set login_password = null where login_password is not null';
    execute 'alter table public.employee_onboarding drop column login_password';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee_onboarding' and column_name = 'id'
      and data_type = 'text' and column_default is null
  ) then
    execute 'alter table public.employee_onboarding alter column id set default gen_random_uuid()::text';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'data'
  ) then
    execute $sql$
      update public.profiles
      set data = data - 'loginPassword' - 'password'
      where data ? 'loginPassword' or data ? 'password'
    $sql$;
  end if;
end;
$$;
