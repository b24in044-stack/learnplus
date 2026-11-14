begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'student-a@example.test', '', now(), '{"provider":"email","providers":["email"]}',
    '{"full_name":"Student A","role":"admin"}', now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'student-b@example.test', '', now(), '{"provider":"email","providers":["email"]}',
    '{"full_name":"Student B"}', now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'faculty@example.test', '', now(), '{"provider":"email","providers":["email"]}',
    '{"full_name":"Faculty"}', now(), now()
  )
on conflict (id) do nothing;

update public.profiles
set role = 'faculty'
where id = '10000000-0000-4000-8000-000000000003';

insert into public.courses (id, legacy_id, code, title, instructor_id)
values (
  '20000000-0000-4000-8000-000000000001',
  'test-course',
  'TEST 101',
  'RLS test course',
  '10000000-0000-4000-8000-000000000003'
),
(
  '20000000-0000-4000-8000-000000000002',
  'test-course-unenrolled',
  'TEST 102',
  'Unenrolled test course',
  '10000000-0000-4000-8000-000000000003'
);

insert into public.enrollments (student_id, course_id, status)
values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'active'
);

insert into public.assessments (id, course_id, created_by, title, status)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'Published test assessment',
    'published'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    'Draft test assessment',
    'draft'
  );

insert into public.assessment_questions (
  id, assessment_id, question_key, question_text, options, display_order
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'published-question',
    'Published question',
    '["A","B"]',
    1
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'draft-question',
    'Draft question',
    '["A","B"]',
    1
  );

insert into public.assessment_answer_keys (question_id, correct_option_index, explanation)
values
  ('40000000-0000-4000-8000-000000000001', 1, 'Private explanation'),
  ('40000000-0000-4000-8000-000000000002', 0, 'Draft explanation');

insert into public.conversations (id, owner_id, course_id, title)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Student A conversation'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'Student B conversation'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (select role from public.profiles where id = (select auth.uid())),
  'student',
  'public Auth metadata cannot assign a privileged profile role'
);
select is(
  (select count(*)::integer from public.conversations),
  1,
  'a student can read their own conversation'
);
select is(
  (select count(*)::integer from public.conversations where id = '50000000-0000-4000-8000-000000000002'),
  0,
  'a student cannot read another student conversation'
);
select is(
  (select count(*)::integer from public.assessments),
  1,
  'a student cannot read draft assessments or assessments for unenrolled courses'
);
select is(
  (select count(*)::integer from public.assessment_questions),
  1,
  'a student can read only published assessment questions in enrolled courses'
);
select is(
  (select count(*)::integer from public.assessment_answer_keys),
  0,
  'a student cannot read assessment answer keys before submission'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '10000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'a student cannot change their own role'
);

select * from finish();
rollback;
