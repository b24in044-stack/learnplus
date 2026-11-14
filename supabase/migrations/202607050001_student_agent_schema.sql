create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

create schema private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  code text not null default '',
  name text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.regulations (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  code text not null default '',
  name text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null,
  starts_on date,
  ends_on date,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  department_id uuid references public.departments(id) on delete set null,
  code text not null default '',
  name text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  regulation_id uuid references public.regulations(id) on delete set null,
  name text not null default '',
  semester_number integer check (semester_number is null or semester_number > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  department_id uuid references public.departments(id) on delete set null,
  regulation_id uuid references public.regulations(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  code text not null default '',
  title text not null,
  semester_number integer check (semester_number is null or semester_number > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'faculty', 'admin')),
  avatar_url text,
  department_id uuid references public.departments(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  regulation_id uuid references public.regulations(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  current_semester_id uuid references public.semesters(id) on delete set null,
  student_id text,
  enrolled_since date,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  code text not null default '',
  title text not null,
  description text not null default '',
  instructor_id uuid references public.profiles(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  regulation_id uuid references public.regulations(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  credits integer not null default 0 check (credits >= 0),
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array'),
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_instructor_idx on public.courses(instructor_id);
create index courses_subject_idx on public.courses(subject_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  status text not null default 'active',
  enrolled_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enrollments_student_course_idx on public.enrollments(student_id, course_id);
create index enrollments_course_idx on public.enrollments(course_id, status);

create table public.course_materials (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  course_id uuid not null references public.courses(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null default '',
  description text not null default '',
  material_type text not null default 'material',
  file_type text,
  bucket_id text,
  object_path text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  published boolean not null default false,
  publication_status text not null default 'draft',
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_storage_bucket text,
  legacy_storage_path text,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index course_materials_course_publish_idx
  on public.course_materials(course_id, publication_status, published_at desc);
create unique index course_materials_storage_object_idx
  on public.course_materials(bucket_id, object_path) where object_path is not null;

create table public.examination_papers (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  course_id uuid references public.courses(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null default '',
  examination_type text not null default '',
  department_id uuid references public.departments(id) on delete set null,
  regulation_id uuid references public.regulations(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  bucket_id text,
  object_path text,
  file_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  published boolean not null default false,
  publication_status text not null default 'draft',
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_storage_bucket text,
  legacy_storage_path text,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index examination_papers_course_publish_idx
  on public.examination_papers(course_id, publication_status, published_at desc);
create unique index examination_papers_storage_object_idx
  on public.examination_papers(bucket_id, object_path) where object_path is not null;

create table public.official_answer_keys (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  course_id uuid references public.courses(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  examination_paper_id uuid references public.examination_papers(id) on delete set null,
  title text not null default '',
  examination_type text not null default '',
  department_id uuid references public.departments(id) on delete set null,
  regulation_id uuid references public.regulations(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  bucket_id text,
  object_path text,
  release_at timestamptz,
  published boolean not null default false,
  publication_status text not null default 'draft',
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_storage_bucket text,
  legacy_storage_path text,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index official_answer_keys_course_publish_idx
  on public.official_answer_keys(course_id, publication_status, release_at);
create unique index official_answer_keys_storage_object_idx
  on public.official_answer_keys(bucket_id, object_path) where object_path is not null;

create table public.verified_subject_marks (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  examination_type text,
  marks numeric(10, 2),
  max_marks numeric(10, 2),
  grade text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_marks is null or max_marks >= 0)
);
create index verified_subject_marks_student_idx on public.verified_subject_marks(student_id, subject_id);

create table public.semester_results (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  semester_number integer check (semester_number is null or semester_number > 0),
  result_status text not null default '',
  sgpa numeric(5, 2),
  cgpa numeric(5, 2),
  total_credits numeric(8, 2),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index semester_results_student_idx on public.semester_results(student_id, academic_year_id, semester_number);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  title text not null,
  topic text not null default '',
  difficulty text not null default 'Intermediate',
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  passing_score integer not null default 70 check (passing_score between 0 and 100),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assessments_course_status_created_idx
  on public.assessments(course_id, status, created_at desc);

create table public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_key text not null default gen_random_uuid()::text,
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  topic_tag text not null default '',
  code_snippet text,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  unique (assessment_id, question_key)
);
create index assessment_questions_parent_idx
  on public.assessment_questions(assessment_id, display_order);

create table public.assessment_answer_keys (
  question_id uuid primary key references public.assessment_questions(id) on delete cascade,
  correct_option_index integer not null check (correct_option_index >= 0),
  explanation text not null default ''
);

create table public.assessment_submissions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  score integer not null check (score >= 0),
  total_questions integer not null check (total_questions > 0),
  percentage numeric(5, 2) not null check (percentage between 0 and 100),
  passed boolean not null,
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  idempotency_key uuid,
  submitted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (student_id, assessment_id, idempotency_key)
);
create index assessment_submissions_student_date_idx
  on public.assessment_submissions(student_id, submitted_at desc);
create index assessment_submissions_course_date_idx
  on public.assessment_submissions(course_id, submitted_at desc);

create table public.student_progress (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_id text not null default '',
  topic_title text not null default '',
  mastery_score numeric(5, 2) not null default 0 check (mastery_score between 0 and 100),
  total_attempts integer not null default 0 check (total_attempts >= 0),
  is_completed boolean not null default false,
  last_studied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index student_progress_owner_course_idx on public.student_progress(student_id, course_id);

create table public.engagement_events (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  event_type text not null,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now()
);
create index engagement_events_student_date_idx on public.engagement_events(student_id, created_at desc);
create index engagement_events_course_date_idx on public.engagement_events(course_id, created_at desc);

create table public.learning_activity (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  assessment_id uuid references public.assessments(id) on delete set null,
  activity_type text not null,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  ai_generated boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now()
);
create index learning_activity_student_date_idx on public.learning_activity(student_id, created_at desc);
create index learning_activity_course_date_idx on public.learning_activity(course_id, created_at desc);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recommendations_student_date_idx on public.recommendations(student_id, created_at desc);

create table public.learning_path_nodes (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sequence_number integer not null default 1 check (sequence_number > 0),
  status text not null default 'locked',
  mastery_score numeric(5, 2) check (mastery_score is null or mastery_score between 0 and 100),
  prerequisites jsonb not null default '[]'::jsonb check (jsonb_typeof(prerequisites) = 'array'),
  estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
  related_resources jsonb not null default '[]'::jsonb check (jsonb_typeof(related_resources) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learning_path_nodes_owner_course_idx
  on public.learning_path_nodes(student_id, course_id, sequence_number);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  legacy_collection text not null default 'tasks',
  legacy_id text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  task_type text not null default 'review',
  priority text not null default 'medium',
  due_at timestamptz,
  completed boolean not null default false,
  notes text not null default '',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_owner_due_idx on public.tasks(owner_id, due_at);

create table public.planner_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  completed boolean not null default false,
  notes text not null default '',
  session_type text not null default 'review',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planner_sessions_owner_start_idx on public.planner_sessions(owner_id, starts_at);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  legacy_collection text not null default 'conversations',
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null default 'Learning Conversation',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, legacy_collection, legacy_id)
);
create index conversations_owner_updated_idx on public.conversations(owner_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (conversation_id, legacy_id)
);
create index messages_conversation_created_idx on public.messages(conversation_id, created_at);

create table public.student_agent_records (
  id uuid primary key default gen_random_uuid(),
  legacy_id text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  record_type text not null check (
    record_type in ('learning_profiles', 'concept_mastery', 'practice_assessments', 'practice_submissions')
  ),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, record_type, legacy_id)
);
create index student_agent_records_owner_type_idx
  on public.student_agent_records(owner_id, record_type, updated_at desc);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  file_type text not null check (file_type in ('pdf', 'text', 'markdown')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  bucket_id text not null default 'student-documents',
  object_path text not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed')),
  visibility text not null default 'private' check (visibility in ('private', 'course')),
  published boolean not null default false,
  active_generation text,
  processing_generation text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  legacy_storage_bucket text,
  legacy_storage_path text,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);
create index documents_owner_course_idx on public.documents(owner_id, course_id, created_at desc);
create index documents_course_status_idx on public.documents(course_id, status, published);

alter table public.course_materials
  add column document_id uuid references public.documents(id) on delete set null;
alter table public.examination_papers
  add column document_id uuid references public.documents(id) on delete set null;
alter table public.official_answer_keys
  add column document_id uuid references public.documents(id) on delete set null;
create index course_materials_document_idx on public.course_materials(document_id);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  document_id uuid not null references public.documents(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  generation_id text not null default 'legacy',
  chunk_index integer not null check (chunk_index >= 0),
  page_number integer check (page_number is null or page_number > 0),
  content text not null,
  embedding_model text not null default 'sentence-transformers/all-MiniLM-L6-v2',
  embedding extensions.vector(384) not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (document_id, generation_id, chunk_index)
);
create index document_chunks_document_idx on public.document_chunks(document_id, chunk_index);
create index document_chunks_course_idx on public.document_chunks(course_id);
create index document_chunks_generation_idx on public.document_chunks(document_id, generation_id);
create index document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'departments', 'regulations', 'academic_years', 'branches', 'semesters',
    'subjects', 'profiles', 'courses', 'enrollments', 'course_materials',
    'examination_papers', 'official_answer_keys', 'verified_subject_marks',
    'semester_results', 'assessments', 'student_progress', 'recommendations',
    'learning_path_nodes', 'tasks', 'planner_sessions', 'conversations',
    'student_agent_records', 'documents'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

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

create or replace function private.faculty_can_access_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_app_role() = 'faculty' and exists (
    select 1
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.student_id = target_student_id
      and c.instructor_id = (select auth.uid())
  )
$$;

create or replace function private.has_subject_access(target_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    where e.student_id = (select auth.uid())
      and lower(e.status) in ('active', 'enrolled', 'completed')
      and (
        e.subject_id = target_subject_id
        or exists (
          select 1 from public.courses c
          where c.id = e.course_id and c.subject_id = target_subject_id
        )
      )
  )
$$;

create or replace function private.can_manage_subject(target_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_app_role() = 'faculty' and exists (
    select 1 from public.courses c
    where c.subject_id = target_subject_id
      and c.instructor_id = (select auth.uid())
  )
$$;

create or replace function private.can_access_document(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    where d.id = target_document_id
      and (
        d.owner_id = (select auth.uid())
        or (
          d.visibility = 'course'
          and d.published
          and d.course_id is not null
          and private.has_course_access(d.course_id)
          and exists (
            select 1 from public.course_materials m
            where m.document_id = d.id
              and m.course_id = d.course_id
              and m.published
              and m.publication_status = 'published'
          )
        )
      )
  )
$$;

create or replace function private.course_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  folders text[] := string_to_array(object_name, '/');
begin
  if array_length(folders, 1) >= 4
    and folders[1] = 'courses'
    and folders[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folders[3] = 'materials' then
    return folders[2]::uuid;
  end if;
  return null;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), ''),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is distinct from new.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function public.sync_auth_user_email();

create or replace function public.provision_profile(
  target_user_id uuid,
  trusted_role text,
  profile_name text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisioned public.profiles;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Trusted server authorization is required' using errcode = '42501';
  end if;
  if trusted_role is null or trusted_role not in ('student', 'faculty', 'admin') then
    raise exception 'Unsupported application role' using errcode = '22023';
  end if;

  insert into public.profiles (id, email, full_name, role)
  select u.id, coalesce(u.email, ''), coalesce(profile_name, ''), trusted_role
  from auth.users u
  where u.id = target_user_id
  on conflict (id) do update
    set role = excluded.role,
        full_name = case when profile_name is null then public.profiles.full_name else profile_name end
  returning * into provisioned;

  if not found then
    raise exception 'Auth user was not found' using errcode = 'P0002';
  end if;
  return provisioned;
end;
$$;

create or replace function public.publish_assessment(
  target_course_id uuid,
  assessment_title text,
  assessment_topic text,
  assessment_difficulty text,
  assessment_duration_minutes integer,
  assessment_passing_score integer,
  question_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_assessment_id uuid;
  new_question_id uuid;
  question jsonb;
  question_order integer := 0;
  options_count integer;
  correct_index integer;
  question_key text;
begin
  if not private.can_manage_course(target_course_id) then
    raise exception 'Course access is not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(question_payload) <> 'array'
    or jsonb_array_length(question_payload) < 1
    or jsonb_array_length(question_payload) > 100 then
    raise exception 'Assessment must contain 1 to 100 questions' using errcode = '22023';
  end if;
  if assessment_title is null or length(trim(assessment_title)) = 0 then
    raise exception 'Assessment title is required' using errcode = '22023';
  end if;

  insert into public.assessments (
    course_id, created_by, title, topic, difficulty, duration_minutes, passing_score, status
  ) values (
    target_course_id, (select auth.uid()), trim(assessment_title),
    coalesce(assessment_topic, ''), coalesce(assessment_difficulty, 'Intermediate'),
    greatest(coalesce(assessment_duration_minutes, 0), 0),
    greatest(0, least(coalesce(assessment_passing_score, 70), 100)),
    'published'
  )
  returning id into new_assessment_id;

  for question in select value from jsonb_array_elements(question_payload)
  loop
    if jsonb_typeof(question -> 'options') <> 'array'
      or jsonb_typeof(question -> 'questionText') <> 'string'
      or jsonb_typeof(question -> 'correctOptionIndex') <> 'number' then
      raise exception 'Invalid assessment question' using errcode = '22023';
    end if;
    options_count := jsonb_array_length(question -> 'options');
    correct_index := (question ->> 'correctOptionIndex')::integer;
    if options_count < 2 or correct_index < 0 or correct_index >= options_count then
      raise exception 'Invalid assessment answer key' using errcode = '22023';
    end if;
    question_key := coalesce(nullif(question ->> 'id', ''), gen_random_uuid()::text);

    insert into public.assessment_questions (
      assessment_id, question_key, question_text, options, topic_tag, code_snippet, display_order
    ) values (
      new_assessment_id, question_key, question ->> 'questionText', question -> 'options',
      coalesce(question ->> 'topicTag', ''),
      question ->> 'codeSnippet',
      question_order
    )
    returning id into new_question_id;

    insert into public.assessment_answer_keys (question_id, correct_option_index, explanation)
    values (new_question_id, correct_index, coalesce(question ->> 'explanation', ''));
    question_order := question_order + 1;
  end loop;
  return new_assessment_id;
end;
$$;

create or replace function public.submit_assessment(
  target_assessment_id uuid,
  submitted_answers jsonb,
  submitted_time_spent_seconds integer,
  request_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment_row public.assessments%rowtype;
  question_row record;
  selected_option integer;
  correct_count integer := 0;
  total_count integer := 0;
  question_results jsonb := '[]'::jsonb;
  result_payload jsonb;
  existing_result jsonb;
  new_submission_id uuid := gen_random_uuid();
  calculated_percentage integer;
  normalized_time integer := greatest(coalesce(submitted_time_spent_seconds, 0), 0);
begin
  if private.current_app_role() <> 'student' then
    raise exception 'Student access is required' using errcode = '42501';
  end if;
  if submitted_answers is null or jsonb_typeof(submitted_answers) <> 'object' then
    raise exception 'Answers must be a JSON object' using errcode = '22023';
  end if;
  if request_idempotency_key is not null then
    select s.result into existing_result
    from public.assessment_submissions s
    where s.student_id = (select auth.uid())
      and s.assessment_id = target_assessment_id
      and s.idempotency_key = request_idempotency_key;
    if found then
      return existing_result;
    end if;
  end if;

  select * into assessment_row
  from public.assessments a
  where a.id = target_assessment_id and a.status = 'published';
  if not found then
    raise exception 'Assessment not found' using errcode = 'P0002';
  end if;
  if not private.has_course_access(assessment_row.course_id) then
    raise exception 'Course access is not authorized' using errcode = '42501';
  end if;

  for question_row in
    select q.id, q.question_key, q.question_text, q.topic_tag, k.correct_option_index, k.explanation
    from public.assessment_questions q
    join public.assessment_answer_keys k on k.question_id = q.id
    where q.assessment_id = target_assessment_id
    order by q.display_order
  loop
    total_count := total_count + 1;
    begin
      selected_option := (submitted_answers ->> question_row.question_key)::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      selected_option := -1;
    end;
    if selected_option = question_row.correct_option_index then
      correct_count := correct_count + 1;
    end if;
    question_results := question_results || jsonb_build_array(jsonb_build_object(
      'questionId', question_row.question_key,
      'questionText', question_row.question_text,
      'selectedOption', coalesce(selected_option, -1),
      'correctOption', question_row.correct_option_index,
      'isCorrect', selected_option = question_row.correct_option_index,
      'explanation', question_row.explanation
    ));
  end loop;
  if total_count = 0 then
    raise exception 'Assessment has no questions' using errcode = '22023';
  end if;

  calculated_percentage := round(correct_count::numeric * 100 / total_count)::integer;
  result_payload := jsonb_build_object(
    'submissionId', new_submission_id,
    'assessmentId', target_assessment_id,
    'assessmentTitle', assessment_row.title,
    'courseCode', (select c.code from public.courses c where c.id = assessment_row.course_id),
    'score', correct_count,
    'totalQuestions', total_count,
    'percentage', calculated_percentage,
    'passed', calculated_percentage >= assessment_row.passing_score,
    'completedAt', now(),
    'timeSpentSeconds', normalized_time,
    'topicBreakdown', jsonb_build_array(jsonb_build_object(
      'topic', assessment_row.topic,
      'score', correct_count,
      'total', total_count,
      'percentage', calculated_percentage
    )),
    'questionResults', question_results,
    'recommendedFollowUp', jsonb_build_object(
      'topic', assessment_row.topic,
      'reason', case
        when calculated_percentage >= assessment_row.passing_score
          then 'Strong performance. Advance to the next concept.'
        else 'Targeted review suggested before the next assessment.'
      end,
      'practicePrompt', 'Review the concepts behind '
        || coalesce(nullif(assessment_row.topic, ''), assessment_row.title)
        || ' and practice two short examples before the next quiz.'
    )
  );

  insert into public.assessment_submissions (
    id, assessment_id, course_id, student_id, answers, score, total_questions, percentage,
    passed, time_spent_seconds, result, idempotency_key
  ) values (
    new_submission_id, target_assessment_id, assessment_row.course_id,
    (select auth.uid()), submitted_answers,
    correct_count, total_count, calculated_percentage,
    calculated_percentage >= assessment_row.passing_score,
    normalized_time, result_payload, request_idempotency_key
  )
  on conflict (student_id, assessment_id, idempotency_key) do nothing
  returning id into new_submission_id;

  if not found and request_idempotency_key is not null then
    select s.result into existing_result
    from public.assessment_submissions s
    where s.student_id = (select auth.uid())
      and s.assessment_id = target_assessment_id
      and s.idempotency_key = request_idempotency_key;
    return existing_result;
  end if;

  insert into public.learning_activity (
    student_id, course_id, assessment_id, activity_type, created_at
  ) values (
    (select auth.uid()), assessment_row.course_id, target_assessment_id, 'assessment_completed', now()
  );
  return result_payload;
end;
$$;

create or replace function public.append_conversation_turn(
  target_conversation_id uuid,
  user_content text,
  assistant_content text,
  turn_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.conversations%rowtype;
  assistant_message_id uuid := gen_random_uuid();
  created_time timestamptz := now();
begin
  select * into conversation_row
  from public.conversations c
  where c.id = target_conversation_id
    and c.owner_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'Conversation was not found or is not accessible' using errcode = 'P0002';
  end if;
  if user_content is null or assistant_content is null then
    raise exception 'Conversation turn content is required' using errcode = '22023';
  end if;

  insert into public.messages (conversation_id, role, content, created_at)
  values (target_conversation_id, 'user', user_content, created_time);
  insert into public.messages (id, conversation_id, role, content, metadata, created_at)
  values (
    assistant_message_id, target_conversation_id, 'assistant', assistant_content,
    coalesce(turn_metadata, '{}'::jsonb), created_time
  );
  update public.conversations set updated_at = created_time where id = target_conversation_id;
  insert into public.learning_activity (student_id, course_id, activity_type, created_at)
  values (
    conversation_row.owner_id, conversation_row.course_id, 'ai_tutor_turn', created_time
  );
  return assistant_message_id;
end;
$$;

create or replace function public.set_task_completion(
  target_task_id uuid,
  source_collection text,
  next_completed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.tasks%rowtype;
begin
  if source_collection not in ('tasks', 'study_tasks') then
    raise exception 'Unsupported task collection' using errcode = '22023';
  end if;
  select * into task_row
  from public.tasks t
  where t.id = target_task_id
    and t.legacy_collection = source_collection
    and t.owner_id = (select auth.uid())
    and (t.course_id is null or private.has_course_access(t.course_id))
  for update;
  if not found then
    raise exception 'Task was not found or is not accessible' using errcode = 'P0002';
  end if;

  update public.tasks set completed = next_completed where id = target_task_id;
  if next_completed then
    insert into public.learning_activity (
      student_id, course_id, activity_type, created_at
    ) values (
      task_row.owner_id, task_row.course_id, 'task_completed', now()
    );
  end if;
end;
$$;

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(384),
  result_limit integer default 8,
  target_course_id uuid default null,
  target_embedding_model text default 'sentence-transformers/all-MiniLM-L6-v2'
)
returns table (
  chunk_id uuid,
  document_id uuid,
  chunk_index integer,
  page_number integer,
  content text,
  metadata jsonb,
  similarity double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if result_limit < 1 or result_limit > 50 then
    raise exception 'Result limit must be between 1 and 50' using errcode = '22023';
  end if;
  if target_embedding_model is null or length(trim(target_embedding_model)) = 0 then
    raise exception 'Embedding model is required' using errcode = '22023';
  end if;
  if target_course_id is not null and not private.has_course_access(target_course_id) then
    raise exception 'Course access is not authorized' using errcode = '42501';
  end if;

  return query
  select dc.id, dc.document_id, dc.chunk_index, dc.page_number, dc.content, dc.metadata,
    (1 - (dc.embedding <=> query_embedding))::double precision
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.embedding_model = target_embedding_model
    and d.active_generation = dc.generation_id
    and (
      (
        target_course_id is null
        and d.owner_id = (select auth.uid())
      )
      or (
        target_course_id is not null
        and dc.course_id = target_course_id
        and d.course_id = target_course_id
        and (
          d.owner_id = (select auth.uid())
          or (
            d.visibility = 'course'
            and d.published
            and exists (
              select 1 from public.course_materials m
              where m.document_id = d.id
                and m.course_id = target_course_id
                and m.published
                and m.publication_status = 'published'
            )
          )
        )
      )
    )
  order by dc.embedding <=> query_embedding
  limit result_limit;
end;
$$;

create or replace function public.begin_document_processing(
  target_document_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_row public.documents%rowtype;
  next_generation text := gen_random_uuid()::text;
begin
  select * into document_row
  from public.documents d
  where d.id = target_document_id
    and (
      d.owner_id = (select auth.uid())
      or private.can_manage_course(d.course_id)
    )
  for update;
  if not found then
    raise exception 'Document was not found or is not accessible' using errcode = 'P0002';
  end if;
  if document_row.status not in ('uploaded', 'failed', 'ready') then
    raise exception 'The document is already being processed or is not retryable' using errcode = '55000';
  end if;

  update public.documents
  set status = 'processing',
      processing_generation = next_generation,
      updated_at = now()
  where id = target_document_id;
  return next_generation;
end;
$$;

create or replace function public.complete_document_processing(
  target_document_id uuid,
  target_generation text,
  expected_chunk_count integer,
  target_embedding_model text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_row public.documents%rowtype;
  actual_chunk_count integer;
begin
  if expected_chunk_count < 1 or expected_chunk_count > 2000 then
    raise exception 'Invalid document chunk count' using errcode = '22023';
  end if;
  if target_embedding_model is null or length(trim(target_embedding_model)) = 0 then
    raise exception 'Embedding model is required' using errcode = '22023';
  end if;

  select * into document_row
  from public.documents d
  where d.id = target_document_id
    and d.processing_generation = target_generation
    and (
      d.owner_id = (select auth.uid())
      or private.can_manage_course(d.course_id)
    )
  for update;
  if not found then
    raise exception 'Document processing generation is no longer active' using errcode = 'P0002';
  end if;

  select count(*) into actual_chunk_count
  from public.document_chunks dc
  where dc.document_id = target_document_id
    and dc.generation_id = target_generation
    and dc.embedding_model = target_embedding_model;
  if actual_chunk_count <> expected_chunk_count then
    raise exception 'Document chunk generation is incomplete' using errcode = '55000';
  end if;

  update public.documents
  set active_generation = target_generation,
      processing_generation = null,
      status = 'ready',
      metadata = jsonb_set(
        jsonb_set(coalesce(metadata, '{}'::jsonb), '{chunks_count}', to_jsonb(actual_chunk_count), true),
        '{embedding_model}', to_jsonb(target_embedding_model), true
      ),
      updated_at = now()
  where id = target_document_id;

  delete from public.document_chunks
  where document_id = target_document_id
    and generation_id <> target_generation;
end;
$$;

create or replace function public.fail_document_processing(
  target_document_id uuid,
  target_generation text,
  safe_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if safe_error_code is null or length(safe_error_code) > 80 then
    raise exception 'Invalid document error code' using errcode = '22023';
  end if;
  update public.documents d
  set status = 'failed',
      processing_generation = null,
      metadata = jsonb_set(coalesce(d.metadata, '{}'::jsonb), '{last_error_code}', to_jsonb(safe_error_code), true),
      updated_at = now()
  where d.id = target_document_id
    and d.processing_generation = target_generation
    and (
      d.owner_id = (select auth.uid())
      or private.can_manage_course(d.course_id)
    );
  if not found then
    raise exception 'Document processing generation is no longer active' using errcode = 'P0002';
  end if;
  delete from public.document_chunks dc
  where dc.document_id = target_document_id
    and dc.generation_id = target_generation;
end;
$$;

alter table public.departments enable row level security;
alter table public.regulations enable row level security;
alter table public.academic_years enable row level security;
alter table public.branches enable row level security;
alter table public.semesters enable row level security;
alter table public.subjects enable row level security;
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.course_materials enable row level security;
alter table public.examination_papers enable row level security;
alter table public.official_answer_keys enable row level security;
alter table public.verified_subject_marks enable row level security;
alter table public.semester_results enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_answer_keys enable row level security;
alter table public.assessment_submissions enable row level security;
alter table public.student_progress enable row level security;
alter table public.engagement_events enable row level security;
alter table public.learning_activity enable row level security;
alter table public.recommendations enable row level security;
alter table public.learning_path_nodes enable row level security;
alter table public.tasks enable row level security;
alter table public.planner_sessions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.student_agent_records enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

revoke all on table
  public.departments, public.regulations, public.academic_years, public.branches,
  public.semesters, public.subjects, public.profiles, public.courses, public.enrollments,
  public.course_materials, public.examination_papers, public.official_answer_keys,
  public.verified_subject_marks, public.semester_results, public.assessments,
  public.assessment_questions, public.assessment_answer_keys, public.assessment_submissions,
  public.student_progress, public.engagement_events, public.learning_activity,
  public.recommendations, public.learning_path_nodes, public.tasks, public.planner_sessions,
  public.conversations, public.messages, public.student_agent_records, public.documents,
  public.document_chunks
from anon, authenticated;

grant select on public.departments, public.regulations, public.academic_years,
  public.branches, public.semesters, public.subjects to authenticated;
grant select (legacy_id) on public.departments, public.regulations, public.academic_years,
  public.branches, public.semesters, public.subjects, public.courses, public.enrollments,
  public.course_materials, public.examination_papers, public.official_answer_keys,
  public.verified_subject_marks, public.semester_results, public.assessments,
  public.assessment_questions, public.assessment_submissions, public.student_progress,
  public.engagement_events, public.learning_activity, public.recommendations,
  public.learning_path_nodes, public.tasks, public.planner_sessions, public.conversations,
  public.messages, public.student_agent_records, public.documents, public.document_chunks
  to authenticated;
grant select (
  id, email, full_name, role, avatar_url, department_id, branch_id, regulation_id,
  academic_year_id, current_semester_id, student_id, enrolled_since, metadata,
  created_at, updated_at
) on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant select (id, code, title, description, instructor_id, subject_id, department_id,
  branch_id, regulation_id, academic_year_id, semester_id, credits, topics, status,
  metadata, created_at, updated_at) on public.courses to authenticated;
grant select (id, student_id, course_id, subject_id, academic_year_id, semester_id,
  status, enrolled_at, metadata, created_at, updated_at) on public.enrollments to authenticated;
grant select (id, course_id, subject_id, document_id, owner_id, title, description, material_type,
  file_type, bucket_id, object_path, file_size_bytes, published, publication_status,
  published_at, metadata, created_at, updated_at) on public.course_materials to authenticated;
grant insert (course_id, subject_id, document_id, owner_id, title, description, material_type, file_type,
  bucket_id, object_path, file_size_bytes, published, publication_status, published_at, metadata)
  on public.course_materials to authenticated;
grant update (title, description, material_type, published, publication_status, published_at, metadata)
  on public.course_materials to authenticated;
grant delete on public.course_materials to authenticated;
grant select (id, course_id, subject_id, owner_id, title, examination_type, department_id,
  regulation_id, semester_id, academic_year_id, bucket_id, object_path, file_type,
  file_size_bytes, published, publication_status, published_at, metadata, created_at, updated_at)
  on public.examination_papers to authenticated;
grant select (id, course_id, subject_id, owner_id, examination_paper_id, title, examination_type,
  department_id, regulation_id, semester_id, academic_year_id, bucket_id, object_path,
  release_at, published, publication_status, published_at, metadata, created_at, updated_at)
  on public.official_answer_keys to authenticated;
grant select (id, student_id, course_id, subject_id, academic_year_id, semester_id, marks,
  examination_type, max_marks, grade, verified_by, verified_at, metadata, created_at, updated_at)
  on public.verified_subject_marks to authenticated;
grant select (id, student_id, academic_year_id, semester_id, semester_number, result_status, sgpa, cgpa,
  total_credits, verified_by, verified_at, metadata, created_at, updated_at)
  on public.semester_results to authenticated;
grant select (id, course_id, created_by, title, topic, difficulty, duration_minutes,
  passing_score, status, metadata, created_at, updated_at) on public.assessments to authenticated;
grant select (id, assessment_id, question_key, question_text, options, topic_tag,
  code_snippet, display_order, metadata, created_at) on public.assessment_questions to authenticated;
grant select on public.assessment_answer_keys to authenticated;
grant select (id, assessment_id, course_id, student_id, answers, score, total_questions, percentage,
  passed, time_spent_seconds, result, submitted_at, metadata)
  on public.assessment_submissions to authenticated;
grant select (id, student_id, course_id, topic_id, topic_title, mastery_score, total_attempts,
  is_completed, last_studied_at, metadata, created_at, updated_at),
  insert (student_id, course_id, topic_id, topic_title, mastery_score, total_attempts,
  is_completed, last_studied_at, metadata),
  update (topic_id, topic_title, mastery_score, total_attempts, is_completed, last_studied_at, metadata),
  delete on public.student_progress to authenticated;
grant select (id, student_id, course_id, event_type, duration_minutes, metadata, created_at),
  insert (student_id, course_id, event_type, duration_minutes, metadata)
  on public.engagement_events to authenticated;
grant select (id, student_id, course_id, assessment_id, activity_type, duration_minutes,
  ai_generated, metadata, created_at) on public.learning_activity to authenticated;
grant select (id, student_id, course_id, payload, created_at, updated_at),
  insert (student_id, course_id, payload),
  update (payload, course_id),
  delete on public.recommendations to authenticated;
grant select (id, student_id, course_id, title, sequence_number, status, mastery_score,
  prerequisites, estimated_minutes, related_resources, metadata, created_at, updated_at),
  insert (student_id, course_id, title, sequence_number, status, mastery_score,
  prerequisites, estimated_minutes, related_resources, metadata),
  update (title, sequence_number, status, mastery_score, prerequisites, estimated_minutes,
  related_resources, metadata),
  delete on public.learning_path_nodes to authenticated;
grant select (id, owner_id, course_id, title, task_type, priority, due_at, completed, notes,
  legacy_collection, metadata, created_at, updated_at),
  insert (owner_id, course_id, title, task_type, priority, due_at, completed, notes, metadata),
  update (title, task_type, priority, due_at, completed, notes, metadata),
  delete on public.tasks to authenticated;
grant select (id, owner_id, course_id, title, starts_at, duration_minutes, completed, notes,
  session_type, metadata, created_at, updated_at),
  insert (owner_id, course_id, title, starts_at, duration_minutes, completed, notes, session_type, metadata),
  update (title, starts_at, duration_minutes, completed, notes, session_type, metadata),
  delete on public.planner_sessions to authenticated;
grant select (id, legacy_id, legacy_collection, owner_id, course_id, title, metadata, created_at, updated_at),
  insert (owner_id, course_id, title, metadata),
  update (title, metadata),
  delete on public.conversations to authenticated;
grant select (id, legacy_id, conversation_id, role, content, metadata, created_at)
  on public.messages to authenticated;
grant select (id, legacy_id, owner_id, course_id, record_type, payload, created_at, updated_at),
  insert (legacy_id, owner_id, course_id, record_type, payload),
  update (course_id, payload),
  delete on public.student_agent_records to authenticated;
grant select (id, owner_id, course_id, title, file_type, file_size_bytes, bucket_id, object_path,
  status, visibility, published, metadata, created_at, updated_at),
  insert (owner_id, course_id, title, file_type, file_size_bytes, bucket_id, object_path,
  status, visibility, metadata),
  delete on public.documents to authenticated;
grant select (id, document_id, course_id, chunk_index, page_number, content, metadata, created_at),
  insert (document_id, course_id, generation_id, chunk_index, page_number, content,
  embedding_model, embedding, metadata),
  delete on public.document_chunks to authenticated;

create policy catalog_authenticated_read on public.departments
  for select to authenticated using (true);
create policy regulations_authenticated_read on public.regulations
  for select to authenticated using (true);
create policy academic_years_authenticated_read on public.academic_years
  for select to authenticated using (true);
create policy branches_authenticated_read on public.branches
  for select to authenticated using (true);
create policy semesters_authenticated_read on public.semesters
  for select to authenticated using (true);
create policy subjects_authenticated_read on public.subjects
  for select to authenticated using (true);

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_faculty_roster on public.profiles
  for select to authenticated using (private.faculty_can_access_student(id));
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy courses_authorized_read on public.courses
  for select to authenticated using (private.has_course_access(id) or private.can_manage_course(id));
create policy enrollments_authorized_read on public.enrollments
  for select to authenticated using (
    student_id = (select auth.uid()) or private.can_manage_course(course_id)
  );

create policy course_materials_authorized_read on public.course_materials
  for select to authenticated using (
    private.can_manage_course(course_id)
    or (
      published and publication_status = 'published'
      and private.has_course_access(course_id)
    )
  );
create policy course_materials_faculty_insert on public.course_materials
  for insert to authenticated with check (
    owner_id = (select auth.uid()) and private.can_manage_course(course_id)
  );
create policy course_materials_faculty_update on public.course_materials
  for update to authenticated using (private.can_manage_course(course_id))
  with check (private.can_manage_course(course_id));
create policy course_materials_faculty_delete on public.course_materials
  for delete to authenticated using (private.can_manage_course(course_id));

create policy examination_papers_authorized_read on public.examination_papers
  for select to authenticated using (
    private.can_manage_course(course_id)
    or (subject_id is not null and private.can_manage_subject(subject_id))
    or (
      published and publication_status = 'published'
      and (
        (course_id is not null and private.has_course_access(course_id))
        or (subject_id is not null and private.has_subject_access(subject_id))
      )
    )
  );
create policy official_answer_keys_authorized_read on public.official_answer_keys
  for select to authenticated using (
    private.can_manage_course(course_id)
    or (subject_id is not null and private.can_manage_subject(subject_id))
    or (
      published and publication_status = 'published'
      and release_at is not null and release_at <= now()
      and (
        (course_id is not null and private.has_course_access(course_id))
        or (subject_id is not null and private.has_subject_access(subject_id))
      )
    )
  );

create policy verified_marks_authorized_read on public.verified_subject_marks
  for select to authenticated using (
    (student_id = (select auth.uid()) and verified_by is not null and verified_at is not null)
    or (course_id is not null and private.can_manage_course(course_id))
    or (course_id is null and private.faculty_can_access_student(student_id))
  );
create policy semester_results_authorized_read on public.semester_results
  for select to authenticated using (
    (student_id = (select auth.uid()) and verified_by is not null and verified_at is not null)
    or private.faculty_can_access_student(student_id)
  );

create policy assessments_authorized_read on public.assessments
  for select to authenticated using (
    private.can_manage_course(course_id)
    or (status = 'published' and private.has_course_access(course_id))
  );
create policy assessments_faculty_insert on public.assessments
  for insert to authenticated with check (
    created_by = (select auth.uid()) and private.can_manage_course(course_id)
  );
create policy assessments_faculty_update on public.assessments
  for update to authenticated using (private.can_manage_course(course_id))
  with check (private.can_manage_course(course_id));
create policy assessments_faculty_delete on public.assessments
  for delete to authenticated using (private.can_manage_course(course_id));
create policy assessment_questions_authorized_read on public.assessment_questions
  for select to authenticated using (
    exists (
      select 1 from public.assessments a
      where a.id = assessment_id
        and (
          private.can_manage_course(a.course_id)
          or (a.status = 'published' and private.has_course_access(a.course_id))
        )
    )
  );
create policy assessment_answer_keys_faculty_read on public.assessment_answer_keys
  for select to authenticated using (
    exists (
      select 1
      from public.assessment_questions q
      join public.assessments a on a.id = q.assessment_id
      where q.id = question_id and private.can_manage_course(a.course_id)
    )
  );
create policy assessment_submissions_student_read on public.assessment_submissions
  for select to authenticated using (student_id = (select auth.uid()));
create policy assessment_submissions_faculty_read on public.assessment_submissions
  for select to authenticated using (private.can_manage_course(course_id));

create policy student_progress_owner_access on public.student_progress
  for all to authenticated using (student_id = (select auth.uid()))
  with check (
    student_id = (select auth.uid()) and private.has_course_access(course_id)
  );
create policy student_progress_faculty_read on public.student_progress
  for select to authenticated using (private.can_manage_course(course_id));
create policy engagement_owner_read on public.engagement_events
  for select to authenticated using (student_id = (select auth.uid()));
create policy engagement_owner_insert on public.engagement_events
  for insert to authenticated with check (
    student_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  );
create policy engagement_faculty_read on public.engagement_events
  for select to authenticated using (
    course_id is not null and private.can_manage_course(course_id)
  );
create policy activity_owner_read on public.learning_activity
  for select to authenticated using (student_id = (select auth.uid()));
create policy activity_faculty_read on public.learning_activity
  for select to authenticated using (
    course_id is not null and private.can_manage_course(course_id)
  );
create policy recommendations_owner_access on public.recommendations
  for all to authenticated using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));
create policy learning_path_owner_access on public.learning_path_nodes
  for all to authenticated using (
    student_id = (select auth.uid()) and private.has_course_access(course_id)
  )
  with check (
    student_id = (select auth.uid()) and private.has_course_access(course_id)
  );
create policy tasks_owner_access on public.tasks
  for all to authenticated using (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  );
create policy planner_sessions_owner_access on public.planner_sessions
  for all to authenticated using (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  );
create policy conversations_owner_access on public.conversations
  for all to authenticated using (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  );
create policy messages_owner_read on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.owner_id = (select auth.uid())
    )
  );
create policy messages_owner_user_insert on public.messages
  for insert to authenticated with check (
    role = 'user' and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.owner_id = (select auth.uid())
    )
  );
create policy student_agent_records_owner_access on public.student_agent_records
  for all to authenticated using (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  )
  with check (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
  );
create policy documents_authorized_read on public.documents
  for select to authenticated using (private.can_access_document(id));
create policy documents_owner_insert on public.documents
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and (course_id is null or private.has_course_access(course_id))
    and bucket_id = 'student-documents'
    and object_path like ('users/' || (select auth.uid())::text || '/documents/%')
    and visibility = 'private'
    and not published
  );
create policy documents_owner_delete on public.documents
  for delete to authenticated using (owner_id = (select auth.uid()));
create policy document_chunks_authorized_read on public.document_chunks
  for select to authenticated using (private.can_access_document(document_id));
create policy document_chunks_owner_insert on public.document_chunks
  for insert to authenticated with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.owner_id = (select auth.uid())
        and d.course_id is not distinct from course_id
        and d.status = 'processing'
        and d.processing_generation = generation_id
    )
  );

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.current_app_role() from public, anon;
revoke all on function private.can_manage_course(uuid) from public, anon;
revoke all on function private.has_course_access(uuid) from public, anon;
revoke all on function private.faculty_can_access_student(uuid) from public, anon;
revoke all on function private.has_subject_access(uuid) from public, anon;
revoke all on function private.can_manage_subject(uuid) from public, anon;
revoke all on function private.can_access_document(uuid) from public, anon;
revoke all on function private.course_id_from_storage_path(text) from public, anon, authenticated;
grant execute on function private.current_app_role() to authenticated, service_role;
grant execute on function private.can_manage_course(uuid) to authenticated, service_role;
grant execute on function private.has_course_access(uuid) to authenticated, service_role;
grant execute on function private.faculty_can_access_student(uuid) to authenticated, service_role;
grant execute on function private.has_subject_access(uuid) to authenticated, service_role;
grant execute on function private.can_manage_subject(uuid) to authenticated, service_role;
grant execute on function private.can_access_document(uuid) to authenticated, service_role;
grant execute on function private.course_id_from_storage_path(text) to service_role;
grant execute on function private.set_updated_at() to authenticated, service_role;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.sync_auth_user_email() from public, anon, authenticated;
revoke all on function public.provision_profile(uuid, text, text) from public, anon, authenticated;
revoke all on function public.publish_assessment(uuid, text, text, text, integer, integer, jsonb)
  from public, anon;
revoke all on function public.submit_assessment(uuid, jsonb, integer, uuid) from public, anon;
revoke all on function public.append_conversation_turn(uuid, text, text, jsonb) from public, anon;
revoke all on function public.set_task_completion(uuid, text, boolean) from public, anon;
revoke all on function public.match_document_chunks(extensions.vector, integer, uuid, text)
  from public, anon;
revoke all on function public.begin_document_processing(uuid) from public, anon;
revoke all on function public.complete_document_processing(uuid, text, integer, text) from public, anon;
revoke all on function public.fail_document_processing(uuid, text, text) from public, anon;
grant execute on function public.provision_profile(uuid, text, text) to service_role;
grant execute on function public.publish_assessment(uuid, text, text, text, integer, integer, jsonb)
  to authenticated;
grant execute on function public.submit_assessment(uuid, jsonb, integer, uuid) to authenticated;
grant execute on function public.append_conversation_turn(uuid, text, text, jsonb) to authenticated;
grant execute on function public.set_task_completion(uuid, text, boolean) to authenticated;
grant execute on function public.match_document_chunks(extensions.vector, integer, uuid, text)
  to authenticated;
grant execute on function public.begin_document_processing(uuid) to authenticated;
grant execute on function public.complete_document_processing(uuid, text, integer, text)
  to authenticated;
grant execute on function public.fail_document_processing(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('course-materials', 'course-materials', false, 10485760,
    array['application/pdf', 'text/plain', 'text/markdown']),
  ('student-documents', 'student-documents', false, 10485760,
    array['application/pdf', 'text/plain', 'text/markdown']),
  ('student-submissions', 'student-submissions', false, 10485760,
    array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy student_documents_owner_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'student-documents'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'documents'
  );
create policy student_documents_authorized_read on storage.objects
  for select to authenticated using (
    bucket_id = 'student-documents'
    and exists (
      select 1 from public.documents d
      where d.bucket_id = storage.objects.bucket_id
        and d.object_path = storage.objects.name
      and (
        (
          d.owner_id = (select auth.uid())
          and (storage.foldername(storage.objects.name))[1] = 'users'
          and (storage.foldername(storage.objects.name))[2] = (select auth.uid())::text
          and (storage.foldername(storage.objects.name))[3] = 'documents'
        )
        or (
          d.visibility = 'course'
          and d.published
          and d.course_id is not null
          and private.has_course_access(d.course_id)
          and private.can_access_document(d.id)
        )
      )
    )
  );
create policy student_documents_owner_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'student-documents'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'documents'
  );
create policy course_materials_faculty_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'course-materials'
    and private.can_manage_course(private.course_id_from_storage_path(name))
  );
create policy course_materials_authorized_read on storage.objects
  for select to authenticated using (
    bucket_id = 'course-materials'
    and exists (
      select 1 from public.course_materials m
      where m.bucket_id = storage.objects.bucket_id
        and m.object_path = storage.objects.name
        and (
          private.can_manage_course(m.course_id)
          or (
            m.published and m.publication_status = 'published'
            and private.has_course_access(m.course_id)
          )
        )
    )
  );
create policy course_materials_faculty_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'course-materials'
    and private.can_manage_course(private.course_id_from_storage_path(name))
  );

create policy examination_papers_authorized_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'course-materials'
    and exists (
      select 1 from public.examination_papers p
      where p.bucket_id = storage.objects.bucket_id
        and p.object_path = storage.objects.name
        and (
          private.can_manage_course(p.course_id)
          or (p.subject_id is not null and private.can_manage_subject(p.subject_id))
          or (
            p.published and p.publication_status = 'published'
            and (
              (p.course_id is not null and private.has_course_access(p.course_id))
              or (p.subject_id is not null and private.has_subject_access(p.subject_id))
            )
          )
        )
    )
  );
create policy answer_keys_authorized_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'course-materials'
    and exists (
      select 1 from public.official_answer_keys k
      where k.bucket_id = storage.objects.bucket_id
        and k.object_path = storage.objects.name
        and (
          private.can_manage_course(k.course_id)
          or (k.subject_id is not null and private.can_manage_subject(k.subject_id))
          or (
            k.published and k.publication_status = 'published'
            and k.release_at is not null and k.release_at <= now()
            and (
              (k.course_id is not null and private.has_course_access(k.course_id))
              or (k.subject_id is not null and private.has_subject_access(k.subject_id))
            )
          )
        )
    )
  );
