create policy practice_assessments_backend_insert_only
  on public.student_agent_records
  as restrictive
  for insert to authenticated
  with check (record_type <> 'practice_assessments');

create policy practice_assessments_backend_update_only
  on public.student_agent_records
  as restrictive
  for update to authenticated
  using (record_type <> 'practice_assessments')
  with check (record_type <> 'practice_assessments');

create policy practice_assessments_backend_delete_only
  on public.student_agent_records
  as restrictive
  for delete to authenticated
  using (record_type <> 'practice_assessments');

create or replace function public.create_practice_assessment(
  target_owner_id uuid,
  target_assessment_id text,
  target_course_id uuid,
  assessment_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_payload jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted backend access is required' using errcode = '42501';
  end if;
  if target_owner_id is null
    or target_assessment_id is null
    or length(trim(target_assessment_id)) = 0
    or target_course_id is null
    or assessment_payload is null
    or jsonb_typeof(assessment_payload) <> 'object' then
    raise exception 'Invalid practice assignment record' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = target_owner_id
      and p.role = 'student'
      and p.is_approved is true
  ) or not exists (
    select 1
    from public.enrollments e
    where e.student_id = target_owner_id
      and e.course_id = target_course_id
      and lower(e.status) in ('active', 'enrolled', 'completed')
  ) then
    raise exception 'Practice assignment is not accessible' using errcode = '42501';
  end if;

  insert into public.student_agent_records (
    legacy_id,
    owner_id,
    course_id,
    record_type,
    payload
  )
  values (
    target_assessment_id,
    target_owner_id,
    target_course_id,
    'practice_assessments',
    assessment_payload || jsonb_build_object(
      'courseId', target_course_id::text,
      'status', 'GENERATED'
    )
  )
  returning payload into created_payload;

  return created_payload;
end;
$$;

create or replace function public.transition_practice_assessment_state(
  target_owner_id uuid,
  target_assessment_id text,
  expected_statuses text[],
  next_status text,
  payload_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment_row public.student_agent_records%rowtype;
  current_status text;
  updated_payload jsonb;
  allowed_payload_keys text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted backend access is required' using errcode = '42501';
  end if;
  if target_owner_id is null
    or target_assessment_id is null
    or length(trim(target_assessment_id)) = 0
    or next_status not in ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'RESULTS_PUBLISHED')
    or expected_statuses is null
    or payload_patch is null or jsonb_typeof(payload_patch) <> 'object' then
    raise exception 'Invalid practice assignment transition' using errcode = '22023';
  end if;

  select *
  into assessment_row
  from public.student_agent_records
  where owner_id = target_owner_id
    and record_type = 'practice_assessments'
    and legacy_id = target_assessment_id
  for update;

  if not found or assessment_row.course_id is null
    or not exists (
      select 1
      from public.profiles p
      where p.id = target_owner_id
        and p.role = 'student'
        and p.is_approved is true
    )
    or not exists (
      select 1
      from public.enrollments e
      where e.student_id = target_owner_id
        and e.course_id = assessment_row.course_id
        and lower(e.status) in ('active', 'enrolled', 'completed')
    ) then
    raise exception 'Practice assignment is not accessible' using errcode = '42501';
  end if;

  current_status := coalesce(assessment_row.payload ->> 'status', 'GENERATED');
  if current_status <> next_status and not (current_status = any(expected_statuses)) then
    raise exception 'Practice assignment status transition is not allowed' using errcode = '40001';
  end if;
  if current_status <> next_status and not (
    (current_status = 'GENERATED' and next_status = 'IN_PROGRESS')
    or (current_status = 'IN_PROGRESS' and next_status = 'SUBMITTED')
    or (current_status = 'SUBMITTED' and next_status = 'GRADED')
    or (current_status = 'GRADED' and next_status = 'RESULTS_PUBLISHED')
  ) then
    raise exception 'Practice assignment status transition is not allowed' using errcode = '40001';
  end if;

  if current_status <> next_status then
    allowed_payload_keys := case
      when current_status = 'GENERATED' and next_status = 'IN_PROGRESS'
        then array['startedAt']
      when current_status = 'IN_PROGRESS' and next_status = 'SUBMITTED'
        then array['submittedAnswers', 'submittedAt', 'timeSpentSeconds']
      when current_status = 'SUBMITTED' and next_status = 'GRADED'
        then array['result', 'submissionId', 'gradedAt']
      when current_status = 'GRADED' and next_status = 'RESULTS_PUBLISHED'
        then array['resultsPublishedAt', 'learningAnalysisStatus']
      else array[]::text[]
    end;
    if exists (
      select 1
      from jsonb_object_keys(payload_patch) as keys(key)
      where not (keys.key = any(allowed_payload_keys))
    ) then
      raise exception 'Practice assignment transition contains unsupported data' using errcode = '22023';
    end if;
  elsif next_status = 'SUBMITTED'
    and assessment_row.payload -> 'submittedAnswers'
      is distinct from payload_patch -> 'submittedAnswers' then
    raise exception 'This assignment was submitted with different answers' using errcode = '40001';
  elsif next_status = 'IN_PROGRESS'
    and exists (
      select 1
      from jsonb_object_keys(payload_patch) as keys(key)
      where keys.key not in ('draftAnswers', 'unansweredQuestionIds')
    ) then
    raise exception 'Incomplete assignment draft contains unsupported data' using errcode = '22023';
  elsif next_status = 'RESULTS_PUBLISHED'
    and exists (
      select 1
      from jsonb_object_keys(payload_patch) as keys(key)
      where keys.key not in (
        'learningAnalysisStatus',
        'learningAnalysis',
        'learningAnalysisUpdatedAt',
        'learningAnalysisError'
      )
    ) then
    raise exception 'Published assignment results cannot be changed' using errcode = '42501';
  end if;

  updated_payload := case
    when current_status = next_status and next_status = 'IN_PROGRESS'
      then assessment_row.payload || payload_patch
    when current_status = next_status and next_status <> 'RESULTS_PUBLISHED'
      then assessment_row.payload
    when current_status = 'IN_PROGRESS' and next_status = 'SUBMITTED'
      then (assessment_row.payload - 'draftAnswers' - 'unansweredQuestionIds') || payload_patch
    else assessment_row.payload || payload_patch
  end || jsonb_build_object('status', next_status);
  update public.student_agent_records
  set payload = updated_payload,
      updated_at = now()
  where id = assessment_row.id;

  return updated_payload;
end;
$$;

revoke all on function public.create_practice_assessment(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_practice_assessment(uuid, text, uuid, jsonb)
  to service_role;

revoke all on function public.transition_practice_assessment_state(uuid, text, text[], text, jsonb)
  from public, anon, authenticated;
grant execute on function public.transition_practice_assessment_state(uuid, text, text[], text, jsonb)
  to service_role;
