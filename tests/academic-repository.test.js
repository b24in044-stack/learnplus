import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStudentAccessAcademicDocument,
  documentIsEnrolled,
  filterVerifiedStudentRecords,
  isAcademicEnrollment,
  isPublishedRecord,
  matchesAcademicFilters,
  normalizeAcademicFilters,
  publicDocument,
} from '../server/academic-repository.js';
import {
  buildProgressAnalytics,
  classifySupabaseError,
  handleApiRequest,
} from '../server/api.js';

test('academic filters accept only supported bounded string values', () => {
  assert.deepEqual(normalizeAcademicFilters({
    departmentId: ' cs ',
    semesterId: 'semester-4',
    unexpected: 'ignored',
    regulationId: 'x'.repeat(129),
    subjectId: 12,
  }), {
    departmentId: 'cs',
    semesterId: 'semester-4',
  });
  assert.equal(matchesAcademicFilters({ examType: 'final' }, { examinationType: 'final' }), true);
});

test('student document access is limited to enrolled courses and subjects', () => {
  const context = {
    _courseIds: new Set(['course-1']),
    _subjectIds: new Set(['subject-1']),
  };
  assert.equal(documentIsEnrolled({ courseId: 'course-1' }, context), true);
  assert.equal(documentIsEnrolled({ subjectId: 'subject-1' }, context), true);
  assert.equal(documentIsEnrolled({ courseId: 'course-2', subjectId: 'subject-2' }, context), false);
});

test('academic repositories include current and completed enrollments, not withdrawn records', () => {
  assert.equal(isAcademicEnrollment({ status: 'active' }), true);
  assert.equal(isAcademicEnrollment({ status: 'ENROLLED' }), true);
  assert.equal(isAcademicEnrollment({}), true);
  assert.equal(isAcademicEnrollment({ status: 'completed' }), true);
  assert.equal(isAcademicEnrollment({ status: 'withdrawn' }), false);
});

test('repository and download permission checks share enrollment, filters, and publication rules', () => {
  const context = {
    _courseIds: new Set(['course-1']),
    _subjectIds: new Set(['subject-1']),
  };
  const record = {
    id: 'key-1',
    courseId: 'course-1',
    subjectId: 'subject-1',
    examinationType: 'final',
    published: true,
    publicationStatus: 'published',
    releaseAt: new Date('2026-08-31T23:59:59Z'),
    storagePath: 'private/path.pdf',
    ownerUid: 'faculty-uid',
  };
  const now = new Date('2026-09-01T00:00:00Z');

  assert.equal(canStudentAccessAcademicDocument(record, 'answerKeys', context, { examinationType: 'final' }, now), true);
  assert.equal(canStudentAccessAcademicDocument(record, 'answerKeys', context, { examinationType: 'midterm' }, now), false);
  assert.equal(canStudentAccessAcademicDocument({
    ...record,
    releaseAt: new Date('2026-09-02T00:00:00Z'),
  }, 'answerKeys', context, {}, now), false);
  const visible = publicDocument(record, 'answerKeys');
  assert.equal(visible.official, true);
  assert.equal('storagePath' in visible, false);
  assert.equal('ownerUid' in visible, false);
});

test('answer keys stay hidden until a valid release time', () => {
  const base = { published: true, publicationStatus: 'published' };
  const now = new Date('2026-09-01T00:00:00Z');
  assert.equal(isPublishedRecord(base, 'materials', now), true);
  assert.equal(isPublishedRecord({ ...base, releaseAt: '2026-09-02T00:00:00Z' }, 'answerKeys', now), false);
  assert.equal(isPublishedRecord({ ...base, releaseAt: '2026-08-31T23:59:59Z' }, 'answerKeys', now), true);
  assert.equal(isPublishedRecord({ ...base, releaseAt: 'not-a-date' }, 'answerKeys', now), false);
  assert.equal(isPublishedRecord({ ...base, publicationStatus: 'draft' }, 'materials', now), false);
});

test('marks and results include only verified records owned by the authenticated UID', () => {
  const records = [
    {
      id: 'mine',
      studentUid: 'student-1',
      verifiedByUid: 'registrar-1',
      verifiedAt: new Date('2026-08-01T00:00:00Z'),
      semesterId: 'semester-4',
    },
    {
      id: 'other-student',
      studentUid: 'student-2',
      verifiedByUid: 'registrar-1',
      verifiedAt: new Date('2026-08-01T00:00:00Z'),
      semesterId: 'semester-4',
    },
    {
      id: 'unverified',
      studentUid: 'student-1',
      semesterId: 'semester-4',
    },
  ];
  assert.deepEqual(
    filterVerifiedStudentRecords(records, 'student-1', { semesterId: 'semester-4' }).map((row) => row.id),
    ['mine'],
  );
  assert.deepEqual(
    filterVerifiedStudentRecords(records, 'student-1', { semesterId: 'semester-5' }),
    [],
  );
});

test('student weak topics use low-mastery records with attempts and course context', () => {
  const { conceptMasteryList, weakTopics } = buildProgressAnalytics([
    {
      id: 'weak-topic',
      courseId: 'course-1',
      topicTitle: 'AVL rotations',
      masteryScore: 42,
      totalAttempts: 3,
    },
    {
      id: 'not-attempted',
      courseId: 'course-1',
      topicTitle: 'Graph traversal',
      masteryScore: 30,
      totalAttempts: 0,
    },
    {
      id: 'mastered',
      courseId: 'course-1',
      topicTitle: 'Arrays',
      masteryScore: 55,
      totalAttempts: 4,
      isCompleted: true,
    },
    {
      id: 'invalid-score',
      courseId: 'course-1',
      topicTitle: 'Invalid record',
      masteryScore: 120,
      totalAttempts: 5,
    },
  ], new Map([['course-1', 'CS 201']]));

  assert.equal(conceptMasteryList.length, 3);
  assert.deepEqual(weakTopics, [{
    id: 'weak-topic',
    concept: 'AVL rotations',
    courseId: 'course-1',
    courseCode: 'CS 201',
    performanceScore: 42,
    attempts: 3,
    suggestedAction: 'Review this concept with course materials, then try a focused practice assessment.',
    recommendedPracticeQuestion: 'Explain the key ideas in AVL rotations, then work through a course example.',
  }]);
});

test('Supabase failures map PostgREST errors to safe categories', () => {
  assert.equal(classifySupabaseError({ code: '42501' }).code, 'PERMISSION_DENIED');
  assert.equal(classifySupabaseError({ status: 404 }).code, 'NOT_FOUND');
  assert.equal(classifySupabaseError({ code: '23503' }).code, 'INVALID_ARGUMENT');
  assert.equal(classifySupabaseError({ code: '23505' }).code, 'FAILED_PRECONDITION');
  assert.equal(classifySupabaseError({ status: 503 }).code, 'UNAVAILABLE');
  assert.equal(classifySupabaseError({ status: 504 }).code, 'DEADLINE_EXCEEDED');
  assert.equal(classifySupabaseError({ message: 'unclassified' }).code, 'INTERNAL');
});

test('academic API routes reject non-student roles before reading student records', async () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handleApiRequest({
    isDemoSession: false,
    method: 'GET',
    path: '/academic/materials',
    query: {},
    user: { id: 'faculty-uid', role: 'instructor' },
  }, response, () => assert.fail('The route must not continue for a faculty account.'));

  assert.equal(response.statusCode, 403);
  assert.match(response.body.detail, /permission/);
});

test('administrator cannot create attendance sessions or edit attendance records', async () => {
  const request = (method, path, body = {}) => ({
    isDemoSession: false,
    method,
    path,
    query: {},
    body,
    user: { id: 'admin-uid', role: 'admin' },
  });
  const createResponse = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handleApiRequest(request('POST', '/attendance/sessions'), createResponse, () => assert.fail('Admin attendance creation must be rejected.'));

  const updateResponse = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handleApiRequest(request('PUT', '/attendance/sessions/123e4567-e89b-42d3-a456-426614174000', { records: [] }), updateResponse, () => assert.fail('Admin attendance updates must be rejected.'));

  const readResponse = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handleApiRequest(request('GET', '/attendance/sessions/123e4567-e89b-42d3-a456-426614174000'), readResponse, () => assert.fail('Admin session details must be hidden.'));

  assert.equal(createResponse.statusCode, 403);
  assert.equal(updateResponse.statusCode, 403);
  assert.equal(readResponse.statusCode, 403);
  assert.match(createResponse.body.detail, /Only faculty/);
  assert.match(updateResponse.body.detail, /Only faculty/);
});
