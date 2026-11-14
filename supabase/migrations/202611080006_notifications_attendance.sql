-- Additive notifications and attendance foundation.
-- No records are created or assigned by this migration.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  institution_id uuid references public.institutions(id) on delete set null,
  type text not null check (type in ('announcement', 'assignment', 'feedback', 'result', 'schedule', 'system')),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 5000),
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_institution_created_idx
  on public.notifications(institution_id, created_at desc);

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  faculty_id uuid not null references public.profiles(id) on delete restrict,
  session_date date not null,
  title text not null default 'Lecture',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (course_id, session_date, title),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  marked_by uuid not null references public.profiles(id) on delete restrict,
  marked_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index if not exists attendance_sessions_course_date_idx
  on public.attendance_sessions(course_id, session_date desc);
create index if not exists attendance_records_student_idx
  on public.attendance_records(student_id, marked_at desc);

alter table public.notifications enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists attendance_sessions_select_authorized on public.attendance_sessions;
drop policy if exists attendance_sessions_manage on public.attendance_sessions;
drop policy if exists attendance_records_select_authorized on public.attendance_records;
drop policy if exists attendance_records_manage on public.attendance_records;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

create policy attendance_sessions_select_authorized on public.attendance_sessions
  for select to authenticated
  using (
    private.has_course_access(course_id)
    or private.can_manage_academic_course(course_id)
  );
create policy attendance_sessions_manage on public.attendance_sessions
  for all to authenticated
  using (
    private.can_manage_academic_course(course_id)
    and faculty_id = (select auth.uid())
  )
  with check (
    private.can_manage_academic_course(course_id)
    and faculty_id = (select auth.uid())
  );

create policy attendance_records_select_authorized on public.attendance_records
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1
      from public.attendance_sessions s
      where s.id = session_id
        and private.can_manage_academic_course(s.course_id)
    )
  );
create policy attendance_records_manage on public.attendance_records
  for all to authenticated
  using (
    marked_by = (select auth.uid())
    and exists (
      select 1
      from public.attendance_sessions s
      where s.id = session_id
        and private.can_manage_academic_course(s.course_id)
    )
  )
  with check (
    marked_by = (select auth.uid())
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrollments e on e.course_id = s.course_id
      join public.profiles student on student.id = e.student_id
      where s.id = session_id
        and e.student_id = attendance_records.student_id
        and student.role = 'student'
        and lower(e.status) in ('active', 'enrolled')
        and private.can_manage_academic_course(s.course_id)
    )
  );

revoke all on table public.notifications, public.attendance_sessions, public.attendance_records
  from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update on public.attendance_sessions, public.attendance_records to authenticated;
grant insert on public.notifications to service_role;
