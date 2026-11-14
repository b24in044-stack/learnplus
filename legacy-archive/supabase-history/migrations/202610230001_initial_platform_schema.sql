create extension if not exists pgcrypto;

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

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null default '',
  credits integer not null default 0 check (credits >= 0),
  instructor_id uuid references public.profiles(id) on delete set null,
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (student_id, course_id)
);
create index if not exists enrollments_course_id_idx on public.enrollments(course_id);

create table if not exists public.student_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_id text not null,
  topic_title text not null,
  mastery_score numeric(5,2) not null default 0 check (mastery_score between 0 and 100),
  is_completed boolean not null default false,
  last_studied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, course_id, topic_id)
);
create index if not exists student_progress_owner_idx on public.student_progress(student_id, course_id);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists recommendations_owner_created_idx on public.recommendations(student_id, created_at desc);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null,
  topic text not null default '',
  difficulty text not null default 'Intermediate',
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  passing_score integer not null default 70 check (passing_score between 0 and 100),
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assessments_course_created_idx on public.assessments(course_id, created_at desc);

create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  explanation text not null default '',
  topic_tag text not null default '',
  code_snippet text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (assessment_id, display_order)
);
create index if not exists assessment_questions_parent_idx on public.assessment_questions(assessment_id, display_order);

create table if not exists public.assessment_answer_keys (
  question_id uuid primary key references public.assessment_questions(id) on delete cascade,
  correct_option_index integer not null check (correct_option_index >= 0)
);

create table if not exists public.assessment_submissions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  score integer not null check (score >= 0),
  total_questions integer not null check (total_questions > 0),
  percentage numeric(5,2) not null check (percentage between 0 and 100),
  passed boolean not null,
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  idempotency_key uuid,
  submitted_at timestamptz not null default now(),
  unique (student_id, assessment_id, idempotency_key)
);
create index if not exists submissions_owner_date_idx on public.assessment_submissions(student_id, submitted_at desc);

create table if not exists public.course_documents (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  title text not null,
  file_type text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists course_documents_owner_idx on public.course_documents(owner_id, course_id, created_at desc);

create table if not exists public.learning_path_nodes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sequence_number integer not null check (sequence_number > 0),
  status text not null default 'locked' check (status in ('mastered', 'in_progress', 'locked')),
  mastery_score numeric(5,2) check (mastery_score between 0 and 100),
  prerequisites jsonb not null default '[]'::jsonb check (jsonb_typeof(prerequisites) = 'array'),
  estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
  related_resources jsonb not null default '[]'::jsonb check (jsonb_typeof(related_resources) = 'array'),
  why_next_reason text not null default '',
  practice_prompt text not null default '',
  unique (student_id, course_id, sequence_number)
);
create index if not exists learning_path_owner_idx on public.learning_path_nodes(student_id, course_id, sequence_number);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null default 'New Learning Conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_sessions_owner_updated_idx on public.chat_sessions(owner_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_date_idx on public.chat_messages(session_id, created_at);

create table if not exists public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  task_type text not null default 'review',
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists study_tasks_owner_due_idx on public.study_tasks(owner_id, due_at);

create table if not exists public.planner_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  completed boolean not null default false,
  notes text not null default '',
  session_type text not null default 'review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists planner_sessions_owner_start_idx on public.planner_sessions(owner_id, starts_at);

create table if not exists public.engagement_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  event_type text not null,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists engagement_owner_date_idx on public.engagement_events(student_id, created_at desc);

create or replace function public.publish_assessment(
  p_course_id uuid,
  p_title text,
  p_topic text,
  p_difficulty text,
  p_duration_minutes integer,
  p_passing_score integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_assessment_id uuid;
  new_question_id uuid;
  question jsonb;
  question_order integer := 0;
begin
  if public.current_app_role() <> 'faculty' or not public.can_access_course(p_course_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'At least one question is required' using errcode = '22023';
  end if;

  insert into public.assessments
    (course_id, created_by, title, topic, difficulty, duration_minutes, passing_score, status)
  values
    (p_course_id, (select auth.uid()), p_title, coalesce(p_topic, ''), p_difficulty,
     p_duration_minutes, p_passing_score, 'published')
  returning id into new_assessment_id;

  for question in select value from jsonb_array_elements(p_questions)
  loop
    if jsonb_typeof(question->'options') <> 'array'
      or (question->>'correctOptionIndex')::integer < 0
      or (question->>'correctOptionIndex')::integer >= jsonb_array_length(question->'options') then
      raise exception 'Invalid question options' using errcode = '22023';
    end if;
    insert into public.assessment_questions
      (assessment_id, question_text, options, explanation, topic_tag, code_snippet, display_order)
    values
      (new_assessment_id, question->>'questionText', question->'options',
       coalesce(question->>'explanation', ''),
       coalesce(question->>'topicTag', ''), question->>'codeSnippet', question_order)
    returning id into new_question_id;
    insert into public.assessment_answer_keys (question_id, correct_option_index)
    values (new_question_id, (question->>'correctOptionIndex')::integer);
    question_order := question_order + 1;
  end loop;
  return new_assessment_id;
end;
$$;

create or replace function public.submit_assessment(
  p_assessment_id uuid,
  p_answers jsonb,
  p_time_spent_seconds integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  assessment_row public.assessments%rowtype;
  question_row public.assessment_questions%rowtype;
  selected_option integer;
  correct_count integer := 0;
  correct_index integer;
  total_count integer := 0;
  question_results jsonb := '[]'::jsonb;
  result_payload jsonb;
  existing_result jsonb;
  topic_score integer := 0;
  new_submission_id uuid := gen_random_uuid();
begin
  if public.current_app_role() <> 'student' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select result into existing_result
    from public.assessment_submissions
    where student_id = (select auth.uid())
      and assessment_id = p_assessment_id
      and idempotency_key = p_idempotency_key;
    if found then return existing_result; end if;
  end if;
  select * into assessment_row from public.assessments
  where id = p_assessment_id and status = 'published';
  if not found then raise exception 'Assessment not found' using errcode = 'P0002'; end if;
  if not public.can_access_course(assessment_row.course_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  for question_row in
    select * from public.assessment_questions
    where assessment_id = p_assessment_id order by display_order
  loop
    total_count := total_count + 1;
    select correct_option_index into correct_index
    from public.assessment_answer_keys where question_id = question_row.id;
    begin
      selected_option := (p_answers->>question_row.id::text)::integer;
    exception when others then
      selected_option := -1;
    end;
    if selected_option = correct_index then
      correct_count := correct_count + 1;
    end if;
    question_results := question_results || jsonb_build_array(jsonb_build_object(
      'questionId', question_row.id,
      'questionText', question_row.question_text,
      'selectedOption', coalesce(selected_option, -1),
      'correctOption', correct_index,
      'isCorrect', selected_option = correct_index,
      'explanation', question_row.explanation
    ));
  end loop;
  if total_count = 0 then raise exception 'Assessment has no questions' using errcode = '22023'; end if;
  topic_score := correct_count;
  result_payload := jsonb_build_object(
    'submissionId', new_submission_id,
    'assessmentId', assessment_row.id,
    'assessmentTitle', assessment_row.title,
    'courseCode', (select code from public.courses where id = assessment_row.course_id),
    'score', correct_count,
    'totalQuestions', total_count,
    'percentage', round(correct_count::numeric * 100 / total_count),
    'passed', round(correct_count::numeric * 100 / total_count) >= assessment_row.passing_score,
    'completedAt', now(),
    'timeSpentSeconds', greatest(coalesce(p_time_spent_seconds, 0), 0),
    'topicBreakdown', jsonb_build_array(jsonb_build_object(
      'topic', assessment_row.topic,
      'score', topic_score,
      'total', total_count,
      'percentage', round(correct_count::numeric * 100 / total_count)
    )),
    'questionResults', question_results,
    'recommendedFollowUp', jsonb_build_object(
      'topic', assessment_row.topic,
      'reason', case when round(correct_count::numeric * 100 / total_count) >= assessment_row.passing_score
        then 'Strong performance. Advance to the next concept.'
        else 'Targeted review suggested before the next assessment.' end,
      'practicePrompt', 'Review the concepts behind ' || assessment_row.topic || ' and practice two short examples before the next quiz.'
    )
  );
  insert into public.assessment_submissions
    (id, assessment_id, student_id, answers, score, total_questions, percentage, passed, time_spent_seconds, result, idempotency_key)
  values
    (new_submission_id, p_assessment_id, (select auth.uid()), coalesce(p_answers, '{}'::jsonb), correct_count,
     total_count, round(correct_count::numeric * 100 / total_count),
     round(correct_count::numeric * 100 / total_count) >= assessment_row.passing_score,
     greatest(coalesce(p_time_spent_seconds, 0), 0), result_payload, p_idempotency_key)
  on conflict (student_id, assessment_id, idempotency_key) do nothing
  returning id into new_submission_id;
  if not found and p_idempotency_key is not null then
    select result into existing_result
    from public.assessment_submissions
    where student_id = (select auth.uid())
      and assessment_id = p_assessment_id
      and idempotency_key = p_idempotency_key;
    return existing_result;
  end if;
  return result_payload;
end;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function public.can_access_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.courses c
    where c.id = target_course_id
      and (
        c.instructor_id = (select auth.uid())
        or exists (
          select 1 from public.enrollments e
          where e.course_id = c.id and e.student_id = (select auth.uid())
        )
      )
  )
$$;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.student_progress enable row level security;
alter table public.recommendations enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_answer_keys enable row level security;
alter table public.assessment_submissions enable row level security;
alter table public.course_documents enable row level security;
alter table public.learning_path_nodes enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.study_tasks enable row level security;
alter table public.planner_sessions enable row level security;
alter table public.engagement_events enable row level security;

grant select on public.profiles to authenticated;
grant select on public.courses to authenticated;
grant select on public.enrollments to authenticated;
grant select, insert, update, delete on public.student_progress to authenticated;
grant select, insert, update, delete on public.recommendations to authenticated;
grant select, insert, update, delete on public.assessments to authenticated;
grant select, insert, update, delete on public.assessment_questions to authenticated;
grant select, insert on public.assessment_answer_keys to authenticated;
grant select on public.assessment_submissions to authenticated;
grant select, insert, update, delete on public.course_documents to authenticated;
grant select, insert, update, delete on public.learning_path_nodes to authenticated;
grant select, insert, update, delete on public.chat_sessions to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;
grant select, insert, update, delete on public.study_tasks to authenticated;
grant select, insert, update, delete on public.planner_sessions to authenticated;
grant select, insert on public.engagement_events to authenticated;

create policy profiles_select_self on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_course_students_for_faculty on public.profiles for select to authenticated
using (
  public.current_app_role() = 'faculty'
  and exists (
    select 1 from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.student_id = profiles.id and c.instructor_id = (select auth.uid())
  )
);
create policy profiles_select_assigned_faculty_for_students on public.profiles for select to authenticated
using (
  role = 'faculty'
  and public.current_app_role() = 'student'
  and exists (
    select 1 from public.courses c
    join public.enrollments e on e.course_id = c.id
    where c.instructor_id = profiles.id and e.student_id = (select auth.uid())
  )
);

create policy courses_select_enrolled_or_assigned on public.courses for select to authenticated
using (public.can_access_course(id));

create policy enrollments_select_owner_or_instructor on public.enrollments for select to authenticated
using (student_id = (select auth.uid()) or public.can_access_course(course_id));
create policy student_progress_owner on public.student_progress for all to authenticated
using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy student_progress_faculty_read on public.student_progress for select to authenticated
using (
  public.current_app_role() = 'faculty'
  and exists (
    select 1 from public.courses c
    where c.id = student_progress.course_id and c.instructor_id = (select auth.uid())
  )
);
create policy recommendations_owner on public.recommendations for all to authenticated
using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));

create policy assessments_course_read on public.assessments for select to authenticated
using (public.can_access_course(course_id));
create policy assessments_faculty_manage on public.assessments for all to authenticated
using (created_by = (select auth.uid()) and public.current_app_role() = 'faculty' and public.can_access_course(course_id))
with check (created_by = (select auth.uid()) and public.current_app_role() = 'faculty' and public.can_access_course(course_id));

create policy questions_course_read on public.assessment_questions for select to authenticated
using (exists (select 1 from public.assessments a where a.id = assessment_id and public.can_access_course(a.course_id)));
create policy questions_faculty_manage on public.assessment_questions for all to authenticated
using (exists (select 1 from public.assessments a where a.id = assessment_id and a.created_by = (select auth.uid()) and public.current_app_role() = 'faculty'))
with check (exists (select 1 from public.assessments a where a.id = assessment_id and a.created_by = (select auth.uid()) and public.current_app_role() = 'faculty'));

create policy answer_keys_faculty_read on public.assessment_answer_keys for select to authenticated
using (exists (
  select 1 from public.assessment_questions q join public.assessments a on a.id = q.assessment_id
  where q.id = question_id and a.created_by = (select auth.uid()) and public.current_app_role() = 'faculty'
));
create policy answer_keys_faculty_insert on public.assessment_answer_keys for insert to authenticated
with check (exists (
  select 1 from public.assessment_questions q join public.assessments a on a.id = q.assessment_id
  where q.id = question_id and a.created_by = (select auth.uid()) and public.current_app_role() = 'faculty'
));

create policy submissions_owner_read on public.assessment_submissions for select to authenticated
using (student_id = (select auth.uid()));
create policy submissions_course_faculty_read on public.assessment_submissions for select to authenticated
using (
  public.current_app_role() = 'faculty'
  and exists (
    select 1 from public.assessments a
    join public.courses c on c.id = a.course_id
    where a.id = assessment_submissions.assessment_id and c.instructor_id = (select auth.uid())
  )
);

create policy documents_owner_access on public.course_documents for all to authenticated
using (owner_id = (select auth.uid()) and public.can_access_course(course_id))
with check (owner_id = (select auth.uid()) and public.can_access_course(course_id));
create policy learning_path_owner on public.learning_path_nodes for all to authenticated
using (student_id = (select auth.uid()) and public.can_access_course(course_id))
with check (student_id = (select auth.uid()) and public.can_access_course(course_id));

create policy chat_sessions_owner on public.chat_sessions for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy chat_messages_owner_read on public.chat_messages for select to authenticated
using (exists (select 1 from public.chat_sessions s where s.id = session_id and s.owner_id = (select auth.uid())));
create policy chat_messages_owner_user_insert on public.chat_messages for insert to authenticated
with check (role = 'user' and exists (select 1 from public.chat_sessions s where s.id = session_id and s.owner_id = (select auth.uid())));
create policy chat_messages_owner_delete on public.chat_messages for delete to authenticated
using (exists (select 1 from public.chat_sessions s where s.id = session_id and s.owner_id = (select auth.uid())));

create policy study_tasks_owner on public.study_tasks for all to authenticated
using (owner_id = (select auth.uid()) and public.current_app_role() = 'student' and public.can_access_course(course_id))
with check (owner_id = (select auth.uid()) and public.current_app_role() = 'student' and public.can_access_course(course_id));
create policy planner_sessions_owner on public.planner_sessions for all to authenticated
using (owner_id = (select auth.uid()) and public.current_app_role() = 'student' and public.can_access_course(course_id))
with check (owner_id = (select auth.uid()) and public.current_app_role() = 'student' and public.can_access_course(course_id));
create policy engagement_owner on public.engagement_events for all to authenticated
using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy engagement_faculty_read on public.engagement_events for select to authenticated
using (
  public.current_app_role() = 'faculty'
  and exists (
    select 1 from public.courses c
    where c.id = engagement_events.course_id and c.instructor_id = (select auth.uid())
  )
);

revoke all on function public.publish_assessment(uuid, text, text, text, integer, integer, jsonb) from public, anon;
grant execute on function public.publish_assessment(uuid, text, text, text, integer, integer, jsonb) to authenticated;
revoke all on function public.submit_assessment(uuid, jsonb, integer, uuid) from public, anon;
grant execute on function public.submit_assessment(uuid, jsonb, integer, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-materials', 'study-materials', false, 10485760,
  array['application/pdf', 'text/plain', 'text/markdown', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy study_materials_owner_select on storage.objects for select to authenticated
using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy study_materials_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'study-materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy study_materials_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = (select auth.uid())::text);
