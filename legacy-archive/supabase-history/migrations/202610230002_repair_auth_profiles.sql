create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'faculty')),
  avatar_url text,
  department text,
  student_id text unique,
  enrolled_since date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists enrolled_since date;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''), 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

insert into public.profiles (id, email, full_name, role)
select id, coalesce(email, ''), coalesce(raw_user_meta_data->>'full_name', ''), 'student'
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
for select to authenticated
using (id = (select auth.uid()));
