create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,
  student_id uuid not null references public.profiles(id) on delete restrict,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  previous_status text not null check (previous_status in ('present', 'absent', 'late', 'excused')),
  new_status text not null check (new_status in ('present', 'absent', 'late', 'excused')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists attendance_corrections_session_created_idx
  on public.attendance_corrections(session_id, created_at desc);

alter table public.attendance_corrections enable row level security;

create policy attendance_corrections_authorized_read
  on public.attendance_corrections
  for select to authenticated
  using (
    exists (
      select 1
      from public.attendance_sessions s
      where s.id = session_id
        and (
          (
            private.current_app_role() = 'faculty'
            and s.faculty_id = (select auth.uid())
            and private.can_manage_course(s.course_id)
          )
          or (
            private.current_app_role() = 'admin'
            and private.can_manage_academic_course(s.course_id)
          )
        )
    )
  );

revoke all on table public.attendance_corrections from anon, authenticated;
grant select on public.attendance_corrections to authenticated;

revoke insert, update on public.attendance_sessions, public.attendance_records
  from authenticated;

create or replace function public.save_attendance_session(
  target_course_id uuid,
  target_session_date date,
  target_title text,
  target_records jsonb,
  target_session_id uuid default null,
  correction_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.attendance_sessions%rowtype;
  attendance_row public.attendance_records%rowtype;
  input_record jsonb;
  input_student_id uuid;
  input_status text;
  normalized_reason text := nullif(btrim(correction_reason), '');
  roster_count integer;
  supplied_count integer;
  is_new_session boolean := target_session_id is null;
begin
  if private.current_app_role() <> 'faculty'
    or not private.can_manage_course(target_course_id) then
    raise exception 'Only assigned faculty can manage this attendance session'
      using errcode = '42501';
  end if;
  if target_session_date is null
    or target_title is null
    or length(btrim(target_title)) not between 1 and 200
    or target_records is null
    or jsonb_typeof(target_records) <> 'array'
    or jsonb_array_length(target_records) not between 1 and 500
    or (normalized_reason is not null and length(normalized_reason) > 500) then
    raise exception 'Attendance session data is invalid' using errcode = '22023';
  end if;

  if target_session_id is null then
    insert into public.attendance_sessions (course_id, faculty_id, session_date, title)
    values (target_course_id, (select auth.uid()), target_session_date, btrim(target_title))
    returning * into session_row;
  else
    select *
    into session_row
    from public.attendance_sessions
    where id = target_session_id
    for update;
    if not found
      or session_row.course_id <> target_course_id
      or session_row.faculty_id <> (select auth.uid())
      or session_row.session_date <> target_session_date
      or session_row.title <> btrim(target_title) then
      raise exception 'Attendance session is not available to this faculty account'
        using errcode = '42501';
    end if;
  end if;

  select count(*)
  into supplied_count
  from jsonb_array_elements(target_records);
  if (
    select count(distinct (item ->> 'studentId')::uuid)
    from jsonb_array_elements(target_records) as items(item)
  ) <> supplied_count then
    raise exception 'Duplicate students are not allowed' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(target_records) as items(item)
    where jsonb_typeof(item) <> 'object'
      or (item ->> 'studentId') is null
      or (item ->> 'status') is null
      or (item ->> 'status') not in ('present', 'absent', 'late', 'excused')
  ) then
    raise exception 'Each student and attendance status must be valid'
      using errcode = '22023';
  end if;

  if is_new_session then
    select count(*)
    into roster_count
    from public.enrollments e
    join public.profiles student on student.id = e.student_id
    where e.course_id = target_course_id
      and lower(e.status) in ('active', 'enrolled')
      and student.role = 'student'
      and private.student_matches_course_institution(e.student_id, target_course_id);

    if roster_count <> supplied_count or exists (
      select 1
      from jsonb_array_elements(target_records) as items(item)
      where not exists (
        select 1
        from public.enrollments e
        join public.profiles student on student.id = e.student_id
        where e.course_id = target_course_id
          and e.student_id = (items.item ->> 'studentId')::uuid
          and lower(e.status) in ('active', 'enrolled')
          and student.role = 'student'
          and private.student_matches_course_institution(e.student_id, target_course_id)
      )
    ) then
      raise exception 'Include every currently enrolled student and no other student'
        using errcode = '22023';
    end if;
  else
    select count(*)
    into roster_count
    from public.attendance_records
    where session_id = session_row.id;

    if roster_count <> supplied_count or exists (
      select 1
      from jsonb_array_elements(target_records) as items(item)
      where not exists (
        select 1
        from public.attendance_records existing_record
        join public.profiles student on student.id = existing_record.student_id
        where existing_record.session_id = session_row.id
          and existing_record.student_id = (items.item ->> 'studentId')::uuid
          and student.role = 'student'
          and private.student_matches_course_institution(existing_record.student_id, target_course_id)
      )
    ) then
      raise exception 'Corrections must include every original student record and no other student'
        using errcode = '22023';
    end if;
  end if;

  for input_record in select value from jsonb_array_elements(target_records)
  loop
    input_student_id := (input_record ->> 'studentId')::uuid;
    input_status := input_record ->> 'status';

    select *
    into attendance_row
    from public.attendance_records
    where session_id = session_row.id
      and student_id = input_student_id
    for update;

    if found then
      if attendance_row.status <> input_status then
        if normalized_reason is null then
          raise exception 'Provide a reason for attendance corrections'
            using errcode = '22023';
        end if;
        update public.attendance_records
        set status = input_status,
            marked_by = (select auth.uid()),
            marked_at = now()
        where id = attendance_row.id;
        insert into public.attendance_corrections (
          session_id,
          student_id,
          changed_by,
          previous_status,
          new_status,
          reason
        )
        values (
          session_row.id,
          input_student_id,
          (select auth.uid()),
          attendance_row.status,
          input_status,
          normalized_reason
        );
      end if;
    else
      insert into public.attendance_records (
        session_id,
        student_id,
        status,
        marked_by
      )
      values (
        session_row.id,
        input_student_id,
        input_status,
        (select auth.uid())
      );
    end if;
  end loop;

  return jsonb_build_object(
    'session', to_jsonb(session_row),
    'records', coalesce((
      select jsonb_agg(to_jsonb(record_row) order by record_row.student_id)
      from public.attendance_records record_row
      where record_row.session_id = session_row.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_attendance_session(uuid, date, text, jsonb, uuid, text)
  from public, anon;
grant execute on function public.save_attendance_session(uuid, date, text, jsonb, uuid, text)
  to authenticated;
