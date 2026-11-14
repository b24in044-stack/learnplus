const QUERY_PAGE_SIZE = 1000;
const FILTER_BATCH_SIZE = 100;
const INSERT_BATCH_SIZE = 500;
const MAX_BRANCH_ENROLLMENTS_PER_ASSIGNMENT = 5000;

async function listAllRows(query) {
  const rows = [];
  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const { data, error } = await query.range(offset, offset + QUERY_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < QUERY_PAGE_SIZE) return rows;
  }
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function prepareBranchCourseEnrollments(client, { institutionId, branchId, studentIds }) {
  if (!studentIds.length) return { rows: [], courseCount: 0 };

  const courses = await listAllRows(client.from('courses')
    .select('id,subject_id,academic_year_id,semester_id')
    .eq('institution_id', institutionId)
    .eq('branch_id', branchId));
  return prepareEnrollmentsForCourses(client, courses, studentIds);
}

export async function prepareCourseStudentEnrollments(client, { institutionId, courseId, studentIds }) {
  if (!studentIds.length) return { rows: [], courseCount: 0 };

  const courses = await listAllRows(client.from('courses')
    .select('id,subject_id,academic_year_id,semester_id')
    .eq('institution_id', institutionId)
    .eq('id', courseId));
  return prepareEnrollmentsForCourses(client, courses, studentIds);
}

async function prepareEnrollmentsForCourses(client, courses, studentIds) {
  if (!courses.length) return { rows: [], courseCount: 0 };

  const requestedEnrollmentCount = courses.length * studentIds.length;
  if (requestedEnrollmentCount > MAX_BRANCH_ENROLLMENTS_PER_ASSIGNMENT) {
    const error = new Error('This assignment includes too many course enrollments. Select fewer students and retry.');
    error.status = 413;
    throw error;
  }

  const existing = new Set();
  for (const studentBatch of chunks(studentIds, FILTER_BATCH_SIZE)) {
    for (const courseBatch of chunks(courses, FILTER_BATCH_SIZE)) {
      const rows = await listAllRows(client.from('enrollments')
        .select('student_id,course_id')
        .in('student_id', studentBatch)
        .in('course_id', courseBatch.map((course) => course.id)));
      for (const row of rows) existing.add(`${row.student_id}:${row.course_id}`);
    }
  }

  const rows = [];
  for (const studentId of studentIds) {
    for (const course of courses) {
      if (existing.has(`${studentId}:${course.id}`)) continue;
      rows.push({
        student_id: studentId,
        course_id: course.id,
        subject_id: course.subject_id,
        academic_year_id: course.academic_year_id,
        semester_id: course.semester_id,
        status: 'active',
      });
    }
  }
  return { rows, courseCount: courses.length };
}

export async function saveBranchCourseEnrollments(client, plan) {
  for (const batch of chunks(plan.rows, INSERT_BATCH_SIZE)) {
    const { error } = await client.from('enrollments').insert(batch);
    if (error) throw error;
  }
  return plan.rows.length;
}
