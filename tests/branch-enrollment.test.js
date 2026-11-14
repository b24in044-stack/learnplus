import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareBranchCourseEnrollments,
  prepareCourseStudentEnrollments,
  saveBranchCourseEnrollments,
} from '../server/branch-enrollment.js';

function createClient({ courses, enrollments = [] }) {
  const state = {
    courses: [...courses],
    enrollments: [...enrollments],
    insertBatches: [],
    filters: [],
  };
  return {
    state,
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        range(start, end) {
          state.filters.push({ table, filters });
          const rows = state[table].filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
        },
        insert(rows) {
          state.insertBatches.push(rows);
          state.enrollments.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
  };
}

test('branch assignment prepares only missing enrollments for courses in the same institution and branch', async () => {
  const client = createClient({
    courses: [
      { id: 'course-a', institution_id: 'institution-a', branch_id: 'branch-a', subject_id: 'subject-a', academic_year_id: null, semester_id: null },
      { id: 'course-b', institution_id: 'institution-a', branch_id: 'branch-a', subject_id: null, academic_year_id: 'year-a', semester_id: 'semester-a' },
      { id: 'other-branch', institution_id: 'institution-a', branch_id: 'branch-b' },
      { id: 'other-institution', institution_id: 'institution-b', branch_id: 'branch-a' },
    ],
    enrollments: [
      { student_id: 'student-a', course_id: 'course-a', status: 'completed' },
      { student_id: 'student-b', course_id: 'course-b', status: 'withdrawn' },
    ],
  });

  const plan = await prepareBranchCourseEnrollments(client, {
    institutionId: 'institution-a',
    branchId: 'branch-a',
    studentIds: ['student-a', 'student-b'],
  });

  assert.equal(plan.courseCount, 2);
  assert.deepEqual(plan.rows, [
    {
      student_id: 'student-a',
      course_id: 'course-b',
      subject_id: null,
      academic_year_id: 'year-a',
      semester_id: 'semester-a',
      status: 'active',
    },
    {
      student_id: 'student-b',
      course_id: 'course-a',
      subject_id: 'subject-a',
      academic_year_id: null,
      semester_id: null,
      status: 'active',
    },
  ]);
});

test('branch enrollment sync is idempotent and preserves existing enrollment statuses', async () => {
  const client = createClient({
    courses: [{ id: 'course-a', institution_id: 'institution-a', branch_id: 'branch-a' }],
    enrollments: [{ student_id: 'student-a', course_id: 'course-a', status: 'withdrawn' }],
  });
  const assignment = {
    institutionId: 'institution-a',
    branchId: 'branch-a',
    studentIds: ['student-a'],
  };

  const firstPlan = await prepareBranchCourseEnrollments(client, assignment);
  assert.equal(await saveBranchCourseEnrollments(client, firstPlan), 0);
  const retryPlan = await prepareBranchCourseEnrollments(client, assignment);
  assert.equal(retryPlan.rows.length, 0);
  assert.equal(client.state.enrollments[0].status, 'withdrawn');
});

test('direct course assignment is scoped and only prepares missing enrollments', async () => {
  const client = createClient({
    courses: [
      { id: 'course-a', institution_id: 'institution-a', subject_id: 'subject-a' },
      { id: 'course-b', institution_id: 'institution-b', subject_id: 'subject-b' },
    ],
    enrollments: [{ student_id: 'student-a', course_id: 'course-a', status: 'completed' }],
  });

  const plan = await prepareCourseStudentEnrollments(client, {
    institutionId: 'institution-a',
    courseId: 'course-a',
    studentIds: ['student-a', 'student-b'],
  });

  assert.equal(plan.courseCount, 1);
  assert.deepEqual(plan.rows, [{
    student_id: 'student-b',
    course_id: 'course-a',
    subject_id: 'subject-a',
    academic_year_id: undefined,
    semester_id: undefined,
    status: 'active',
  }]);
});

test('branch enrollment inserts are batched within the database request limit', async () => {
  const courses = [
    { id: 'course-a', institution_id: 'institution-a', branch_id: 'branch-a' },
    { id: 'course-b', institution_id: 'institution-a', branch_id: 'branch-a' },
  ];
  const students = Array.from({ length: 300 }, (_, index) => `student-${index}`);
  const client = createClient({ courses });
  const plan = await prepareBranchCourseEnrollments(client, {
    institutionId: 'institution-a',
    branchId: 'branch-a',
    studentIds: students,
  });

  assert.equal(await saveBranchCourseEnrollments(client, plan), 600);
  assert.deepEqual(client.state.insertBatches.map((batch) => batch.length), [500, 100]);
});

test('branch enrollment refuses an oversized assignment before returning a partial plan', async () => {
  const courses = Array.from({ length: 6 }, (_, index) => ({
    id: `course-${index}`,
    institution_id: 'institution-a',
    branch_id: 'branch-a',
  }));
  const client = createClient({ courses });

  await assert.rejects(
    prepareBranchCourseEnrollments(client, {
      institutionId: 'institution-a',
      branchId: 'branch-a',
      studentIds: Array.from({ length: 1000 }, (_, index) => `student-${index}`),
    }),
    { status: 413 },
  );
  assert.equal(client.state.insertBatches.length, 0);
});
