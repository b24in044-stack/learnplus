create or replace function public.record_concept_mastery_evidence(
  target_course_id uuid,
  target_concept_id text,
  target_concept_title text,
  answer_correct boolean,
  target_source_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_key text;
  result_payload jsonb;
begin
  if private.current_app_role() <> 'student'
    or not private.has_course_access(target_course_id) then
    raise exception 'Course access is not authorized' using errcode = '42501';
  end if;
  if target_concept_id is null or length(trim(target_concept_id)) = 0
    or target_concept_title is null or length(trim(target_concept_title)) = 0
    or answer_correct is null
    or target_source_id is null or length(trim(target_source_id)) = 0 then
    raise exception 'Concept mastery evidence is incomplete' using errcode = '22023';
  end if;

  record_key := target_course_id::text || ':' || target_concept_id;
  insert into public.student_agent_records (
    legacy_id, owner_id, course_id, record_type, payload
  ) values (
    record_key,
    (select auth.uid()),
    target_course_id,
    'concept_mastery',
    jsonb_build_object(
      'ownerUid', (select auth.uid())::text,
      'courseId', target_course_id::text,
      'conceptId', target_concept_id,
      'conceptTitle', target_concept_title,
      'method', 'Beta(2, 2) prior; one Bernoulli evidence per graded practice response',
      'evidenceCount', 1,
      'correctCount', answer_correct::integer,
      'masteryScore', round((100 * (2 + answer_correct::integer)::numeric / 5), 1),
      'estimated', true,
      'lastEvidenceId', target_source_id
    )
  )
  on conflict (owner_id, record_type, legacy_id) do update
  set payload = jsonb_build_object(
    'ownerUid', (select auth.uid())::text,
    'courseId', target_course_id::text,
    'conceptId', target_concept_id,
    'conceptTitle', target_concept_title,
    'method', 'Beta(2, 2) prior; one Bernoulli evidence per graded practice response',
    'evidenceCount', coalesce((public.student_agent_records.payload ->> 'evidenceCount')::integer, 0) + 1,
    'correctCount',
      coalesce((public.student_agent_records.payload ->> 'correctCount')::integer, 0)
      + answer_correct::integer,
    'masteryScore',
      round((
        100 * (
          2
          + coalesce((public.student_agent_records.payload ->> 'correctCount')::integer, 0)
          + answer_correct::integer
        )::numeric
        / (
          4
          + coalesce((public.student_agent_records.payload ->> 'evidenceCount')::integer, 0)
          + 1
        )
      ), 1),
    'estimated', true,
    'lastEvidenceId', target_source_id
  ),
  updated_at = now()
  returning payload into result_payload;

  return result_payload;
end;
$$;

create or replace function public.record_ai_learning_activity(
  target_course_id uuid,
  target_activity_type text,
  target_assessment_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if private.current_app_role() <> 'student'
    or not private.has_course_access(target_course_id) then
    raise exception 'Course access is not authorized' using errcode = '42501';
  end if;
  if target_activity_type is null or length(trim(target_activity_type)) = 0
    or length(target_activity_type) > 80
    or target_assessment_id is null or length(trim(target_assessment_id)) = 0 then
    raise exception 'Learning activity fields are incomplete' using errcode = '22023';
  end if;

  insert into public.learning_activity (
    student_id, course_id, activity_type, ai_generated, metadata
  ) values (
    (select auth.uid()),
    target_course_id,
    target_activity_type,
    true,
    jsonb_build_object('assessment_id', target_assessment_id)
  )
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.record_concept_mastery_evidence(uuid, text, text, boolean, text)
  from public, anon;
grant execute on function public.record_concept_mastery_evidence(uuid, text, text, boolean, text)
  to authenticated;
revoke all on function public.record_ai_learning_activity(uuid, text, text)
  from public, anon;
grant execute on function public.record_ai_learning_activity(uuid, text, text)
  to authenticated;
