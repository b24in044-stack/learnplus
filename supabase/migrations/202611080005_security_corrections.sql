-- Security corrections for the institution and academic foundation migrations.
-- This migration is additive and does not assign existing records to institutions.

-- The current application reads these tenant columns through authenticated
-- user-scoped clients. Keep the grants column-specific.
grant select (institution_id) on public.profiles to authenticated;
grant select (institution_id) on public.courses to authenticated;

-- Legacy rows with a NULL institution_id remain unassigned legacy records.
-- They are not assigned to a tenant by this migration. Existing helper
-- behavior is retained for compatibility; tenant onboarding must explicitly
-- classify or migrate such records before treating them as institution data.

-- Replace the academic policies so a partial application can be safely
-- completed. Students may edit only their own submission content fields.
drop policy if exists assignment_submissions_select on public.assignment_submissions;
drop policy if exists assignment_submissions_insert on public.assignment_submissions;
drop policy if exists assignment_submissions_update on public.assignment_submissions;

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
    and private.current_app_role() = 'student'
    and status in ('draft', 'submitted', 'late')
    and (
      attachment_url is null
      or attachment_url ~ ('^assignments/' || assignment_id::text || '/' || (select auth.uid())::text || '/[^/]+$')
    )
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
    (
      student_id = (select auth.uid())
      and private.current_app_role() = 'student'
    )
    or exists (
      select 1
      from public.assignments a
      where a.id = assignment_id
        and private.can_manage_academic_course(a.course_id)
    )
  )
  with check (
    (
      student_id = (select auth.uid())
      and private.current_app_role() = 'student'
      and status in ('draft', 'submitted', 'late')
      and grade is null
      and feedback is null
      and graded_at is null
      and (
        attachment_url is null
        or attachment_url ~ ('^assignments/' || assignment_id::text || '/' || (select auth.uid())::text || '/[^/]+$')
      )
    )
    or exists (
      select 1
      from public.assignments a
      where a.id = assignment_id
        and private.can_manage_academic_course(a.course_id)
    )
  );

-- A shared authenticated database role cannot distinguish student and faculty
-- column grants. Revoke broad UPDATE access; the server validates the role and
-- course before using the service-role client for controlled writes.
revoke insert, update on public.assignment_submissions from authenticated;
grant update (content, attachment_url) on public.assignment_submissions to authenticated;
grant insert (assignment_id, student_id, content, attachment_url) on public.assignment_submissions to authenticated;

-- Submission files remain private and must be owned by the submitting
-- student. The object path is assignments/<assignment>/<student>/<filename>.
drop policy if exists student_submissions_owner_upload on storage.objects;
drop policy if exists student_submissions_authorized_read on storage.objects;
drop policy if exists student_submissions_owner_delete on storage.objects;

create policy student_submissions_owner_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-submissions'
    and (storage.foldername(name))[1] = 'assignments'
    and (storage.foldername(name))[2] is not null
    and (storage.foldername(name))[3] = (select auth.uid())::text
    and exists (
      select 1
      from public.assignments a
      where a.id::text = (storage.foldername(name))[2]
        and a.status = 'published'
        and private.has_course_access(a.course_id)
    )
  );

create policy student_submissions_authorized_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-submissions'
    and (
      (storage.foldername(name))[3] = (select auth.uid())::text
      or exists (
        select 1
        from public.assignments a
        where a.id::text = (storage.foldername(name))[2]
          and private.can_manage_academic_course(a.course_id)
      )
    )
  );

create policy student_submissions_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'student-submissions'
    and (storage.foldername(name))[3] = (select auth.uid())::text
  );

-- Recreate the institution and academic policies with controlled drops so a
-- partially applied deployment can be completed without duplicate-policy
-- errors. The definitions remain equivalent to migrations 003 and 004.
drop policy if exists institutions_select_authorized on public.institutions;
drop policy if exists institutions_insert_unassigned_admin on public.institutions;
drop policy if exists institutions_update_setup_admin on public.institutions;
drop policy if exists institution_admins_select_authorized on public.institution_admins;
drop policy if exists institution_admins_manage_setup on public.institution_admins;
drop policy if exists course_outcomes_select on public.course_outcomes;
drop policy if exists course_outcomes_manage on public.course_outcomes;
drop policy if exists course_units_select on public.course_units;
drop policy if exists course_units_manage on public.course_units;
drop policy if exists lecture_schedules_select on public.lecture_schedules;
drop policy if exists lecture_schedules_manage on public.lecture_schedules;
drop policy if exists announcements_select on public.announcements;
drop policy if exists announcements_manage on public.announcements;
drop policy if exists assignments_select on public.assignments;
drop policy if exists assignments_manage on public.assignments;
drop policy if exists audit_logs_select on public.audit_logs;

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
        and (c.institution_id is null or p.institution_id = c.institution_id)
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
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    private.current_app_role() = 'admin'
    and institution_id is not null
    and private.same_institution(institution_id)
  );
