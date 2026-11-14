-- Additive academic foundation. Existing course, profile, enrollment, and
-- institution records remain the source of truth for ownership and tenancy.

create table if not exists public.course_outcomes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  code text not null,
  description text not null,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, code)
);

create table if not exists public.course_units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  unit_number integer not null check (unit_number > 0),
  title text not null,
  description text not null default '',
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, unit_number)
);

create table if not exists public.lecture_schedules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  faculty_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '',
  meeting_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text not null default '',
  due_at timestamptz,
  max_points numeric(8, 2) not null default 100 check (max_points > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  attachment_url text,
  submitted_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'late', 'returned')),
  grade numeric(8, 2) check (grade is null or grade >= 0),
  feedback text,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id),
  check (status = 'draft' or submitted_at is not null)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (length(btrim(action)) > 0),
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists course_outcomes_course_order_idx
  on public.course_outcomes(course_id, display_order);
create index if not exists course_units_course_order_idx
  on public.course_units(course_id, display_order);
create index if not exists lecture_schedules_course_start_idx
  on public.lecture_schedules(course_id, starts_at);
create index if not exists lecture_schedules_faculty_start_idx
  on public.lecture_schedules(faculty_id, starts_at);
create index if not exists announcements_course_created_idx
  on public.announcements(course_id, created_at desc);
create index if not exists assignments_course_due_idx
  on public.assignments(course_id, due_at);
create index if not exists assignment_submissions_student_idx
  on public.assignment_submissions(student_id, updated_at desc);
create index if not exists assignment_submissions_assignment_idx
  on public.assignment_submissions(assignment_id, updated_at desc);
create index if not exists audit_logs_institution_created_idx
  on public.audit_logs(institution_id, created_at desc);
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs(actor_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'course_outcomes', 'course_units', 'lecture_schedules', 'announcements',
    'assignments', 'assignment_submissions'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

create or replace function private.can_manage_academic_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.courses c
    where c.id = target_course_id
      and (
        private.can_manage_course(c.id)
        or (
          private.current_app_role() = 'admin'
          and c.institution_id is not null
          and private.can_manage_institution_setup(c.institution_id)
        )
      )
  )
$$;

alter table public.course_outcomes enable row level security;
alter table public.course_units enable row level security;
alter table public.lecture_schedules enable row level security;
alter table public.announcements enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.audit_logs enable row level security;

create policy course_outcomes_select on public.course_outcomes
  for select to authenticated using (private.has_course_access(course_id));
create policy course_outcomes_manage on public.course_outcomes
  for all to authenticated
  using (private.can_manage_academic_course(course_id))
  with check (private.can_manage_academic_course(course_id));

create policy course_units_select on public.course_units
  for select to authenticated using (private.has_course_access(course_id));
create policy course_units_manage on public.course_units
  for all to authenticated
  using (private.can_manage_academic_course(course_id))
  with check (private.can_manage_academic_course(course_id));

create policy lecture_schedules_select on public.lecture_schedules
  for select to authenticated using (private.has_course_access(course_id));
create policy lecture_schedules_manage on public.lecture_schedules
  for all to authenticated
  using (private.can_manage_academic_course(course_id))
  with check (
    private.can_manage_academic_course(course_id)
    and exists (
      select 1
      from public.profiles p
        join public.courses c on c.id = course_id
        where p.id = faculty_id
          and p.role = 'faculty'
          and (
            c.institution_id is null
            or p.institution_id = c.institution_id
          )
          and private.same_institution(c.institution_id)
    )
  );

create policy announcements_select on public.announcements
  for select to authenticated
  using (
    private.can_manage_academic_course(course_id)
    or (status = 'published' and private.has_course_access(course_id))
  );
create policy announcements_manage on public.announcements
  for all to authenticated
  using (private.can_manage_academic_course(course_id))
  with check (
    private.can_manage_academic_course(course_id)
    and author_id = (select auth.uid())
  );

create policy assignments_select on public.assignments
  for select to authenticated
  using (
    private.can_manage_academic_course(course_id)
    or (status in ('published', 'closed') and private.has_course_access(course_id))
  );
create policy assignments_manage on public.assignments
  for all to authenticated
  using (private.can_manage_academic_course(course_id))
  with check (
    private.can_manage_academic_course(course_id)
    and created_by = (select auth.uid())
  );

create policy assignment_submissions_select on public.assignment_submissions
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1
      from public.assignments a
      where a.id = assignment_id
        and private.can_manage_academic_course(a.course_id)
    )
  );
create policy assignment_submissions_insert on public.assignment_submissions
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1
      from public.assignments a
      where a.id = assignment_id
        and a.status = 'published'
        and private.has_course_access(a.course_id)
    )
  );
create policy assignment_submissions_update on public.assignment_submissions
  for update to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1
      from public.assignments a
      where a.id = assignment_id
        and private.can_manage_academic_course(a.course_id)
    )
  )
  with check (
    student_id = (select auth.uid())
    or exists (
      select 1
      from public.assignments a
      where a.id = assignment_id
        and private.can_manage_academic_course(a.course_id)
    )
  );

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    private.current_app_role() = 'admin'
    and institution_id is not null
    and private.same_institution(institution_id)
  );

revoke all on table
  public.course_outcomes, public.course_units, public.lecture_schedules,
  public.announcements, public.assignments, public.assignment_submissions,
  public.audit_logs
from anon, authenticated;

grant select, insert, update, delete on public.course_outcomes, public.course_units,
  public.lecture_schedules, public.announcements, public.assignments
to authenticated;
grant select, insert, update on public.assignment_submissions to authenticated;
grant select on public.audit_logs to authenticated;
grant insert on public.audit_logs to service_role;
revoke all on function private.can_manage_academic_course(uuid) from public, anon;
grant execute on function private.can_manage_academic_course(uuid)
  to authenticated, service_role;
