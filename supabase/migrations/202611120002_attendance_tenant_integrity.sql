create or replace function private.student_matches_course_institution(
  target_student_id uuid,
  target_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles student
    join public.courses course on course.id = target_course_id
    where student.id = target_student_id
      and student.role = 'student'
      and (
        course.institution_id is null
        or student.institution_id = course.institution_id
      )
  )
$$;

revoke all on function private.student_matches_course_institution(uuid, uuid) from public;
grant execute on function private.student_matches_course_institution(uuid, uuid)
  to authenticated, service_role;

drop policy if exists attendance_records_manage on public.attendance_records;
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
      where s.id = session_id
        and e.student_id = attendance_records.student_id
        and lower(e.status) in ('active', 'enrolled')
        and private.can_manage_academic_course(s.course_id)
        and private.student_matches_course_institution(
          attendance_records.student_id,
          s.course_id
        )
    )
  );
