import { getRecord, listRecords } from './supabase-repository.js';
import { getOptionalSupabaseRequestClient } from './supabase.js';

const REPOSITORIES = {
  materials: 'educational_materials',
  questionPapers: 'examination_papers',
  answerKeys: 'official_answer_keys',
};

const FILTER_FIELDS = [
  'departmentId',
  'regulationId',
  'semesterId',
  'subjectId',
  'academicYearId',
  'examinationType',
];

const asDate = (value) => value?.toDate ? value.toDate() : value ? new Date(value) : null;

export function normalizeAcademicFilters(query = {}) {
  return Object.fromEntries(FILTER_FIELDS.flatMap((field) => {
    const value = typeof query[field] === 'string' ? query[field].trim() : '';
    return value && value.length <= 128 ? [[field, value]] : [];
  }));
}

export function isVerifiedRecord(record) {
  const verifiedAt = asDate(record.verifiedAt);
  return typeof record.verifiedByUid === 'string' &&
    record.verifiedByUid.length > 0 &&
    verifiedAt instanceof Date &&
    Number.isFinite(verifiedAt.getTime());
}

export function isPublishedRecord(record, kind, now = new Date()) {
  if (record.published !== true || record.publicationStatus !== 'published') return false;
  if (kind !== 'answerKeys') return true;
  const releaseAt = asDate(record.releaseAt);
  return Boolean(releaseAt && releaseAt.getTime() <= now.getTime());
}

export function matchesAcademicFilters(record, filters) {
  return Object.entries(filters).every(([field, value]) => {
    const recordValue = field === 'examinationType'
      ? record.examinationType ?? record.examType
      : record[field];
    return String(recordValue ?? '') === value;
  });
}

export function isAcademicEnrollment(enrollment) {
  return !enrollment.status ||
    ['active', 'enrolled', 'completed'].includes(String(enrollment.status).toLowerCase());
}

async function getStudentEnrollments(studentUid) {
  const rows = await listRecords('enrollments', {
    filters: [['studentUid', '==', studentUid]],
    limit: 1000,
  });
  return rows.filter((row) => row.studentUid === studentUid && isAcademicEnrollment(row));
}

async function getEnrollmentContext(studentUid) {
  const enrollments = await getStudentEnrollments(studentUid);
  const courses = new Map();
  const subjects = new Map();
  for (const enrollment of enrollments) {
    if (typeof enrollment.courseId === 'string' && enrollment.courseId && !courses.has(enrollment.courseId)) {
      const course = await getRecord('courses', enrollment.courseId);
      if (course) courses.set(enrollment.courseId, course);
    }
    const subjectId = enrollment.subjectId ||
      courses.get(enrollment.courseId)?.subjectId;
    if (typeof subjectId === 'string' && !subjects.has(subjectId)) {
      const subject = await getRecord('subjects', subjectId);
      if (subject) subjects.set(subjectId, subject);
    }
  }
  return {
    enrollments,
    courses,
    subjects,
    _courseIds: new Set(courses.keys()),
    _subjectIds: new Set(subjects.keys()),
  };
}

export async function getStudentAcademicContext(studentUid) {
  const profile = await getRecord('users', studentUid) || await getRecord('profiles', studentUid);
  if (!profile) {
    const error = new Error('The student academic profile was not found.');
    error.status = 404;
    throw error;
  }
  const { enrollments, courses, subjects } = await getEnrollmentContext(studentUid);
  const enrollmentRows = enrollments.map((enrollment) => {
    const course = courses.get(enrollment.courseId);
    const subjectId = enrollment.subjectId || course?.subjectId;
    const subject = subjects.get(subjectId);
    return {
      id: enrollment.id,
      studentUid,
      courseId: enrollment.courseId,
      subjectId,
      academicYearId: enrollment.academicYearId || course?.academicYearId || null,
      semesterId: enrollment.semesterId || course?.semesterId || null,
      status: enrollment.status || 'active',
      enrolledAt: enrollment.enrolledAt || null,
      course: course ? {
        id: course.id,
        code: course.code || '',
        title: course.title || '',
      } : null,
      subject: subject ? {
        id: subject.id,
        code: subject.code || '',
        title: subject.title || '',
        semesterNumber: subject.semesterNumber ?? null,
      } : null,
    };
  });
  const academicProfile = Object.fromEntries([
    'departmentId',
    'branchId',
    'regulationId',
    'academicYearId',
    'currentSemesterId',
    'studentId',
  ].flatMap((field) => profile[field] == null ? [] : [[field, profile[field]]]));
  return {
    uid: studentUid,
    ...academicProfile,
    subjects: [...subjects.values()].map(({ id, code, title, semesterNumber, departmentId, regulationId }) => ({
      id,
      code: code || '',
      title: title || '',
      semesterNumber: semesterNumber ?? null,
      departmentId: departmentId || null,
      regulationId: regulationId || null,
    })),
    enrollments: enrollmentRows,
  };
}

export function documentIsEnrolled(record, context) {
  return (typeof record.courseId === 'string' && context._courseIds.has(record.courseId)) ||
    (typeof record.subjectId === 'string' && context._subjectIds.has(record.subjectId));
}

export function canStudentAccessAcademicDocument(record, kind, context, filters = {}, now = new Date()) {
  return isPublishedRecord(record, kind, now) &&
    documentIsEnrolled(record, context) &&
    matchesAcademicFilters(record, filters);
}

export function filterVerifiedStudentRecords(records, studentUid, filters) {
  return records.filter((record) =>
    record.studentUid === studentUid &&
    isVerifiedRecord(record) &&
    matchesAcademicFilters(record, filters));
}

export function publicDocument(record, kind) {
  const provenanceRecord = record.provenance || record.metadata?.provenance;
  const provenance = provenanceRecord && typeof provenanceRecord === 'object'
    ? Object.fromEntries(['sourceName', 'sourceReference', 'publishedAt']
      .flatMap((field) => provenanceRecord[field] == null ? [] : [[field, provenanceRecord[field]]]))
    : null;
  return {
    id: record.id,
    documentId: record.documentId || null,
    title: typeof record.title === 'string' ? record.title : '',
    description: typeof record.description === 'string' ? record.description : '',
    category: ['syllabus', 'pyq', 'ppt', 'course_pdf', 'other'].includes(record.metadata?.category)
      ? record.metadata.category
      : 'other',
    fileType: record.fileType || undefined,
    fileSizeBytes: Number(record.fileSizeBytes || 0),
    uploadedAt: asDate(record.createdAt)?.toISOString() || '',
    uploadedBy: typeof record.metadata?.uploaded_by === 'string' ? record.metadata.uploaded_by : 'Faculty',
    published: record.published === true && record.publicationStatus === 'published',
    semesterId: record.metadata?.semester_id || record.semesterId || undefined,
    courseId: record.courseId || undefined,
    subjectId: record.subjectId || undefined,
    departmentId: record.departmentId || undefined,
    regulationId: record.regulationId || undefined,
    semesterId: record.semesterId || undefined,
    academicYearId: record.academicYearId || undefined,
    examinationType: record.examinationType || record.examType || undefined,
    documentType: kind,
    official: kind === 'answerKeys',
    provenance,
  };
}

export async function listStudentRepository(studentUid, kind, filters = {}) {
  const collection = REPOSITORIES[kind];
  if (!collection) throw new TypeError('Unknown academic document repository.');
  const context = await getEnrollmentContext(studentUid);
  const rows = await listRecords(collection, {
    filters: [['published', '==', true], ['publicationStatus', '==', 'published']],
    limit: 2000,
  });
  const now = new Date();
  const publishedRows = rows
    .filter((record) => canStudentAccessAcademicDocument(record, kind, context, filters, now))
    .sort((left, right) =>
      (asDate(right.publishedAt)?.getTime() || 0) - (asDate(left.publishedAt)?.getTime() || 0));
  return publishedRows.map((record) => ({
    ...publicDocument(record, kind),
    ragReady: kind === 'materials'
      && (record.ragReady === true || record.metadata?.rag_ready === true || record.metadata?.ragReady === true),
  }));
}

export async function getStudentDocumentDownload(studentUid, kind, documentId) {
  const collection = REPOSITORIES[kind];
  if (!collection) {
    const error = new Error('The requested academic document repository is unavailable.');
    error.status = 404;
    throw error;
  }
  const record = await getRecord(collection, documentId);
  const context = await getEnrollmentContext(studentUid);
  if (
    !record ||
    !canStudentAccessAcademicDocument(record, kind, context) ||
    typeof record.storagePath !== 'string' ||
    !record.storagePath.trim()
  ) {
    const error = new Error('The academic document was not found or is not available to this student.');
    error.status = 404;
    throw error;
  }
  const supabaseClient = getOptionalSupabaseRequestClient();
  if (!supabaseClient) {
    const error = new Error('Supabase Storage is not configured for this request.');
    error.status = 503;
    throw error;
  }
  const { data, error } = await supabaseClient.storage
    .from(record.storageBucket || 'course-materials')
    .createSignedUrl(record.storagePath, 300, { download: true });
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Supabase did not return a signed download URL.');
  return { url: data.signedUrl, expiresInSeconds: 300 };
}

export async function listVerifiedStudentMarks(studentUid, filters = {}) {
  const rows = await listRecords('verified_subject_marks', {
    filters: [['studentUid', '==', studentUid]],
    limit: 2000,
  });
  return filterVerifiedStudentRecords(rows, studentUid, filters)
    .map((record) => ({
      id: record.id,
      subjectId: record.subjectId,
      courseId: record.courseId,
      semesterId: record.semesterId,
      academicYearId: record.academicYearId,
      score: record.score,
      maximumScore: record.maximumScore,
      examinationType: record.examinationType,
      verifiedByUid: record.verifiedByUid,
      verifiedAt: record.verifiedAt,
    }));
}

export async function listVerifiedSemesterResults(studentUid, filters = {}) {
  const rows = await listRecords('semester_results', {
    filters: [['studentUid', '==', studentUid]],
    limit: 500,
  });
  return filterVerifiedStudentRecords(rows, studentUid, filters)
    .map((record) => ({
      id: record.id,
      academicYearId: record.academicYearId,
      semesterId: record.semesterId,
      creditsEarned: record.creditsEarned,
      resultStatus: record.resultStatus,
      verifiedByUid: record.verifiedByUid,
      verifiedAt: record.verifiedAt,
    }));
}
