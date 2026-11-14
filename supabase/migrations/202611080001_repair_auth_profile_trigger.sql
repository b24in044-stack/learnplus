create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_columns text := 'id,email,role';
  profile_values text := '$1,$2,''student''';
  has_full_name boolean;
  has_is_approved boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'full_name'
  ) into has_full_name;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'is_approved'
  ) into has_is_approved;

  if has_full_name then
    profile_columns := profile_columns || ',full_name';
    profile_values := profile_values || ',coalesce(nullif(trim($3), ''''), '''')';
  end if;

  if has_is_approved then
    profile_columns := profile_columns || ',is_approved';
    profile_values := profile_values || ',true';
  end if;

  execute format(
    'insert into public.profiles (%s) values (%s) on conflict (id) do nothing',
    profile_columns,
    profile_values
  ) using new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name';

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();
