create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 200),
  code text not null unique check (code = lower(code) and code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists institution_id uuid references public.institutions(id) on delete set null;

alter table public.departments
  add column if not exists institution_id uuid references public.institutions(id) on delete set null;

alter table public.courses
  add column if not exists institution_id uuid references public.institutions(id) on delete set null;

create index if not exists profiles_institution_idx on public.profiles(institution_id);
create index if not exists departments_institution_idx on public.departments(institution_id);
create index if not exists courses_institution_idx on public.courses(institution_id);

create or replace function private.current_institution_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.institution_id
  from public.profiles p
  where p.id = (select auth.uid())
$$;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and institution_id is not distinct from private.current_institution_id()
  );

create table if not exists public.institution_admins (
  institution_id uuid not null references public.institutions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (institution_id, profile_id)
);

create index if not exists institution_admins_profile_idx
  on public.institution_admins(profile_id);

alter table public.institutions enable row level security;
alter table public.institution_admins enable row level security;

create or replace function private.is_institution_admin(target_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.institution_admins ia
    join public.profiles p on p.id = ia.profile_id
    where ia.institution_id = target_institution_id
      and ia.profile_id = (select auth.uid())
      and p.role = 'admin'
      and p.institution_id = target_institution_id
  )
$$;

create or replace function private.can_manage_institution_setup(target_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_app_role() = 'admin'
    and exists (
      select 1
      from public.institutions i
      where i.id = target_institution_id
        and (
          i.created_by = (select auth.uid())
          or private.is_institution_admin(target_institution_id)
        )
    )
$$;

create policy institutions_select_authorized on public.institutions
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or private.current_institution_id() = id
  );

create policy institutions_insert_unassigned_admin on public.institutions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.current_app_role() = 'admin'
    and private.current_institution_id() is null
  );

create policy institutions_update_setup_admin on public.institutions
  for update to authenticated
  using (private.can_manage_institution_setup(id))
  with check (private.can_manage_institution_setup(id));

create policy institution_admins_select_authorized on public.institution_admins
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.can_manage_institution_setup(institution_id)
  );

create policy institution_admins_manage_setup on public.institution_admins
  for all to authenticated
  using (private.can_manage_institution_setup(institution_id))
  with check (private.can_manage_institution_setup(institution_id));

grant select on public.institutions to authenticated;
grant insert, update on public.institutions to authenticated;
grant select, insert, update, delete on public.institution_admins to authenticated;
grant execute on function private.current_institution_id() to authenticated, service_role;
grant execute on function private.is_institution_admin(uuid) to authenticated, service_role;
grant execute on function private.can_manage_institution_setup(uuid) to authenticated, service_role;

create or replace function private.same_institution(target_institution_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_institution_id is null
    or (
      target_institution_id = private.current_institution_id()
      and private.current_institution_id() is not null
    )
$$;

drop policy if exists catalog_authenticated_read on public.departments;
create policy departments_select_institution on public.departments
    for select to authenticated
    using (
      institution_id is null
      or institution_id = private.current_institution_id()
    );

create or replace function private.can_manage_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = target_course_id
      and c.instructor_id = (select auth.uid())
      and private.current_app_role() = 'faculty'
      and private.same_institution(c.institution_id)
  )
$$;

create or replace function private.has_course_access(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = target_course_id
      and private.same_institution(c.institution_id)
      and (
        (c.instructor_id = (select auth.uid()) and private.current_app_role() = 'faculty')
        or exists (
          select 1 from public.enrollments e
          where e.course_id = c.id
            and e.student_id = (select auth.uid())
            and lower(e.status) in ('active', 'enrolled', 'completed')
        )
      )
  )
$$;

revoke all on function private.same_institution(uuid) from public, anon;
revoke all on function private.current_institution_id() from public, anon;
revoke all on function private.is_institution_admin(uuid) from public, anon;
revoke all on function private.can_manage_institution_setup(uuid) from public, anon;
