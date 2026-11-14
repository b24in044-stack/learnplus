begin;

select plan(4);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$update public.assignment_submissions
    set grade = 99
    where student_id = (select auth.uid())$$,
  '42501',
  null,
  'students cannot update grades directly'
);
select throws_ok(
  $$update public.assignment_submissions
    set feedback = 'changed'
    where student_id = (select auth.uid())$$,
  '42501',
  null,
  'students cannot update feedback directly'
);
select throws_ok(
  $$update public.assignment_submissions
    set graded_at = now()
    where student_id = (select auth.uid())$$,
  '42501',
  null,
  'students cannot update grading timestamps directly'
);
select throws_ok(
  $$update public.assignment_submissions
    set status = 'returned'
    where student_id = (select auth.uid())$$,
  '42501',
  null,
  'students cannot update returned status directly'
);
select * from finish();
rollback;
