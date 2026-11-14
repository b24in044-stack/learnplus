drop policy if exists attendance_sessions_manage on public.attendance_sessions;
create policy attendance_sessions_manage on public.attendance_sessions
  for all to authenticated
  using (
    private.current_app_role() = 'faculty'
    and private.can_manage_course(course_id)
    and faculty_id = (select auth.uid())
  )
  with check (
    private.current_app_role() = 'faculty'
    and private.can_manage_course(course_id)
    and faculty_id = (select auth.uid())
  );

drop policy if exists attendance_records_manage on public.attendance_records;
create policy attendance_records_manage on public.attendance_records
  for all to authenticated
  using (
    private.current_app_role() = 'faculty'
    and marked_by = (select auth.uid())
    and exists (
      select 1
      from public.attendance_sessions s
      where s.id = session_id
        and s.faculty_id = (select auth.uid())
        and private.can_manage_course(s.course_id)
    )
  )
  with check (
    private.current_app_role() = 'faculty'
    and marked_by = (select auth.uid())
    and exists (
      select 1
      from public.attendance_sessions s
      join public.enrollments e on e.course_id = s.course_id
      join public.profiles student on student.id = e.student_id
      where s.id = session_id
        and s.faculty_id = (select auth.uid())
        and e.student_id = attendance_records.student_id
        and student.role = 'student'
        and lower(e.status) in ('active', 'enrolled')
        and private.can_manage_course(s.course_id)
    )
  );
