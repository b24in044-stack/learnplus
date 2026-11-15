import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  getStudentAcademicContext,
  getStudentDocumentDownload,
  listStudentRepository,
  listVerifiedSemesterResults,
  listVerifiedStudentMarks,
  normalizeAcademicFilters,
} from './academic-repository.js';
import {
  canAccessCourse,
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  requireCourseAccess,
  updateRecord,
} from './supabase-repository.js';
import {
  getAdminSupabaseClient,
  getOptionalSupabaseRequestClient,
  isSupabaseSchemaUnavailable,
  notifyCourseStudents,
  notifyProjectParticipants,
  notifyUsers,
  writeAuditLog,
} from './supabase.js';

const now = () => new Date();
const asDate = (value) => value?.toDate ? value.toDate() : value ? new Date(value) : null;
const fail = (status, detail) => Object.assign(new Error(detail), { status });
const userFilter = (userId) => [['ownerUid', '==', userId]];
const courseMaterialCategories = new Set(['syllabus', 'pyq', 'ppt', 'course_pdf', 'other']);
const isValidTextFile = (buffer) => {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
};
const courseMaterialMimeTypes = {
  pdf: { mimeType: 'application/pdf', fileType: 'pdf', valid: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
  txt: { mimeType: 'text/plain', fileType: 'text', valid: isValidTextFile },
  md: { mimeType: 'text/markdown', fileType: 'markdown', valid: isValidTextFile },
};
const dateValue = (record, field) => asDate(record[field])?.getTime() || 0;
const sortByDate = (records, field, direction = 'asc') => records.sort((left, right) =>
  (dateValue(left, field) - dateValue(right, field)) * (direction === 'desc' ? -1 : 1));
const supabaseApiClient = () => {
  const client = getOptionalSupabaseRequestClient();
  if (!client) throw fail(503, 'A Supabase request client is required.');
  return client;
};
const requireUuid = (value, label) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw fail(400, `${label} must be a valid identifier.`);
  }
  return value;
};
const requireText = (value, label, max = 5000) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw fail(400, `${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
};
const optionalText = (value, label, max) => {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > max) {
    throw fail(400, `${label} must be at most ${max} characters.`);
  }
  return value.trim();
};
async function fetchAttendanceRows(queryFactory, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
}
const attendanceStatuses = new Set(['present', 'absent', 'late', 'excused']);
const attendanceUploadMaxRows = 500;

function parseAttendanceCsv(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    throw fail(400, 'The CSV file must contain valid UTF-8 text.');
  }
  if (!text.trim()) throw fail(400, 'The attendance file is empty.');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === '' && !closedQuote) {
      quoted = true;
    } else if (character === ',' || character === '\t') {
      row.push(field);
      field = '';
      closedQuote = false;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
      closedQuote = false;
    } else if (closedQuote && !/\s/.test(character)) {
      throw fail(400, 'The CSV contains unexpected characters after a quoted value.');
    } else {
      field += character;
    }
  }
  if (quoted) throw fail(400, 'The CSV contains an unterminated quoted value.');
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function attendanceHeaderIndex(header, aliases) {
  return header.findIndex((value) => aliases.includes(String(value).trim().toLowerCase().replace(/[\s_-]+/g, ' ')));
}

export async function parseAttendanceUpload(file, roster) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw fail(400, 'Choose a non-empty CSV or XLSX attendance file.');
  }
  const extension = file.originalname?.split('.').pop()?.toLowerCase();
  let rows;
  if (extension === 'csv' && ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.mimetype)) {
    rows = parseAttendanceCsv(file.buffer);
  } else if (extension === 'xlsx'
    && ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(file.mimetype)
    && file.buffer.subarray(0, 2).toString('ascii') === 'PK') {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw fail(400, 'The XLSX workbook does not contain a worksheet.');
      rows = [];
      worksheet.eachRow({ includeEmpty: false }, (excelRow) => {
        rows.push(excelRow.values.slice(1).map((value) => (
          value && typeof value === 'object'
            ? (typeof value.text === 'string' ? value.text : value.result ?? '')
            : value == null ? '' : String(value)
        )));
      });
    } catch (error) {
      if (Number.isInteger(error?.status)) throw error;
      throw fail(400, 'The XLSX file could not be read. Use a valid .xlsx workbook.');
    }
  } else {
    throw fail(415, 'Only CSV and XLSX attendance files are supported; legacy XLS is not supported.');
  }
  if (!rows.length) throw fail(400, 'The attendance file is empty.');
  if (rows.length - 1 > attendanceUploadMaxRows) {
    throw fail(413, `Attendance files may contain at most ${attendanceUploadMaxRows} student rows.`);
  }

  const header = rows[0].map((value) => String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' '));
  const studentIndex = attendanceHeaderIndex(header, ['student id', 'studentid', 'email']);
  const statusIndex = attendanceHeaderIndex(header, ['attendance status', 'status']);
  if (studentIndex < 0 || statusIndex < 0 || studentIndex === statusIndex) {
    throw fail(400, 'The file must include Student ID and Attendance Status columns.');
  }
  const uploadRows = rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    studentIdentifier: String(values[studentIndex] ?? '').trim(),
    requestedStatus: String(values[statusIndex] ?? '').trim(),
  }));
  return previewAttendanceRows(uploadRows, roster);
}

function previewAttendanceRows(uploadRows, roster) {
  const byIdentifier = new Map();
  for (const student of roster) {
    const identifiersForStudent = new Set();
    for (const identifier of [student.student_id, student.studentCode, student.email]) {
      if (typeof identifier !== 'string' || !identifier.trim()) continue;
      const key = identifier.trim().toLowerCase();
      if (identifiersForStudent.has(key)) continue;
      identifiersForStudent.add(key);
      const matches = byIdentifier.get(key) || [];
      matches.push(student);
      byIdentifier.set(key, matches);
    }

  }

  const rows = uploadRows.map((uploadRow) => {
    const matches = byIdentifier.get(uploadRow.studentIdentifier.toLowerCase()) || [];
    const student = matches.length === 1 ? matches[0] : null;
    const status = uploadRow.requestedStatus.toLowerCase();
    const issues = [];
    if (!uploadRow.studentIdentifier) issues.push('Student ID is required.');
    else if (!matches.length) issues.push('Student ID is unknown or not enrolled in this course.');
    else if (matches.length > 1) issues.push('Student ID matches more than one enrolled student.');
    if (!attendanceStatuses.has(status)) issues.push('Status must be Present, Absent, Late, or Excused.');
    return {
      rowNumber: uploadRow.rowNumber,
      studentId: student?.student_id || null,
      studentCode: student?.studentCode || null,
      studentName: student?.studentName || student?.email || 'Unknown student',
      email: student?.email || '',
      status,
      issues,
    };
  });

  const rowsByStudent = new Map();
  for (const row of rows) {
    if (!row.studentId) continue;
    const duplicates = rowsByStudent.get(row.studentId) || [];
    duplicates.push(row);
    rowsByStudent.set(row.studentId, duplicates);
  }
  for (const duplicates of rowsByStudent.values()) {
    if (duplicates.length > 1) {
      duplicates.forEach((row) => row.issues.push('Duplicate student ID appears more than once.'));
    }
  }

  const includedStudents = new Set(rows.filter((row) => row.studentId).map((row) => row.studentId));
  for (const student of roster) {
    if (!includedStudents.has(student.student_id)) {
      rows.push({
        rowNumber: null,
        studentId: student.student_id,
        studentCode: student.studentCode || null,
        studentName: student.studentName || student.email || 'Student',
        email: student.email || '',
        status: '',
        issues: ['Student is missing from the attendance file.'],
      });
    }
  }

  return {
    totalRows: uploadRows.length,
    validCount: rows.filter((row) => row.issues.length === 0).length,
    invalidCount: rows.filter((row) => row.issues.length > 0).length,
    duplicateCount: rows.filter((row) => row.issues.some((issue) => issue.startsWith('Duplicate'))).length,
    unknownCount: rows.filter((row) => row.issues.some((issue) => issue.startsWith('Student ID is unknown'))).length,
    rows,
    validRecords: rows.filter((row) => row.issues.length === 0).map((row) => ({
      studentId: row.studentId,
      status: row.status,
    })),
  };
}

export function validateAttendanceRecords(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 500) {
    throw fail(400, 'Attendance records are required and may not exceed 500 students.');
  }
  const seen = new Set();
  return records.map((record) => {
    const studentId = requireUuid(record?.studentId, 'Student ID');
    if (seen.has(studentId)) throw fail(400, 'Duplicate students are not allowed.');
    seen.add(studentId);
    if (!attendanceStatuses.has(record?.status)) throw fail(400, 'Each attendance status must be valid.');
    return { studentId, status: record.status };
  });
}

function attendanceCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isMissingAttendanceProfileColumn(error) {
  return error?.code === '42703'
    || error?.code === 'PGRST204'
    || (typeof error?.message === 'string' && /column .* does not exist/i.test(error.message));
}

export async function loadAttendanceRosterFromDatabase(adminClient, courseId, courseInstitutionId) {
  const { data: enrollments, error: enrollmentError } = await adminClient.from('enrollments')
    .select('student_id,status')
    .eq('course_id', courseId);
  if (enrollmentError) throw enrollmentError;

  const studentIds = [...new Set((enrollments || [])
    .filter((enrollment) => ['active', 'enrolled'].includes(String(enrollment.status || '').toLowerCase()))
    .map((enrollment) => enrollment.student_id)
    .filter((studentId) => typeof studentId === 'string' && studentId))];
  if (!studentIds.length) return [];

  let response = await adminClient.from('profiles')
    .select('id,email,role,institution_id,full_name,student_id')
    .in('id', studentIds);
  if (response.error && isMissingAttendanceProfileColumn(response.error)) {
    response = await adminClient.from('profiles')
      .select('id,email,role,institution_id')
      .in('id', studentIds);
  }
  if (response.error) throw response.error;

  const profilesById = new Map((response.data || [])
    .filter((profile) => profile.role === 'student'
      && (!courseInstitutionId || profile.institution_id === courseInstitutionId))
    .map((profile) => [profile.id, profile]));
  return studentIds.flatMap((studentId) => {
    const profile = profilesById.get(studentId);
    if (!profile) return [];
    return [{
      student_id: studentId,
      studentCode: typeof profile.student_id === 'string' && profile.student_id.trim()
        ? profile.student_id.trim()
        : studentId,
      studentName: typeof profile.full_name === 'string' && profile.full_name.trim()
        ? profile.full_name.trim()
        : (typeof profile.email === 'string' ? profile.email : 'Student'),
      email: typeof profile.email === 'string' ? profile.email : '',
    }];
  });
}

async function loadAttendanceRoster(user, courseId) {
  await requireAcademicCourseAccess(user, courseId);
  const adminClient = getAdminSupabaseClient();
  const { data: course, error: courseError } = await adminClient.from('courses')
    .select('institution_id').eq('id', courseId).maybeSingle();
  if (courseError) throw courseError;
  if (!course) throw fail(404, 'Course not found or unavailable to this account.');
  return loadAttendanceRosterFromDatabase(adminClient, courseId, course.institution_id);
}

async function loadAttendanceSessionRecords(sessionId) {
  const adminClient = getAdminSupabaseClient();
  let response = await adminClient.from('attendance_records')
    .select('id,student_id,status,marked_by,marked_at,profiles!inner(id,email,full_name,student_id)')
    .eq('session_id', sessionId)
    .order('student_id');
  if (response.error && isMissingAttendanceProfileColumn(response.error)) {
    response = await adminClient.from('attendance_records')
      .select('id,student_id,status,marked_by,marked_at,profiles!inner(id,email)')
      .eq('session_id', sessionId)
      .order('student_id');
  }
  if (response.error) throw response.error;
  return (response.data || []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      student_id: row.student_id,
      status: row.status,
      marked_by: row.marked_by,
      marked_at: row.marked_at,
      studentCode: typeof profile?.student_id === 'string' ? profile.student_id.trim() : '',
      studentName: typeof profile?.full_name === 'string' ? profile.full_name.trim() : '',
      email: typeof profile?.email === 'string' ? profile.email : '',
    };
  });
}

function validAttendanceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function attendanceTemplate(roster, format) {
  if (format === 'csv') {
    const lines = [
      ['Student ID', 'Attendance Status'].map(attendanceCsvCell).join(','),
      ...roster.map((student) => [
        student.studentCode || student.student_id,
        '',
      ].map(attendanceCsvCell).join(',')),
    ];
    return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
  }
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Attendance');
  worksheet.columns = [
    { header: 'Student ID', key: 'studentId', width: 24 },
    { header: 'Attendance Status', key: 'status', width: 24 },
  ];
  roster.forEach((student) => worksheet.addRow({
    studentId: student.studentCode || student.student_id,
    status: '',
  }));
  worksheet.getColumn(1).numFmt = '@';
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    worksheet.getCell(rowNumber, 2).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"present,absent,late,excused"'],
    };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function validateCourseMaterialCategory(category) {
  if (typeof category !== 'string' || !courseMaterialCategories.has(category)) {
    throw fail(400, 'Select a valid course material category.');
  }
  return category;
}

export function createCourseMaterialObjectPath(courseId, userId) {
  return `courses/${courseId}/materials/${userId}/${randomUUID()}/original`;
}

export function validateCourseMaterialFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw fail(400, 'Select a course material file.');
  const extension = file.originalname?.split('.').pop()?.toLowerCase();
  const fileType = courseMaterialMimeTypes[extension];
  if (!fileType || file.mimetype !== fileType.mimeType || !fileType.valid(file.buffer)) {
    throw fail(415, 'Allowed files are valid PDF, TXT, or Markdown documents.');
  }
  if (!file.buffer.length || file.buffer.length > 10 * 1024 * 1024) {
    throw fail(413, 'Course materials must be between 1 byte and 10 MB.');
  }
  return { extension, ...fileType };
}

function publicCourseMaterial(record, courseCode = '', document = null) {
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const category = courseMaterialCategories.has(metadata.category) ? metadata.category : 'other';
  const fileTypes = { pdf: 'pdf', txt: 'text', md: 'markdown', text: 'text', markdown: 'markdown' };
  return {
    id: record.id,
    documentId: record.documentId || null,
    courseId: record.courseId,
    courseCode,
    title: record.title || '',
    description: record.description || '',
    category,
    fileType: fileTypes[record.fileType] || 'pdf',
    fileSizeBytes: Number(record.fileSizeBytes || 0),
    uploadedAt: asDate(record.createdAt)?.toISOString() || '',
    uploadedBy: typeof metadata.uploaded_by === 'string' && metadata.uploaded_by.trim()
      ? metadata.uploaded_by
      : 'Faculty',
    semesterId: metadata.semester_id || undefined,
    published: record.published === true && record.publicationStatus === 'published',
    ragReady: document?.status === 'ready'
      || record.ragReady === true
      || metadata.rag_ready === true
      || metadata.ragReady === true,
    documentStatus: document?.status
      ? String(document.status).toUpperCase()
      : record.documentId ? 'UPLOADED' : undefined,
  };
}

async function uploadCourseMaterial(user, courseId, file, body = {}) {
  if (user.role !== 'instructor') throw fail(403, 'Only faculty can upload course materials.');
  await requireCourseAccess(user, courseId);
  const course = await getRecord('courses', courseId);
  if (!course) throw fail(404, 'Course not found or unavailable to this account.');
  const title = requireText(body.title, 'Document title', 200);
  const category = validateCourseMaterialCategory(body.category);
  const description = optionalText(body.description, 'Description', 2000);
  const type = validateCourseMaterialFile(file);
  const client = supabaseApiClient();
  const bucket = 'course-materials';
  const objectPath = createCourseMaterialObjectPath(courseId, user.id);
  const documentId = randomUUID();
  const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: type.mimeType,
    upsert: false,
  });
  if (uploadError) {
    const httpStatus = Number(uploadError.status ?? uploadError.statusCode);
    console.error(JSON.stringify({
      event: 'course_material_upload_failed',
      stage: 'storage_upload',
      error_code: /^[A-Za-z0-9._/-]{1,80}$/.test(String(uploadError.code || ''))
        ? String(uploadError.code)
        : 'unknown',
      http_status: Number.isInteger(httpStatus) ? httpStatus : null,
    }));
    throw uploadError;
  }

  let stage = 'document_metadata_insert';
  try {
    const metadata = {
      category,
      uploaded_by: user.name?.trim() || 'Faculty',
      ...(course.semesterId ? { semester_id: course.semesterId } : {}),
    };
    const { error: documentError } = await getAdminSupabaseClient().from('documents').insert({
      id: documentId,
      owner_id: user.id,
      course_id: courseId,
      title,
      file_type: type.fileType,
      file_size_bytes: file.buffer.length,
      bucket_id: bucket,
      object_path: objectPath,
      status: 'uploaded',
      visibility: 'course',
      published: true,
      metadata: { category },
    });
    if (documentError) throw documentError;
    stage = 'material_metadata_insert';
    const { data, error } = await client.from('course_materials').insert({
      course_id: courseId,
      subject_id: course.subjectId || null,
      document_id: documentId,
      owner_id: user.id,
      title,
      description,
      material_type: 'material',
      file_type: type.extension,
      bucket_id: bucket,
      object_path: objectPath,
      file_size_bytes: file.buffer.length,
      published: true,
      publication_status: 'published',
      published_at: now().toISOString(),
      metadata,
    }).select('id,course_id,document_id,title,description,file_type,file_size_bytes,published,publication_status,metadata,created_at').single();
    if (error) throw error;
    return publicCourseMaterial({
      id: data.id,
      documentId: data.document_id,
      courseId: data.course_id,
      title: data.title,
      description: data.description,
      fileType: data.file_type === 'txt' ? 'text' : data.file_type === 'md' ? 'markdown' : data.file_type,
      fileSizeBytes: data.file_size_bytes,
      published: data.published,
      publicationStatus: data.publication_status,
      metadata: data.metadata,
      createdAt: data.created_at,
      documentStatus: 'uploaded',
    }, course.code || '');
  } catch (error) {
    console.error(JSON.stringify({
      event: 'course_material_upload_failed',
      stage,
      error_code: /^[A-Za-z0-9._/-]{1,80}$/.test(String(error?.code || ''))
        ? String(error.code)
        : 'unknown',
      http_status: Number.isInteger(error?.statusCode ?? error?.status)
        ? error.statusCode ?? error.status
        : null,
    }));
    const { error: documentCleanupError } = await getAdminSupabaseClient()
      .from('documents').delete().eq('id', documentId);
    if (documentCleanupError) {
      console.error('Course material document cleanup failed:', documentCleanupError.code || 'database_error');
    }
    const { error: cleanupError } = await client.storage.from(bucket).remove([objectPath]);
    if (cleanupError) {
      console.error('Course material upload cleanup failed:', cleanupError.code || 'storage_error');
    }
    throw error;
  }
}

async function getOwnedCourseMaterial(user, materialId) {
  if (user.role !== 'instructor') throw fail(403, 'Only faculty can manage course materials.');
  const material = await getRecord('educational_materials', materialId);
  if (!material || material.ownerUid !== user.id) {
    throw fail(404, 'Course material not found or unavailable to this account.');
  }
  await requireCourseAccess(user, material.courseId);
  return material;
}
async function requireAcademicCourseAccess(user, courseId) {
  if (user.role !== 'admin') {
    await requireCourseAccess(user, courseId);
    return;
  }
  if (!user.institutionId) throw fail(403, 'Assign this administrator to an institution first.');
  const { data, error } = await getAdminSupabaseClient()
    .from('courses').select('id,institution_id').eq('id', courseId).maybeSingle();
  if (error) throw error;
  if (!data || data.institution_id !== user.institutionId) {
    throw fail(404, 'Course not found or unavailable to this account.');
  }
}

function apiFailureContext(req) {
  const { method, path } = req;
  if (path === '/me/courses') {
    return { operation: 'list_student_courses', collections: ['enrollments', 'courses', 'student_progress'] };
  }
  if (path === '/me/progress') {
    return {
      operation: 'load_student_progress',
      collections: ['assessment_submissions', 'enrollments', 'student_progress', 'engagement_events', 'learning_activity', 'courses', 'assessments'],
    };
  }
  if (path === '/me/recommendations') {
    return { operation: 'list_student_recommendations', collections: ['recommendations'] };
  }
  if (/^\/faculty\/courses\/[^/]+\/roster$/.test(path)) {
    return {
      operation: 'load_faculty_course_roster',
      collections: ['courses', 'enrollments', 'assessments', 'assessment_submissions', 'student_progress', 'engagement_events', 'learning_activity', 'users', 'profiles'],
    };
  }
  if (/^\/courses\/[^/]+\/documents$/.test(path) || path === '/documents') {
    return { operation: method === 'POST' ? 'upload_course_document' : 'list_course_documents', collections: ['courses', 'documents'] };
  }
  if (/^\/courses\/[^/]+\/materials$/.test(path) || /^\/course-materials(?:\/|$)/.test(path)) {
    return { operation: 'manage_course_materials', collections: ['courses', 'course_materials', 'enrollments'] };
  }
  if (/^\/documents\/[^/]+$/.test(path)) {
    return { operation: 'delete_course_document', collections: ['documents', 'document_chunks'] };
  }
  if (/\/assessments(?:\/|$)/.test(path)) {
    return { operation: 'manage_course_assessment', collections: ['courses', 'assessments', 'assessment_submissions', 'learning_activity'] };
  }
  if (/^\/courses\/[^/]+\/learning-path$/.test(path) || path === '/learning-path') {
    return { operation: 'load_student_learning_path', collections: ['enrollments', 'learning_path_nodes'] };
  }
  if (/^\/chat\//.test(path)) {
    return { operation: 'load_student_conversations', collections: ['student_agent', 'conversations'] };
  }
  if (/^\/(me\/tasks|planner\/)/.test(path)) {
    return { operation: 'manage_student_planner', collections: ['tasks', 'study_tasks', 'planner_sessions', 'learning_activity'] };
  }
  return { operation: 'supabase_api_operation', collections: ['multiple'] };
}

export function classifySupabaseError(error) {
  const rawCode = String(error?.code || '').toUpperCase();
  const status = Number(error?.status);
  if (isSupabaseSchemaUnavailable(error)) {
    return {
      code: 'FEATURE_UNAVAILABLE',
      status: 503,
      message: 'This feature is unavailable until its Supabase migration is applied.',
    };
  }
  if (rawCode === '42501' || status === 401 || status === 403) {
    return { code: 'PERMISSION_DENIED', status: 403, message: 'Supabase denied the requested operation.' };
  }
  if (rawCode === 'P0002' || rawCode === 'PGRST116' || status === 404) {
    return { code: 'NOT_FOUND', status: 404, message: 'The requested Supabase record was not found.' };
  }
  if (['22023', '22P02', '23502', '23503'].includes(rawCode) || status === 400) {
    return { code: 'INVALID_ARGUMENT', status: 400, message: 'Supabase rejected the operation arguments.' };
  }
  if (rawCode === '23505' || status === 409) {
    return { code: 'FAILED_PRECONDITION', status: 409, message: 'The Supabase operation conflicts with existing data.' };
  }
  if (rawCode === '57014' || status === 504) {
    return { code: 'DEADLINE_EXCEEDED', status: 504, message: 'The Supabase operation timed out.' };
  }
  if (/^(08|53)/.test(rawCode) || status === 503 || status >= 500) {
    return { code: 'UNAVAILABLE', status: 503, message: 'Supabase is temporarily unavailable.' };
  }
  return { code: 'INTERNAL', status: 500, message: 'Supabase could not complete the operation.' };
}

export function buildProgressAnalytics(records, courseCodes) {
  const conceptMasteryList = [];
  const weakTopics = [];

  for (const record of records) {
    const courseId = typeof record.courseId === 'string' ? record.courseId : '';
    const concept = typeof record.topicTitle === 'string' ? record.topicTitle.trim() : '';
    const mastery = Number(record.masteryScore);
    if (!courseId || !concept || !Number.isFinite(mastery) || mastery < 0 || mastery > 100) continue;

    const attempts = Number.isInteger(record.totalAttempts) && record.totalAttempts >= 0
      ? record.totalAttempts
      : 0;
    const courseCode = courseCodes.get(courseId) || '';
    const status = record.isCompleted ? 'Mastered' : mastery >= 70 ? 'Developing' : 'Needs Practice';
    conceptMasteryList.push({
      concept,
      courseCode,
      mastery,
      totalAttempts: attempts,
      status,
    });

    if (!record.isCompleted && mastery < 70 && attempts > 0) {
      weakTopics.push({
        id: record.id,
        concept,
        courseId,
        courseCode,
        performanceScore: mastery,
        attempts,
        suggestedAction: 'Review this concept with course materials, then try a focused practice assessment.',
        recommendedPracticeQuestion: `Explain the key ideas in ${concept}, then work through a course example.`,
      });
    }
  }

  weakTopics.sort((left, right) =>
    left.performanceScore - right.performanceScore || right.attempts - left.attempts);
  return { conceptMasteryList, weakTopics };
}

export function publicAssessmentQuestionResult(question, selectedOption) {
  return {
    questionId: question.id,
    questionText: question.questionText,
    selectedOption: selectedOption ?? -1,
  };
}

export function publicAssessmentQuestion(question, role) {
  return {
    id: question.id,
    questionText: question.questionText || '',
    codeSnippet: question.codeSnippet || undefined,
    options: Array.isArray(question.options) ? question.options : [],
    ...(role === 'instructor'
      ? {
        correctOptionIndex: question.correctOptionIndex,
        explanation: question.explanation || '',
      }
      : {}),
    topicTag: question.topicTag || '',
  };
}

async function getAttendanceSession(user, sessionId) {
  const { data, error } = await supabaseApiClient()
    .from('attendance_sessions')
    .select('id,course_id,faculty_id,session_date,title,starts_at,ends_at,created_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw fail(404, 'Attendance session not found.');
  await requireAcademicCourseAccess(user, data.course_id);
  return data;
}

async function getProjectForUser(user, projectId) {
  const { data, error } = await supabaseApiClient()
    .from('projects')
    .select('id,institution_id,course_id,category_id,title,abstract,description,status,guide_id,created_by,created_at,updated_at,project_members(student_id)')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !user.institutionId || data.institution_id !== user.institutionId) {
    throw fail(404, 'Project not found or unavailable to this account.');
  }
  const isMember = (data.project_members || []).some((member) => member.student_id === user.id);
  if (user.role !== 'admin' && data.created_by !== user.id && data.guide_id !== user.id && !isMember) {
    throw fail(403, 'You are not a member of this project.');
  }
  return data;
}

const projectDocumentTypes = new Set(['progress', 'final_report', 'supporting']);
const projectDocumentMimeTypes = {
  pdf: { mimeType: 'application/pdf', valid: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
  txt: { mimeType: 'text/plain', valid: (buffer) => !buffer.includes(0) },
  md: { mimeType: 'text/markdown', valid: (buffer) => !buffer.includes(0) },
};

async function uploadProjectDocument(user, project, file, documentType, milestoneId) {
  if (!file) throw fail(400, 'A project document is required.');
  if (!projectDocumentTypes.has(documentType)) throw fail(400, 'A valid project document type is required.');
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  const type = projectDocumentMimeTypes[extension];
  if (!type || !type.valid(file.buffer)) throw fail(415, 'Allowed project files are valid PDF, TXT, or MD documents.');
  if (!file.buffer.length || file.buffer.length > 10 * 1024 * 1024) throw fail(413, 'Project documents must be between 1 byte and 10 MB.');
  if (milestoneId) {
    const { data: milestone, error } = await supabaseApiClient().from('project_milestones')
      .select('id,project_id').eq('id', milestoneId).eq('project_id', project.id).maybeSingle();
    if (error) throw error;
    if (!milestone) throw fail(404, 'Milestone not found for this project.');
  }
  const storagePath = `projects/${project.id}/${user.id}/${randomUUID()}/original`;
  const bucket = 'project-documents';
  const client = supabaseApiClient();
  const { error: uploadError } = await client.storage.from(bucket).upload(storagePath, file.buffer, {
    contentType: type.mimeType,
    upsert: false,
  });
  if (uploadError) throw uploadError;
  try {
    const { data, error } = await getAdminSupabaseClient().from('project_documents').insert({
      project_id: project.id,
      uploaded_by: user.id,
      milestone_id: milestoneId || null,
      document_type: documentType,
      file_name: file.originalname.slice(0, 255),
      mime_type: type.mimeType,
      size_bytes: file.buffer.length,
      storage_bucket: bucket,
      storage_path: storagePath,
    }).select('id,project_id,milestone_id,document_type,file_name,mime_type,size_bytes,created_at').single();
    if (error) throw error;
    return data;
  } catch (error) {
    const { error: cleanupError } = await client.storage.from(bucket).remove([storagePath]);
    if (cleanupError) console.error('Project document cleanup failed:', cleanupError.code || 'storage_error');
    throw error;
  }
}

export function gradeAssessmentQuestions(questions, answers) {
  let correctCount = 0;
  const results = questions.map((question) => {
    const selectedOption = answers[question.id];
    if (
      selectedOption !== undefined
      && (
        !Array.isArray(question.options)
        || !Number.isInteger(selectedOption)
        || selectedOption < 0
        || selectedOption >= question.options.length
      )
    ) {
      throw fail(400, 'One or more selected answers are invalid.');
    }
    if (selectedOption !== undefined && selectedOption === question.correctOptionIndex) {
      correctCount += 1;
    }
    return publicAssessmentQuestionResult(question, selectedOption);
  });
  return { correctCount, results };
}

async function getStudentProfile(userId) {
  const client = getOptionalSupabaseRequestClient();
  if (!client || typeof userId !== 'string' || !userId) return null;
  const { data, error } = await client
    .from('profiles')
    .select('id,email,role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    role: data.role === 'faculty' ? 'instructor' : data.role,
    fullName: '',
  };
}

export async function getFacultyRosterProfile(studentId, institutionId, client = getAdminSupabaseClient()) {
  if (typeof studentId !== 'string' || !studentId || typeof institutionId !== 'string' || !institutionId) {
    return null;
  }
  const { data, error } = await client
    .from('profiles')
    .select('id,email,role,institution_id')
    .eq('id', studentId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.role !== 'student' || data.institution_id !== institutionId) return null;
  return {
    id: data.id,
    email: data.email,
    role: 'student',
    fullName: '',
  };
}

async function getStudentConversation(userId, conversationId) {
  const data = await getRecord(`student_agent/${userId}/conversations`, conversationId)
    || await getRecord('conversations', conversationId);
  if (!data) throw fail(404, 'Conversation not found.');
  if (data.ownerUid !== userId) throw fail(403, 'You do not have permission to view this conversation.');
  return { data };
}

function mapDocument(document, courseCode = '') {
  const status = ['uploaded', 'processing', 'ready', 'failed'].includes(document.status)
    ? document.status.toUpperCase()
    : 'FAILED';
  return {
    id: document.id,
    courseId: document.courseId,
    courseCode,
    title: document.title,
    fileType: document.fileType,
    fileSize: `${(Number(document.fileSizeBytes || 0) / (1024 * 1024)).toFixed(1)} MB`,
    status,
    uploadedAt: asDate(document.createdAt)?.toISOString() || '',
    chunksCount: Number(document.metadata?.chunks_count || 0),
    vectorStatus: status === 'READY'
      ? `Processed with ${document.metadata?.embedding_model || 'the configured embedding model'}.`
      : status === 'FAILED'
        ? 'Document processing failed; retry processing or upload a supported file.'
        : status === 'PROCESSING'
          ? 'Document processing is in progress.'
          : 'Document is uploaded and has not been processed.',
  };
}

async function listStudentTasks(userId) {
  const [sharedTasks, legacyTasks] = await Promise.all([
    listRecords('tasks', { filters: userFilter(userId), limit: 500 }),
    listRecords('study_tasks', { filters: userFilter(userId), limit: 500 }),
  ]);
  const tasks = [
    ...sharedTasks,
    ...legacyTasks.map((task) => ({ ...task, id: `legacy_${task.id}` })),
  ];
  const mapped = await Promise.all(tasks.map(async (task) => {
    const legacy = task.id.startsWith('legacy_');
    const course = task.courseId ? await getRecord('courses', task.courseId) : null;
    const due = asDate(task.dueAt);
    return {
      id: task.id,
      courseId: task.courseId,
      courseCode: course?.code || '',
      title: task.title,
      dueDate: due?.toISOString().slice(0, 10) || '',
      dueTime: due?.toISOString().slice(11, 16) || '',
      type: task.taskType || task.type || 'review',
      priority: task.priority || 'medium',
      completed: Boolean(task.completed),
    };
  }));
  return mapped.sort((left, right) =>
    (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31') ||
    left.id.localeCompare(right.id));
}

async function listStudentPlannerSessions(userId) {
  const sessions = await listRecords('planner_sessions', {
    filters: userFilter(userId),
    limit: 500,
  });
  return sortByDate(sessions, 'startsAt');
}

async function getCourse(user, courseId) {
  await requireAcademicCourseAccess(user, courseId);
  const course = await getRecord('courses', courseId);
  if (!course) throw fail(404, 'Course not found.');
  return course;
}

async function listAssessments(user, { courseId, assessmentId } = {}) {
  const filters = [['status', '==', 'published']];
  if (courseId) {
    await requireAcademicCourseAccess(user, courseId);
  }
  const rows = await listRecords('assessments', {
    filters,
    limit: 1000,
  });
  const selected = sortByDate(rows.filter((item) =>
    (!assessmentId || item.id === assessmentId) && (!courseId || item.courseId === courseId)),
  'createdAt', 'desc').slice(0, 200);
  const submissions = user.role === 'student'
    ? await listRecords('assessment_submissions', {
      filters: [['studentUid', '==', user.id]],
      limit: 1000,
    })
    : [];
  const output = [];
  for (const row of selected) {
    if (!await canAccessCourse(user, row.courseId)) continue;
    const course = await getRecord('courses', row.courseId);
    const attempts = submissions.filter((submission) => submission.assessmentId === row.id);
    const questionRows = Array.isArray(row.questions) ? row.questions : [];
    output.push({
      id: row.id,
      courseId: row.courseId,
      courseCode: course?.code || '',
      title: row.title,
      topic: row.topic || '',
      difficulty: row.difficulty || 'Intermediate',
      questionCount: questionRows.length,
      durationMinutes: Number(row.durationMinutes || 0),
      passingScore: Number(row.passingScore || 70),
      attemptsCount: attempts.length,
      bestScore: attempts.length
        ? Math.max(...attempts.map((item) => Number(item.percentage || 0)))
        : undefined,
      questions: questionRows.map((question) => publicAssessmentQuestion(question, user.role)),
    });
  }
  return output;
}

async function listDocuments(user, courseId) {
  const filters = userFilter(user.id);
  if (courseId) {
    await requireAcademicCourseAccess(user, courseId);
  }
  const documents = await listRecords('documents', {
    filters,
    limit: 500,
  });
  const result = [];
  for (const document of sortByDate(
    documents.filter((item) => !courseId || item.courseId === courseId),
    'createdAt',
    'desc',
  ).slice(0, 200)) {
    const course = document.courseId ? await getRecord('courses', document.courseId) : null;
    result.push(mapDocument(document, course?.code || ''));
  }
  return result;
}

async function removeDocument(user, documentId) {
  const document = await getRecord('documents', documentId);
  if (!document) throw fail(404, 'Document not found.');
  if (document.ownerUid !== user.id) throw fail(403, 'You do not have permission to delete this document.');

  const supabaseClient = getOptionalSupabaseRequestClient();
  if (!supabaseClient) throw fail(503, 'Supabase Storage is not configured for this request.');
  const { error: storageError } = await supabaseClient.storage
    .from(document.storageBucket || 'student-documents')
    .remove([document.storagePath]);
  if (storageError) throw storageError;
  await deleteRecord('documents', documentId);
}

async function uploadDocument(user, courseId, file) {
  await requireCourseAccess(user, courseId);
  if (!file) throw fail(400, 'A file upload is required.');
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  const types = {
    pdf: { fileType: 'pdf', contentType: 'application/pdf', valid: file.buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
    txt: { fileType: 'text', contentType: 'text/plain', valid: !file.buffer.includes(0) },
    md: { fileType: 'markdown', contentType: 'text/markdown', valid: !file.buffer.includes(0) },
  };
  const type = types[extension];
  if (!type) throw fail(415, 'Unsupported file type. Allowed: PDF, TXT, MD.');
  if (!file.buffer.length || file.buffer.length > 10 * 1024 * 1024) {
    throw fail(413, 'Uploaded files must be between 1 byte and 10 MB.');
  }
  if (!type.valid) throw fail(415, 'The uploaded file content does not match its file type.');

  const id = randomUUID();
  const storagePath = `users/${user.id}/documents/${id}/original`;
  const course = await getRecord('courses', courseId);
  const supabaseClient = getOptionalSupabaseRequestClient();
  if (!supabaseClient) throw fail(503, 'Supabase Storage is not configured for this request.');
  const bucket = 'student-documents';
  const { error: uploadError } = await supabaseClient.storage.from(bucket).upload(storagePath, file.buffer, {
    contentType: type.contentType,
    upsert: false,
  });
  if (uploadError) throw uploadError;
  try {
    const created = await createRecord('documents', {
      ownerUid: user.id,
      courseId,
      title: file.originalname.slice(0, 255),
      fileType: type.fileType,
      fileSizeBytes: file.size,
      storageBucket: bucket,
      storagePath,
      status: 'uploaded',
      metadata: {},
      createdAt: now(),
      updatedAt: now(),
    }, id);
    return mapDocument(created, course?.code || '');
  } catch (error) {
    try {
      const { error: cleanupError } = await supabaseClient.storage.from(bucket).remove([storagePath]);
      if (cleanupError) throw cleanupError;
    } catch (cleanupError) {
      console.error('Document storage cleanup failed after metadata error:', cleanupError?.code || 'storage_error');
    }
    throw error;
  }
}

async function submitAssessment(user, assessmentId, req) {
  const assessment = await getRecord('assessments', assessmentId);
  if (!assessment || assessment.status !== 'published') throw fail(404, 'Assessment not found.');
  await requireCourseAccess(user, assessment.courseId);
  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw fail(400, 'Assessment answers must be an object.');
  }
  const questions = Array.isArray(assessment.questions) ? assessment.questions : [];
  if (!questions.length) throw fail(409, 'This assessment has no questions and cannot be submitted.');
  gradeAssessmentQuestions(questions, answers);
  const idempotencyKey = req.get('Idempotency-Key')?.match(/^[0-9a-f-]{36}$/i)
    ? req.get('Idempotency-Key')
    : randomUUID();
  const supabaseClient = getOptionalSupabaseRequestClient();
  if (!supabaseClient) throw fail(503, 'Supabase is not configured for this request.');
  const { data, error } = await supabaseClient.rpc('submit_assessment', {
    target_assessment_id: assessment.id,
    submitted_answers: answers,
    submitted_time_spent_seconds: Number.isInteger(req.body?.timeSpentSeconds)
      ? req.body.timeSpentSeconds
      : 0,
    request_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') {
    throw new Error('Supabase returned an invalid assessment result.');
  }
  return data;
}

export async function handleApiRequest(req, res, next) {
  if (req.isDemoSession) return next();
  const { method, path } = req;
  const user = req.user;
  let match;
  const studentOnly = /^\/(me\/(academic-profile|subjects|enrollments|marks|semester-results|progress|recommendations|tasks)|academic\/|learning-path|courses\/[^/]+\/learning-path|planner\/|chat\/|assessments(?:\/|$)|courses\/[^/]+\/assessments(?:\/|$)|lab\/)/;
  const assessmentRead = method === 'GET'
    && (/^\/assessments(?:\/[^/]+)?$/.test(path) || /^\/courses\/[^/]+\/assessments$/.test(path));
  const facultyOnly = /^\/faculty\//;
  const assessmentCreate = method === 'POST' && /^\/courses\/[^/]+\/assessments$/.test(path);
  const assessmentGenerate = method === 'POST' && /^\/courses\/[^/]+\/assessments\/generate$/.test(path);
  try {
    if (studentOnly.test(path) && !assessmentRead && !assessmentCreate && !assessmentGenerate
      && !(user.role === 'instructor' && /^\/chat\//.test(path))
      && user.role !== 'student') {
      throw fail(403, 'You do not have permission to access this resource.');
    }
    if (method === 'GET' && path === '/attendance') {
      const client = supabaseApiClient();
      if (user.role === 'student') {
        const records = await fetchAttendanceRows(() => client.from('attendance_records')
          .select('id,status,marked_at,attendance_sessions!inner(id,course_id,session_date,title)')
          .eq('student_id', user.id).order('marked_at', { ascending: false }).order('id'));
        return res.json(records);
      }
      if (user.role !== 'instructor') throw fail(403, 'Administrators can view attendance through class reports only.');
      const sessions = await fetchAttendanceRows(() => client.from('attendance_sessions')
        .select('id,course_id,faculty_id,session_date,title,created_at')
        .eq('faculty_id', user.id)
        .order('session_date', { ascending: false }).order('id'));
      return res.json(sessions);
    }
    if (method === 'GET' && path === '/attendance/branches') {
      if (user.role !== 'admin') throw fail(403, 'Only institution administrators can view attendance branches.');
      if (!user.institutionId) throw fail(403, 'Assign this administrator to an institution first.');
      const client = supabaseApiClient();
      const { data: departments, error: departmentsError } = await client.from('departments')
        .select('id,code').eq('institution_id', user.institutionId).order('code');
      if (departmentsError) throw departmentsError;
      const departmentIds = (departments || []).map((department) => department.id);
      if (!departmentIds.length) return res.json([]);
      const { data: branches, error: branchesError } = await client.from('branches')
        .select('id,department_id,code,name').in('department_id', departmentIds).order('code');
      if (branchesError) throw branchesError;
      const departmentCodeById = new Map((departments || []).map((department) => [department.id, department.code]));
      return res.json((branches || []).map((branch) => ({
        id: branch.id,
        code: branch.code,
        name: branch.name,
        departmentCode: departmentCodeById.get(branch.department_id) || '',
      })));
    }
    if (method === 'GET' && path === '/attendance/report') {
      if (user.role !== 'admin') throw fail(403, 'Only institution administrators can view attendance reports.');
      if (!user.institutionId) throw fail(403, 'Assign this administrator to an institution first.');
      const branchId = req.query.branchId ? requireUuid(req.query.branchId, 'Branch ID') : null;
      const semesterId = req.query.semesterId ? requireUuid(req.query.semesterId, 'Semester ID') : null;
      const courseIdFilter = req.query.courseId ? requireUuid(req.query.courseId, 'Course ID') : null;
      if ((req.query.from && !validAttendanceDate(String(req.query.from)))
        || (req.query.to && !validAttendanceDate(String(req.query.to)))) {
        throw fail(400, 'Attendance report dates must be valid calendar dates.');
      }
      if (req.query.from && req.query.to && String(req.query.from) > String(req.query.to)) {
        throw fail(400, 'The report start date must not be after its end date.');
      }
      const coursesForInstitution = await fetchAttendanceRows(() => supabaseApiClient()
        .from('courses').select('id,branch_id,semester_id').eq('institution_id', user.institutionId).order('id'));
      const courseIds = coursesForInstitution
        .filter((course) => !branchId || course.branch_id === branchId)
        .filter((course) => !semesterId || course.semester_id === semesterId)
        .filter((course) => !courseIdFilter || course.id === courseIdFilter)
        .map((course) => course.id);
      if (!courseIds.length) return res.json([]);
      const sessions = [];
      for (let index = 0; index < courseIds.length; index += 100) {
        const courseChunk = courseIds.slice(index, index + 100);
        const currentSessions = await fetchAttendanceRows(() => {
          let query = supabaseApiClient().from('attendance_sessions')
            .select('id,course_id,session_date').in('course_id', courseChunk).order('id');
          if (req.query.from) query = query.gte('session_date', String(req.query.from));
          if (req.query.to) query = query.lte('session_date', String(req.query.to));
          return query;
        });
        sessions.push(...currentSessions);
      }
      const sessionIds = sessions.map((session) => session.id);
      if (!sessionIds.length) return res.json([]);
      const records = [];
      for (let index = 0; index < sessionIds.length; index += 100) {
        const sessionChunk = sessionIds.slice(index, index + 100);
        records.push(...await fetchAttendanceRows(() => supabaseApiClient()
          .from('attendance_records').select('student_id,status,session_id').in('session_id', sessionChunk).order('id')));
      }
      const courseBranchMap = new Map((coursesForInstitution || []).map((course) => [course.id, {
        branchId: course.branch_id,
        semesterId: course.semester_id || null,
      }]));
      const sessionMap = new Map(sessions.map((session) => [session.id, session]));
      const report = new Map();
      for (const record of records) {
        const session = sessionMap.get(record.session_id);
        const courseId = session?.course_id;
        const courseContext = courseBranchMap.get(courseId);
        if (!courseId || !courseContext?.branchId) continue;
        const key = `${courseId}:${record.student_id}:${session.session_date}`;
        const item = report.get(key) || {
          courseId,
          branchId: courseContext.branchId,
          semesterId: courseContext.semesterId,
          date: session.session_date,
          studentId: record.student_id,
          total: 0,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
        };
        item.total += 1;
        item[record.status] += 1;
        report.set(key, item);
      }
      return res.json([...report.values()].map((item) => ({
        ...item,
        percentage: item.total ? Math.round(((item.present + item.late + item.excused) / item.total) * 100) : 0,
      })));
    }
    if (method === 'GET' && path === '/attendance/activity') {
      if (user.role !== 'admin') throw fail(403, 'Only institution administrators can view attendance activity.');
      if (!user.institutionId) throw fail(403, 'Assign this administrator to an institution first.');
      const branchId = req.query.branchId ? requireUuid(req.query.branchId, 'Branch ID') : null;
      const semesterId = req.query.semesterId ? requireUuid(req.query.semesterId, 'Semester ID') : null;
      const courseIdFilter = req.query.courseId ? requireUuid(req.query.courseId, 'Course ID') : null;
      if ((req.query.from && !validAttendanceDate(String(req.query.from)))
        || (req.query.to && !validAttendanceDate(String(req.query.to)))) {
        throw fail(400, 'Attendance activity dates must be valid calendar dates.');
      }
      if (req.query.from && req.query.to && String(req.query.from) > String(req.query.to)) {
        throw fail(400, 'The activity start date must not be after its end date.');
      }
      const courses = await fetchAttendanceRows(() => supabaseApiClient()
        .from('courses').select('id,branch_id,semester_id').eq('institution_id', user.institutionId).order('id'));
      const courseMap = new Map(courses
        .filter((course) => (!branchId || course.branch_id === branchId)
          && (!semesterId || course.semester_id === semesterId)
          && (!courseIdFilter || course.id === courseIdFilter))
        .map((course) => [course.id, course]));
      const courseIds = [...courseMap.keys()];
      const sessions = [];
      for (let index = 0; index < courseIds.length; index += 100) {
        const courseChunk = courseIds.slice(index, index + 100);
        sessions.push(...await fetchAttendanceRows(() => {
          let query = supabaseApiClient().from('attendance_sessions')
            .select('id,course_id,faculty_id,session_date,created_at').in('course_id', courseChunk).order('id');
          if (req.query.from) query = query.gte('session_date', String(req.query.from));
          if (req.query.to) query = query.lte('session_date', String(req.query.to));
          return query;
        }));
      }
      const activity = new Map();
      for (const session of sessions) {
        const course = courseMap.get(session.course_id);
        if (!course) continue;
        const key = `${session.course_id}:${session.faculty_id}`;
        const entry = activity.get(key) || {
          courseId: session.course_id,
          branchId: course.branch_id,
          semesterId: course.semester_id || null,
          facultyId: session.faculty_id,
          sessions: 0,
          latestSessionDate: session.session_date,
          latestCreatedAt: session.created_at,
        };
        entry.sessions += 1;
        if (String(session.created_at) > String(entry.latestCreatedAt)) {
          entry.latestSessionDate = session.session_date;
          entry.latestCreatedAt = session.created_at;
        }
        activity.set(key, entry);
      }
      return res.json([...activity.values()]);
    }
    if (method === 'GET' && path === '/attendance/summary') {
      if (user.role !== 'student') throw fail(403, 'Attendance summaries are available to students only.');
      const client = supabaseApiClient();
      const courseId = req.query.courseId ? requireUuid(req.query.courseId, 'Course ID') : null;
      if ((req.query.from && !validAttendanceDate(String(req.query.from)))
        || (req.query.to && !validAttendanceDate(String(req.query.to)))) {
        throw fail(400, 'Attendance summary dates must be valid calendar dates.');
      }
      if (req.query.from && req.query.to && String(req.query.from) > String(req.query.to)) {
        throw fail(400, 'The summary start date must not be after its end date.');
      }
      const sessions = await fetchAttendanceRows(() => {
        let query = client.from('attendance_sessions').select('id,course_id,session_date').order('id');
        if (courseId) query = query.eq('course_id', courseId);
        if (req.query.from) query = query.gte('session_date', String(req.query.from));
        if (req.query.to) query = query.lte('session_date', String(req.query.to));
        return query;
      });
      const sessionIds = sessions.map((session) => session.id);
      if (!sessionIds.length) return res.json([]);
      const data = [];
      for (let index = 0; index < sessionIds.length; index += 100) {
        const sessionChunk = sessionIds.slice(index, index + 100);
        data.push(...await fetchAttendanceRows(() => client.from('attendance_records')
          .select('student_id,status,session_id').in('session_id', sessionChunk).order('id')));
      }
      const sessionById = new Map(sessions.map((session) => [session.id, session]));
      const summary = new Map();
      for (const record of data) {
        const session = sessionById.get(record.session_id);
        const courseId = session?.course_id;
        if (!courseId) continue;
        const item = summary.get(courseId) || { courseId, total: 0, present: 0, absent: 0, late: 0, excused: 0 };
        item.total += 1;
        item[record.status] = (item[record.status] || 0) + 1;
        summary.set(courseId, item);
      }
      return res.json([...summary.values()].map((item) => ({
        ...item,
        percentage: item.total ? Math.round(((item.present + item.late + item.excused) / item.total) * 100) : 0,
      })));
    }
    match = path.match(/^\/attendance\/courses\/([^/]+)\/roster$/);
    if (method === 'GET' && match) {
      if (user.role !== 'instructor') throw fail(403, 'Only faculty can view an attendance roster.');
      const courseId = requireUuid(decodeURIComponent(match[1]), 'Course ID');
      return res.json(await loadAttendanceRoster(user, courseId));
    }
    match = path.match(/^\/attendance\/courses\/([^/]+)\/template$/);
    if (method === 'GET' && match) {
      if (user.role !== 'instructor') throw fail(403, 'Only faculty can download attendance templates.');
      const courseId = requireUuid(decodeURIComponent(match[1]), 'Course ID');
      const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
      const roster = await loadAttendanceRoster(user, courseId);
      const buffer = await attendanceTemplate(roster, format);
      res.set('Content-Type', format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="attendance-template.${format}"`);
      return res.send(buffer);
    }
    if (method === 'POST' && path === '/attendance/upload/preview') {
      if (user.role !== 'instructor') throw fail(403, 'Only faculty can preview attendance uploads.');
      const courseId = requireUuid(req.body?.courseId, 'Course ID');
      if (!req.file || !Buffer.isBuffer(req.file.buffer)) throw fail(400, 'Select a CSV or XLSX attendance file.');
      const roster = await loadAttendanceRoster(user, courseId);
      const preview = await parseAttendanceUpload(req.file, roster);
      return res.json(preview);
    }
    if (method === 'POST' && path === '/attendance/sessions') {
      if (user.role !== 'instructor') throw fail(403, 'Only faculty can create attendance sessions.');
      const courseId = requireUuid(req.body?.courseId, 'Course ID');
      await requireAcademicCourseAccess(user, courseId);
      const sessionDate = typeof req.body?.sessionDate === 'string' ? req.body.sessionDate : '';
      if (!validAttendanceDate(sessionDate)) throw fail(400, 'A valid session date is required.');
      const title = requireText(req.body?.title || 'Lecture', 'Session title', 200);
      const records = req.body?.records;
      if (!Array.isArray(records) || records.length === 0 || records.length > 500) {
        throw fail(400, 'Attendance records are required to create a session.');
      }
      const rpcRecords = validateAttendanceRecords(records);
      const { data, error } = await supabaseApiClient().rpc('save_attendance_session', {
        target_course_id: courseId,
        target_session_date: sessionDate,
        target_title: title,
        target_records: rpcRecords,
        target_session_id: null,
        target_correction_reason: null,
      });
      if (error?.code === '23505') {
        throw fail(409, 'An attendance session already exists for this course, date, and period. Open it from session history to review or correct it.');
      }
      if (error) throw error;
      return res.status(201).json(data);
    }
    match = path.match(/^\/attendance\/sessions\/([^/]+)$/);
    if (method === 'GET' && match) {
      if (user.role !== 'instructor') throw fail(403, 'Administrators can view attendance through class reports only.');
      const session = await getAttendanceSession(user, requireUuid(decodeURIComponent(match[1]), 'Session ID'));
      if (session.faculty_id !== user.id) throw fail(403, 'Only the assigned faculty member can view this session.');
      const records = await loadAttendanceSessionRecords(session.id);
      const { data: corrections, error: correctionsError } = await supabaseApiClient()
        .from('attendance_corrections')
        .select('id,student_id,previous_status,new_status,reason,changed_by,created_at')
        .eq('session_id', session.id).order('created_at', { ascending: false });
      if (correctionsError) throw correctionsError;
      return res.json({ session, records, corrections: corrections || [] });
    }
    if (method === 'PUT' && match) {
      if (user.role !== 'instructor') throw fail(403, 'Only faculty can save attendance.');
      const session = await getAttendanceSession(user, requireUuid(decodeURIComponent(match[1]), 'Session ID'));
      if (session.faculty_id !== user.id) throw fail(403, 'Only the assigned faculty member can edit this session.');
      if (!Array.isArray(req.body?.records) || req.body.records.length > 500) throw fail(400, 'Attendance records are required.');
      const rpcRecords = validateAttendanceRecords(req.body.records);
      const { data, error } = await supabaseApiClient().rpc('save_attendance_session', {
        target_course_id: session.course_id,
        target_session_date: session.session_date,
        target_title: session.title,
        target_records: rpcRecords,
        target_session_id: session.id,
        target_correction_reason: req.body?.correctionReason
          ? requireText(req.body.correctionReason, 'Correction reason', 500)
          : null,
      });
      if (error) throw error;
      return res.json(data || []);
    }
    if (method === 'GET' && path === '/projects') {
      const { data, error } = await supabaseApiClient()
        .from('projects').select('id,institution_id,course_id,category_id,title,abstract,description,status,guide_id,created_by,created_at,updated_at,project_members(student_id)')
        .order('updated_at', { ascending: false }).limit(200);
      if (error) throw error;
      return res.json(data || []);
    }
    match = path.match(/^\/projects\/([^/]+)\/members$/);
    if (match && method === 'GET') {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      const { data, error } = await supabaseApiClient()
        .from('project_members')
        .select('project_id,student_id,joined_at,profiles!inner(id,email,role)')
        .eq('project_id', project.id)
        .order('joined_at');
      if (error) throw error;
      return res.json(data || []);
    }
    if (match && method === 'POST') {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      if (user.role !== 'student' || project.created_by !== user.id) {
        throw fail(403, 'Only the project owner can add team members.');
      }
      const studentId = requireUuid(req.body?.studentId, 'Student ID');
      const { data: profile, error: profileError } = await supabaseApiClient()
        .from('profiles').select('id,role,institution_id').eq('id', studentId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile || profile.role !== 'student' || profile.institution_id !== user.institutionId) {
        throw fail(400, 'The selected student is not eligible for this project.');
      }
      const { data, error } = await supabaseApiClient()
        .from('project_members')
        .insert({ project_id: project.id, student_id: studentId })
        .select('project_id,student_id,joined_at')
        .single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (match && method === 'DELETE') {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      if (user.role !== 'student' || project.created_by !== user.id) {
        throw fail(403, 'Only the project owner can remove team members.');
      }
      const studentId = requireUuid(req.body?.studentId, 'Student ID');
      if (studentId === project.created_by) throw fail(400, 'The project owner cannot be removed.');
      const { error } = await supabaseApiClient()
        .from('project_members').delete().eq('project_id', project.id).eq('student_id', studentId);
      if (error) throw error;
      return res.json({ success: true });
    }
    match = path.match(/^\/projects\/([^/]+)\/documents$/);
    if (match && method === 'POST') {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      const document = await uploadProjectDocument(
        user,
        project,
        req.file,
        typeof req.body?.documentType === 'string' ? req.body.documentType : '',
        req.body?.milestoneId ? requireUuid(req.body.milestoneId, 'Milestone ID') : null,
      );
      return res.status(201).json(document);
    }
    if (match && method === 'GET') {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      const { data, error } = await supabaseApiClient().from('project_documents')
        .select('id,project_id,milestone_id,document_type,file_name,mime_type,size_bytes,created_at')
        .eq('project_id', project.id).order('created_at', { ascending: false });
      if (error) throw error;
      return res.json(data || []);
    }
    match = path.match(/^\/project-documents\/([^/]+)\/download$/);
    if (match && method === 'GET') {
      const documentId = requireUuid(decodeURIComponent(match[1]), 'Document ID');
      const { data: document, error } = await supabaseApiClient().from('project_documents')
        .select('id,project_id,storage_bucket,storage_path,file_name').eq('id', documentId).maybeSingle();
      if (error) throw error;
      if (!document) throw fail(404, 'Project document not found.');
      await getProjectForUser(user, document.project_id);
      const { data, error: signedUrlError } = await supabaseApiClient().storage
        .from(document.storage_bucket).createSignedUrl(document.storage_path, 300, { download: document.file_name });
      if (signedUrlError) throw signedUrlError;
      return res.json({ url: data.signedUrl, expiresIn: 300 });
    }
    match = path.match(/^\/project-documents\/([^/]+)$/);
    if (match && method === 'DELETE') {
      const documentId = requireUuid(decodeURIComponent(match[1]), 'Document ID');
      const { data: document, error } = await supabaseApiClient().from('project_documents')
        .select('id,project_id,storage_bucket,storage_path,uploaded_by').eq('id', documentId).maybeSingle();
      if (error) throw error;
      if (!document) throw fail(404, 'Project document not found.');
      await getProjectForUser(user, document.project_id);
      if (user.role === 'student' && document.uploaded_by !== user.id) throw fail(403, 'Only the uploader can delete this document.');
      const { error: storageError } = await getAdminSupabaseClient().storage.from(document.storage_bucket).remove([document.storage_path]);
      if (storageError) throw storageError;
      const { error: deleteError } = await getAdminSupabaseClient().from('project_documents').delete().eq('id', document.id);
      if (deleteError) throw deleteError;
      return res.json({ success: true });
    }
    if (method === 'POST' && path === '/projects') {
      if (user.role !== 'student') throw fail(403, 'Only students can register projects.');
      if (!user.institutionId) throw fail(403, 'Assign your account to an institution first.');
      const title = requireText(req.body?.title, 'Project title', 200);
      const { data, error } = await supabaseApiClient().from('projects').insert({
        institution_id: user.institutionId,
        course_id: req.body?.courseId ? requireUuid(req.body.courseId, 'Course ID') : null,
        title,
        abstract: typeof req.body?.abstract === 'string' ? req.body.abstract.trim().slice(0, 10000) : '',
        description: typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 30000) : '',
        created_by: user.id,
      }).select().single();
      if (error) throw error;
      const { error: memberError } = await supabaseApiClient().from('project_members').insert({ project_id: data.id, student_id: user.id });
      if (memberError) throw memberError;
      return res.status(201).json(data);
    }
    match = path.match(/^\/projects\/([^/]+)$/);
    if (match && method === 'GET') {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      const client = supabaseApiClient();
      const [{ data: milestones, error: milestoneError }, { data: updates, error: updateError }, { data: feedback, error: feedbackError }] = await Promise.all([
        client.from('project_milestones').select('*').eq('project_id', project.id).order('due_at'),
        client.from('project_updates').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
        client.from('project_feedback').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      ]);
      if (milestoneError) throw milestoneError;
      if (updateError) throw updateError;
      if (feedbackError) throw feedbackError;
      return res.json({ ...project, milestones: milestones || [], updates: updates || [], feedback: feedback || [] });
    }
    match = path.match(/^\/projects\/([^/]+)\/milestones$/);
    if (match && method === 'POST') {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      if (user.role !== 'instructor' && user.role !== 'admin' && project.created_by !== user.id) {
        throw fail(403, 'Only project owners, faculty, or administrators can create milestones.');
      }
      const { data, error } = await supabaseApiClient().from('project_milestones').insert({
        project_id: project.id,
        title: requireText(req.body?.title, 'Milestone title', 200),
        description: typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 10000) : '',
        due_at: req.body?.dueAt || null,
        created_by: user.id,
      }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    match = path.match(/^\/project-milestones\/([^/]+)$/);
    if (match && method === 'PATCH') {
      const milestoneId = requireUuid(decodeURIComponent(match[1]), 'Milestone ID');
      const { data: existing, error: existingError } = await supabaseApiClient()
        .from('project_milestones').select('id,project_id,status').eq('id', milestoneId).maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw fail(404, 'Milestone not found.');
      const project = await getProjectForUser(user, existing.project_id);
      if (user.role === 'student' && project.created_by !== user.id) throw fail(403, 'Only the project owner may update this milestone.');
      if (user.role !== 'student' && user.role !== 'instructor' && user.role !== 'admin') throw fail(403, 'You cannot update this milestone.');
      const allowedStatuses = new Set(['pending', 'submitted', 'approved', 'revision_requested']);
      const updates = {};
      if (typeof req.body?.title === 'string') updates.title = requireText(req.body.title, 'Milestone title', 200);
      if (typeof req.body?.description === 'string') updates.description = req.body.description.trim().slice(0, 10000);
      if (typeof req.body?.dueAt === 'string' || req.body?.dueAt === null) updates.due_at = req.body.dueAt;
      if (typeof req.body?.status === 'string') {
        if (!allowedStatuses.has(req.body.status)) throw fail(400, 'Invalid milestone status.');
        if (user.role === 'student' && !['submitted', 'pending'].includes(req.body.status)) {
          throw fail(403, 'Students may only submit or reopen their milestone.');
        }
        updates.status = req.body.status;
      }
      const { data, error } = await supabaseApiClient().from('project_milestones')
        .update(updates).eq('id', milestoneId).select().single();
      if (error) throw error;
      if (updates.status || updates.description) {
        await getAdminSupabaseClient().from('project_milestone_history').insert({
          milestone_id: milestoneId,
          actor_id: user.id,
          status: data.status,
          description: data.description || '',
        });
        await notifyProjectParticipants({
          projectId: project.id,
          institutionId: project.institution_id,
          type: 'feedback',
          title: 'Project milestone updated',
          body: `${data.title} is now ${data.status}.`,
          entityType: 'project_milestone',
          entityId: milestoneId,
          excludeUserId: user.id,
        });
      }
      return res.json(data);
    }
    match = path.match(/^\/project-milestones\/([^/]+)\/history$/);
    if (match && method === 'GET') {
      const milestoneId = requireUuid(decodeURIComponent(match[1]), 'Milestone ID');
      const { data: milestone, error: milestoneError } = await supabaseApiClient().from('project_milestones')
        .select('id,project_id').eq('id', milestoneId).maybeSingle();
      if (milestoneError) throw milestoneError;
      if (!milestone) throw fail(404, 'Milestone not found.');
      await getProjectForUser(user, milestone.project_id);
      const { data, error } = await supabaseApiClient().from('project_milestone_history')
        .select('id,milestone_id,actor_id,status,description,created_at').eq('milestone_id', milestoneId).order('created_at', { ascending: false });
      if (error) throw error;
      return res.json(data || []);
    }
    match = path.match(/^\/projects\/([^/]+)\/updates$/);
    if (method === 'POST' && match) {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      if (user.role !== 'student') throw fail(403, 'Only project students can submit progress updates.');
      const { data, error } = await supabaseApiClient().from('project_updates').insert({
        project_id: project.id, author_id: user.id, content: requireText(req.body?.content, 'Update content', 20000),
      }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    match = path.match(/^\/projects\/([^/]+)\/feedback$/);
    if (method === 'POST' && match) {
      const project = await getProjectForUser(user, requireUuid(decodeURIComponent(match[1]), 'Project ID'));
      if (user.role !== 'instructor' && user.role !== 'admin') throw fail(403, 'Only faculty or administrators can review projects.');
      const decision = ['feedback', 'revision_requested', 'approved', 'rejected'].includes(req.body?.decision) ? req.body.decision : null;
      if (!decision) throw fail(400, 'A valid review decision is required.');
      const { data, error } = await supabaseApiClient().from('project_feedback').insert({
        project_id: project.id, author_id: user.id, decision, content: requireText(req.body?.content, 'Feedback', 20000),
      }).select().single();
      if (error) throw error;
      const nextStatus = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : decision;
      await getAdminSupabaseClient().from('projects').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', project.id);
      await notifyProjectParticipants({
        projectId: project.id,
        institutionId: project.institution_id,
        type: 'feedback',
        title: `Project ${decision.replace('_', ' ')}`,
        body: req.body.content.trim().slice(0, 500),
        entityType: 'project',
        entityId: project.id,
        excludeUserId: user.id,
      });
      return res.status(201).json(data);
    }
    if (method === 'GET' && path === '/research/workspaces') {
      const { data, error } = await supabaseApiClient().from('research_workspaces').select('*').order('updated_at', { ascending: false }).limit(100);
      if (error) throw error;
      return res.json(data || []);
    }
    if (method === 'POST' && path === '/research/workspaces') {
      if (!user.institutionId) throw fail(403, 'Assign your account to an institution first.');
      const { data, error } = await supabaseApiClient().from('research_workspaces').insert({
        institution_id: user.institutionId, owner_id: user.id,
        title: requireText(req.body?.title, 'Research title', 200),
        topic: typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 500) : '',
        problem_statement: typeof req.body?.problemStatement === 'string' ? req.body.problemStatement.trim().slice(0, 10000) : '',
      }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    match = path.match(/^\/research\/workspaces\/([^/]+)$/);
    if (method === 'PATCH' && match) {
      const workspaceId = requireUuid(decodeURIComponent(match[1]), 'Workspace ID');
      const updates = {};
      if (typeof req.body?.title === 'string') updates.title = requireText(req.body.title, 'Research title', 200);
      if (typeof req.body?.topic === 'string') updates.topic = req.body.topic.trim().slice(0, 500);
      if (typeof req.body?.problemStatement === 'string') updates.problem_statement = req.body.problemStatement.trim().slice(0, 10000);
      if (typeof req.body?.proposal === 'string') updates.proposal = req.body.proposal.trim().slice(0, 30000);
      updates.updated_at = new Date().toISOString();
      const { data, error } = await supabaseApiClient().from('research_workspaces').update(updates).eq('id', workspaceId).select().maybeSingle();
      if (error) throw error;
      if (!data) throw fail(404, 'Research workspace not found.');
      return res.json(data);
    }
    if ((facultyOnly.test(path) || assessmentCreate || assessmentGenerate)
      && user.role !== 'instructor') {
      throw fail(403, 'You do not have permission to access this resource.');
    }
    if (method === 'GET' && path === '/me/academic-profile') {
      return res.json(await getStudentAcademicContext(user.id));
    }
    if (method === 'GET' && path === '/me/announcements') {
      const { data, error } = await supabaseApiClient()
        .from('announcements')
        .select('id,course_id,title,content,published_at,created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return res.json(data || []);
    }
    if (method === 'GET' && path === '/me/assignments') {
      const { data, error } = await supabaseApiClient()
        .from('assignments')
        .select('id,course_id,title,description,due_at,max_points,status,created_at')
        .in('status', ['published', 'closed'])
        .order('due_at')
        .limit(100);
      if (error) throw error;
      return res.json(data || []);
    }
    if (method === 'GET' && path === '/me/enrollments') {
      const context = await getStudentAcademicContext(user.id);
      return res.json(context.enrollments);
    }
    if (method === 'GET' && path === '/me/subjects') {
      const context = await getStudentAcademicContext(user.id);
      return res.json(context.subjects);
    }
    if (method === 'GET' && path === '/me/marks') {
      return res.json(await listVerifiedStudentMarks(user.id, normalizeAcademicFilters(req.query)));
    }
    if (method === 'GET' && path === '/me/semester-results') {
      return res.json(await listVerifiedSemesterResults(user.id, normalizeAcademicFilters(req.query)));
    }
    const repositoryRoutes = {
      '/academic/materials': 'materials',
      '/academic/question-papers': 'questionPapers',
      '/academic/answer-keys': 'answerKeys',
    };
    const repositoryKind = repositoryRoutes[path];
    if (method === 'GET' && repositoryKind) {
      return res.json(await listStudentRepository(
        user.id,
        repositoryKind,
        normalizeAcademicFilters(req.query),
      ));
    }
    match = path.match(/^\/academic\/(materials|question-papers|answer-keys)\/([^/]+)\/download$/);
    if (method === 'GET' && match) {
      const kinds = {
        materials: 'materials',
        'question-papers': 'questionPapers',
        'answer-keys': 'answerKeys',
      };
      const download = await getStudentDocumentDownload(
        user.id,
        kinds[match[1]],
        decodeURIComponent(match[2]),
      );
      return res.json(download);
    }
    if (method === 'GET' && path === '/me/courses') {
      let courses;
      if (user.role === 'student') {
        const enrollments = await listRecords('enrollments', {
          filters: [['studentUid', '==', user.id]],
          limit: 100,
        });
        courses = await Promise.all(enrollments.map((item) => getRecord('courses', item.courseId)));
      } else if (user.role === 'instructor') {
        const [facultyCourses, instructorCourses] = await Promise.all([
          listRecords('courses', { filters: [['facultyUid', '==', user.id]], limit: 500 }),
          listRecords('courses', { filters: [['instructorUid', '==', user.id]], limit: 500 }),
        ]);
        courses = [...new Map([...facultyCourses, ...instructorCourses].map((course) => [course.id, course])).values()]
          .sort((left, right) => String(left.code || '').localeCompare(String(right.code || '')))
          .slice(0, 100);
      } else if (user.role === 'admin') {
        courses = (await listRecords('courses', { limit: 500 }))
          .sort((left, right) => String(left.code || '').localeCompare(String(right.code || '')));
      } else {
        throw fail(403, 'You do not have permission to access courses.');
      }
      const progress = user.role === 'student'
        ? await listRecords('student_progress', { filters: [['studentUid', '==', user.id]], limit: 1000 })
        : [];
      return res.json(await Promise.all(courses.filter(Boolean).map(async (course) => {
        const facultyUid = course.facultyUid || course.instructorUid;
        const faculty = facultyUid ? await getStudentProfile(facultyUid) : null;
        const courseProgress = progress.filter((item) => item.courseId === course.id);
        return {
          id: course.id,
          code: course.code || '',
          title: course.title || '',
          description: course.description || '',
          instructor: faculty?.fullName || course.instructorName || '',
          semesterId: course.semesterId || undefined,
          credits: course.credits || 0,
          progress: courseProgress.length
            ? Math.round(courseProgress.reduce((sum, item) => sum + Number(item.masteryScore || 0), 0) / courseProgress.length)
            : 0,
          topicsCount: Array.isArray(course.topics) ? course.topics.length : 0,
          materialsCount: 0,
          topics: (Array.isArray(course.topics) ? course.topics : []).map((topic, index) => {
            const item = courseProgress.find((entry) => entry.topicId === topic.id);
            return {
              id: topic.id,
              courseId: course.id,
              title: topic.title || '',
              order: Number(topic.order || index + 1),
              isCompleted: Boolean(item?.isCompleted),
              masteryScore: item ? Number(item.masteryScore || 0) : undefined,
              prerequisites: topic.prerequisites || [],
              estimatedMinutes: Number(topic.estimatedMinutes || 0),
              resourcesCount: Number(topic.resourcesCount || 0),
            };
          }),
        };
      })));
    }

    match = path.match(/^\/courses\/([^/]+)\/academic-foundation$/);
    if (method === 'GET' && match) {
      const courseId = requireUuid(decodeURIComponent(match[1]), 'Course ID');
      await requireCourseAccess(user, courseId);
      const client = supabaseApiClient();
      const [outcomes, units, schedules, announcements, assignments] = await Promise.all([
        client.from('course_outcomes').select('id,course_id,code,description,display_order').eq('course_id', courseId).order('display_order'),
        client.from('course_units').select('id,course_id,unit_number,title,description,display_order').eq('course_id', courseId).order('display_order'),
        client.from('lecture_schedules').select('id,course_id,faculty_id,title,starts_at,ends_at,location,meeting_url').eq('course_id', courseId).order('starts_at'),
        client.from('announcements').select('id,course_id,author_id,title,content,status,published_at,created_at').eq('course_id', courseId).order('created_at', { ascending: false }),
        client.from('assignments').select('id,course_id,created_by,title,description,due_at,max_points,status,created_at,updated_at').eq('course_id', courseId).order('due_at'),
      ]);
      const result = [outcomes, units, schedules, announcements, assignments].find((item) => item.error);
      if (result?.error) throw result.error;
      return res.json({
        outcomes: outcomes.data || [],
        units: units.data || [],
        schedules: schedules.data || [],
        announcements: announcements.data || [],
        assignments: assignments.data || [],
      });
    }

    match = path.match(/^\/courses\/([^/]+)\/(outcomes|units|schedules|announcements|assignments)$/);
    if (method === 'POST' && match) {
      const courseId = requireUuid(decodeURIComponent(match[1]), 'Course ID');
      const resource = match[2];
      await requireCourseAccess(user, courseId);
      if (user.role !== 'instructor' && user.role !== 'admin') {
        throw fail(403, 'Only authorized course staff can manage this resource.');
      }
      const body = req.body || {};
      const client = supabaseApiClient();
      const payloads = {
        outcomes: {
          course_id: courseId,
          code: requireText(body.code, 'Outcome code', 80),
          description: requireText(body.description, 'Outcome description', 2000),
          display_order: Number.isInteger(body.displayOrder) && body.displayOrder >= 0 ? body.displayOrder : 0,
        },
        units: {
          course_id: courseId,
          unit_number: Number.isInteger(body.unitNumber) && body.unitNumber > 0 ? body.unitNumber : null,
          title: requireText(body.title, 'Unit title', 200),
          description: typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '',
          display_order: Number.isInteger(body.displayOrder) && body.displayOrder >= 0 ? body.displayOrder : 0,
        },
        schedules: {
          course_id: courseId,
          faculty_id: user.id,
          title: requireText(body.title, 'Schedule title', 200),
          starts_at: body.startsAt,
          ends_at: body.endsAt,
          location: typeof body.location === 'string' ? body.location.trim().slice(0, 300) : '',
          meeting_url: typeof body.meetingUrl === 'string' ? body.meetingUrl.trim().slice(0, 1000) : null,
        },
        announcements: {
          course_id: courseId,
          author_id: user.id,
          title: requireText(body.title, 'Announcement title', 200),
          content: requireText(body.content, 'Announcement content', 10000),
          status: body.status === 'published' ? 'published' : 'draft',
          published_at: body.status === 'published' ? new Date().toISOString() : null,
        },
        assignments: {
          course_id: courseId,
          created_by: user.id,
          title: requireText(body.title, 'Assignment title', 200),
          description: typeof body.description === 'string' ? body.description.trim().slice(0, 10000) : '',
          due_at: body.dueAt || null,
          max_points: Number.isFinite(Number(body.maxPoints)) && Number(body.maxPoints) > 0 ? Number(body.maxPoints) : 100,
          status: body.status === 'published' ? 'published' : 'draft',
        },
      };
      if (resource === 'units' && payloads.units.unit_number === null) throw fail(400, 'Unit number must be a positive integer.');
      if (resource === 'schedules' && (!payloads.schedules.starts_at || !payloads.schedules.ends_at
        || Number.isNaN(Date.parse(payloads.schedules.starts_at)) || Number.isNaN(Date.parse(payloads.schedules.ends_at))
        || Date.parse(payloads.schedules.ends_at) <= Date.parse(payloads.schedules.starts_at))) {
        throw fail(400, 'Schedule start and end times must be valid and ordered.');
      }
      const { data, error } = await client.from(`course_${resource === 'outcomes' ? 'outcomes' : resource === 'units' ? 'units' : resource === 'schedules' ? 'schedules' : resource}`)
        .insert(payloads[resource]).select().single();
      if (error) throw error;
      if (resource === 'announcements' && payloads.announcements.status === 'published') {
        await notifyCourseStudents({
          courseId,
          institutionId: user.institutionId,
          type: 'announcement',
          title: payloads.announcements.title,
          body: payloads.announcements.content,
          entityType: 'announcement',
          entityId: data.id,
        });
      }
      if (resource === 'assignments' && payloads.assignments.status === 'published') {
        await notifyCourseStudents({
          courseId,
          institutionId: user.institutionId,
          type: 'assignment',
          title: payloads.assignments.title,
          body: `A new assignment is available. Due: ${payloads.assignments.due_at || 'No deadline set.'}`,
          entityType: 'assignment',
          entityId: data.id,
        });
      }
      return res.status(201).json(data);
    }

    match = path.match(/^\/assignments\/([^/]+)\/submission$/);
    if (method === 'POST' && match) {
      const assignmentId = requireUuid(decodeURIComponent(match[1]), 'Assignment ID');
      if (user.role !== 'student') throw fail(403, 'Only students can submit assignments.');
      const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 20000) : '';
      const attachmentUrl = typeof req.body?.attachmentUrl === 'string'
        ? req.body.attachmentUrl.trim()
        : '';
      if (attachmentUrl && !new RegExp(`^assignments/${assignmentId}/${user.id}/[^/]{1,255}$`).test(attachmentUrl)) {
        throw fail(400, 'Attachment must be an authorized private submission path.');
      }
      if (!content && !attachmentUrl) throw fail(400, 'Submission content or an attachment is required.');
      const requestClient = supabaseApiClient();
      const { data: assignment, error: assignmentError } = await requestClient
        .from('assignments')
        .select('id,course_id,status')
        .eq('id', assignmentId)
        .maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment || assignment.status !== 'published') {
        throw fail(404, 'Assignment not found or unavailable.');
      }
      await requireCourseAccess(user, assignment.course_id, requestClient);
      const { data, error } = await getAdminSupabaseClient().from('assignment_submissions').upsert({
        assignment_id: assignmentId,
        student_id: user.id,
        content,
        attachment_url: attachmentUrl || null,
        submitted_at: new Date().toISOString(),
        status: 'submitted',
      }, { onConflict: 'assignment_id,student_id' }).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    match = path.match(/^\/assignments\/([^/]+)\/submissions$/);
    if (method === 'GET' && match) {
      const assignmentId = requireUuid(decodeURIComponent(match[1]), 'Assignment ID');
      const client = supabaseApiClient();
      const { data, error } = await client.from('assignment_submissions')
        .select('id,assignment_id,student_id,content,attachment_url,submitted_at,status,grade,feedback,graded_at,created_at,updated_at')
        .eq('assignment_id', assignmentId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return res.json(data || []);
    }

    match = path.match(/^\/assignment-submissions\/([^/]+)$/);
    if (method === 'PATCH' && match) {
      const submissionId = requireUuid(decodeURIComponent(match[1]), 'Submission ID');
      if (user.role !== 'instructor' && user.role !== 'admin') throw fail(403, 'Only authorized course staff can grade submissions.');
      const grade = Number(req.body?.grade);
      if (!Number.isFinite(grade) || grade < 0) throw fail(400, 'A non-negative grade is required.');
      const requestClient = supabaseApiClient();
      const { data: submission, error: submissionError } = await requestClient
        .from('assignment_submissions')
        .select('id,student_id,assignment_id,assignments!inner(course_id,courses!inner(institution_id))')
        .eq('id', submissionId)
        .maybeSingle();
      if (submissionError) throw submissionError;
      if (!submission?.assignments?.course_id) throw fail(404, 'Submission not found.');
      await requireAcademicCourseAccess(user, submission.assignments.course_id);
      const { data, error } = await getAdminSupabaseClient().from('assignment_submissions')
        .update({ grade, feedback: typeof req.body?.feedback === 'string' ? req.body.feedback.trim().slice(0, 10000) : null, status: 'returned', graded_at: new Date().toISOString() })
        .eq('id', submissionId).select().single();
      if (error) throw error;
      await writeAuditLog({
        institutionId: user.institutionId,
        actorId: user.id,
        action: 'assignment_submission_graded',
        entityType: 'assignment_submission',
        entityId: submissionId,
        details: { grade },
      });
      await notifyUsers({
        recipientIds: [submission.student_id],
        institutionId: submission.assignments.courses.institution_id || user.institutionId,
        type: 'feedback',
        title: 'Assignment feedback available',
        body: 'Your assignment submission has been graded. Open the assignment to review the feedback.',
        entityType: 'assignment_submission',
        entityId: submissionId,
      });
      return res.json(data);
    }

    match = path.match(/^\/me\/courses\/([^/]+)$/);
    if (method === 'GET' && match) {
      const courseId = decodeURIComponent(match[1]);
      const course = await getCourse(user, courseId);
      const progress = user.role === 'student'
        ? (await listRecords('student_progress', {
          filters: [['studentUid', '==', user.id]],
          limit: 500,
        })).filter((item) => item.courseId === courseId)
        : [];
      const facultyUid = course.facultyUid || course.instructorUid;
      const profile = facultyUid ? await getStudentProfile(facultyUid) : null;
      return res.json({
        id: course.id,
        code: course.code || '',
        title: course.title || '',
        description: course.description || '',
        instructor: profile?.fullName || course.instructorName || '',
        credits: course.credits || 0,
        progress: progress.length
          ? Math.round(progress.reduce((total, item) => total + Number(item.masteryScore || 0), 0) / progress.length)
          : 0,
        topicsCount: (course.topics || []).length,
        materialsCount: 0,
        topics: (course.topics || []).map((topic, index) => {
          const item = progress.find((entry) => entry.topicId === topic.id);
          return {
            id: topic.id,
            courseId: course.id,
            title: topic.title || '',
            order: Number(topic.order || index + 1),
            isCompleted: Boolean(item?.isCompleted),
            masteryScore: item ? Number(item.masteryScore || 0) : undefined,
            prerequisites: topic.prerequisites || [],
            estimatedMinutes: Number(topic.estimatedMinutes || 0),
            resourcesCount: Number(topic.resourcesCount || 0),
          };
        }),
      });
    }

    match = path.match(/^\/faculty\/courses\/([^/]+)\/roster$/);
    if (method === 'GET' && match) {
      const courseId = decodeURIComponent(match[1]);
      const course = await getRecord('courses', courseId);
      if (!course || (course.facultyUid !== user.id && course.instructorUid !== user.id)) {
        throw fail(404, 'Course not found or not assigned to this faculty account.');
      }
      const enrollments = await listRecords('enrollments', { filters: [['courseId', '==', courseId]], limit: 1000 });
      const assessments = await listRecords('assessments', {
        filters: [['courseId', '==', courseId]],
        limit: 500,
      });
      const assessmentIds = new Set(assessments.map((item) => item.id));
      const [allSubmissions, progress, events, activity] = await Promise.all([
        listRecords('assessment_submissions', { filters: [['courseId', '==', courseId]], limit: 10000 }),
        listRecords('student_progress', { filters: [['courseId', '==', courseId]], limit: 10000 }),
        listRecords('engagement_events', { filters: [['courseId', '==', courseId]], limit: 10000 }),
        listRecords('learning_activity', { filters: [['courseId', '==', courseId]], limit: 10000 }),
      ]);
      const eventsById = new Map([...events, ...activity].map((event) => [event.id, event]));
      const allEvents = [...eventsById.values()];
      sortByDate(allEvents, 'createdAt', 'desc');
      const submissions = allSubmissions.filter((item) => assessmentIds.has(item.assessmentId));
      const roster = [];
      for (const enrollment of enrollments) {
        const studentId = enrollment.studentUid;
        const profile = course.institutionId
          ? await getFacultyRosterProfile(studentId, course.institutionId)
          : await getStudentProfile(studentId);
        if (!profile) continue;
        const userSubmissions = submissions.filter((item) => item.studentUid === studentId);
        const score = userSubmissions.length
          ? userSubmissions.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / userSubmissions.length
          : null;
        const topics = progress.filter((item) => item.studentUid === studentId);
        const weakTopic = topics.filter((item) => Number(item.masteryScore) < 70)
          .sort((a, b) => Number(a.masteryScore) - Number(b.masteryScore))[0];
        const latestEvent = allEvents.find((item) => item.studentUid === studentId);
        roster.push({
          id: studentId,
          name: profile.fullName || '',
          email: profile.email || '',
          score: score === null ? '—' : `${score.toFixed(1)}%`,
          status: score === null ? 'No assessments' : score < 70 ? 'Needs Support' : score >= 90 ? 'Advanced' : 'On Track',
          weakArea: weakTopic?.topicTitle || (topics.length ? 'No weak concept identified' : 'No progress recorded'),
          lastActive: latestEvent ? asDate(latestEvent.createdAt)?.toLocaleString() : 'No activity recorded',
        });
      }
      return res.json(roster);
    }

    if (method === 'GET' && path === '/me/progress') {
      const [submissions, enrollments, progress, legacyEvents, activity] = await Promise.all([
        listRecords('assessment_submissions', { filters: [['studentUid', '==', user.id]], limit: 500 }),
        listRecords('enrollments', { filters: [['studentUid', '==', user.id]], limit: 100 }),
        listRecords('student_progress', { filters: [['studentUid', '==', user.id]], limit: 1000 }),
        listRecords('engagement_events', { filters: [['studentUid', '==', user.id]], limit: 1000 }),
        listRecords('learning_activity', { filters: [['studentUid', '==', user.id]], limit: 1000 }),
      ]);
      const enrolledCourseIds = new Set(enrollments
        .filter((enrollment) => ['active', 'enrolled', 'completed'].includes(String(enrollment.status || 'active').toLowerCase()))
        .map((enrollment) => enrollment.courseId)
        .filter((courseId) => typeof courseId === 'string' && courseId));
      const scopedProgress = progress.filter((item) =>
        item.studentUid === user.id && enrolledCourseIds.has(item.courseId));
      const courseIds = [...new Set(scopedProgress.map((item) => item.courseId))];
      const courseRecords = await Promise.all(courseIds.map((courseId) => getRecord('courses', courseId)));
      const courseCodes = new Map(courseIds.map((courseId, index) => [
        courseId,
        courseRecords[index]?.code || '',
      ]));
      const progressAnalytics = buildProgressAnalytics(scopedProgress, courseCodes);
      const eventsById = new Map([...legacyEvents, ...activity].map((event) => [event.id, event]));
      const events = [...eventsById.values()];
      const recentEvents = events.filter((item) => asDate(item.createdAt)?.getTime() >= Date.now() - 7 * 86400000);
      const grouped = new Map();
      for (const event of recentEvents) {
        const date = asDate(event.createdAt).toISOString().slice(0, 10);
        const day = grouped.get(date) || { date, minutes: 0, eventsCount: 0 };
        day.minutes += Number(event.durationMinutes || 0);
        day.eventsCount += 1;
        grouped.set(date, day);
      }
      const scoreValues = submissions.map((item) => Number(item.percentage || 0));
      const progression = [];
      for (const submission of submissions) {
        const assessment = await getRecord('assessments', submission.assessmentId);
        progression.push({
          date: asDate(submission.submittedAt)?.toISOString().slice(0, 10) || '',
          score: Number(submission.percentage || 0),
          assessmentTitle: assessment?.title || 'Assessment',
        });
      }
      progression.sort((left, right) => left.date.localeCompare(right.date));
      return res.json({
        averageScore: scoreValues.length ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) : 0,
        assessmentsCompleted: submissions.length,
        enrolledCoursesCount: enrolledCourseIds.size,
        conceptsMasteredCount: progressAnalytics.conceptMasteryList.filter((item) => item.status === 'Mastered').length,
        totalConceptsCount: progressAnalytics.conceptMasteryList.length,
        weeklyActivity: [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date)).map((item) => ({
          ...item,
          day: new Date(`${item.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        })),
        scoreProgression: progression,
        weakTopics: progressAnalytics.weakTopics,
        conceptMasteryList: progressAnalytics.conceptMasteryList,
      });
    }

    if (method === 'GET' && path === '/me/recommendations') {
      const rows = await listRecords('recommendations', {
        filters: [['studentUid', '==', user.id]],
        limit: 100,
      });
      return res.json(sortByDate(rows, 'createdAt', 'desc')
        .map((item) => ({ id: item.id, ...(item.payload || {}) })));
    }
    if (method === 'GET' && (path === '/learning-path' || (match = path.match(/^\/courses\/([^/]+)\/learning-path$/)))) {
      const courseId = path === '/learning-path' ? null : decodeURIComponent(match[1]);
      if (courseId) await requireCourseAccess(user, courseId);
      const filters = [['studentUid', '==', user.id]];
      if (courseId) filters.push(['courseId', '==', courseId]);
      const rows = await listRecords('learning_path_nodes', { filters, limit: 500 });
      rows.sort((left, right) => Number(left.sequenceNumber || 0) - Number(right.sequenceNumber || 0));
      return res.json(rows.map((item) => ({
        id: item.id,
        title: item.title,
        sequenceNumber: item.sequenceNumber,
        status: item.status,
        masteryScore: item.masteryScore == null ? undefined : Number(item.masteryScore),
        prerequisites: item.prerequisites || [],
        estimatedMinutes: item.estimatedMinutes,
        relatedResources: item.relatedResources || [],
        whyNextReason: item.whyNextReason || item.metadata?.why_next_reason || '',
        practicePrompt: item.practicePrompt || item.metadata?.practice_prompt || '',
      })));
    }

    if (method === 'GET' && path === '/me/tasks') {
      return res.json(await listStudentTasks(user.id));
    }
    if (method === 'POST' && path === '/me/tasks') {
      const { courseId, title, dueDate, dueTime, type, priority } = req.body || {};
      if (typeof title !== 'string' || !title.trim() || typeof courseId !== 'string') throw fail(400, 'A title and course ID are required.');
      await requireCourseAccess(user, courseId);
      const dueAt = dueDate ? new Date(`${dueDate}T${dueTime || '00:00'}:00`) : null;
      if (dueAt && !Number.isFinite(dueAt.getTime())) throw fail(400, 'The task due date is invalid.');
      const task = await createRecord('tasks', {
        ownerUid: user.id,
        courseId,
        title: title.trim().slice(0, 160),
        dueAt,
        taskType: typeof type === 'string' ? type : 'review',
        priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
        completed: false,
        createdAt: now(),
        updatedAt: now(),
      });
      const course = await getRecord('courses', courseId);
      return res.status(201).json({
        id: task.id,
        courseId,
        courseCode: course?.code || '',
        title: task.title,
        dueDate: dueAt?.toISOString().slice(0, 10) || '',
        dueTime: dueAt?.toISOString().slice(11, 16) || '',
        type: task.taskType,
        priority: task.priority,
        completed: false,
      });
    }
    match = path.match(/^\/me\/tasks\/([^/]+)$/);
    if (method === 'PATCH' && match) {
      const requestedId = decodeURIComponent(match[1]);
      const legacy = requestedId.startsWith('legacy_');
      const taskId = legacy ? requestedId.slice('legacy_'.length) : requestedId;
      const collection = legacy ? 'study_tasks' : 'tasks';
      const task = await getRecord(collection, taskId);
      if (!task || task.ownerUid !== user.id) throw fail(404, 'Study task not found.');
      const completed = !task.completed;
      const supabaseClient = getOptionalSupabaseRequestClient();
      if (!supabaseClient) throw fail(503, 'Supabase is not configured for this request.');
      const { error } = await supabaseClient.rpc('set_task_completion', {
        target_task_id: task.id,
        source_collection: legacy ? 'study_tasks' : 'tasks',
        next_completed: completed,
      });
      if (error) throw error;
      return res.json(await listStudentTasks(user.id));
    }

    if (method === 'GET' && path === '/planner/sessions') {
      const sessions = await listStudentPlannerSessions(user.id);
      return res.json(await Promise.all(sessions.map(async (session) => {
        const start = asDate(session.startsAt);
        const course = session.courseId ? await getRecord('courses', session.courseId) : null;
        return {
          id: session.id,
          courseId: session.courseId,
          courseCode: course?.code || '',
          title: session.title,
          date: start?.toISOString().slice(0, 10) || '',
          startTime: start?.toISOString().slice(11, 16) || '',
          durationMinutes: session.durationMinutes,
          completed: Boolean(session.completed),
          notes: session.notes || '',
          type: session.sessionType,
        };
      })));
    }
    if (method === 'POST' && path === '/planner/sessions') {
      const { courseId, title, date, startTime, durationMinutes, completed, notes, type } = req.body || {};
      const startsAt = new Date(`${date}T${startTime}:00`);
      if (typeof title !== 'string' || !title.trim() || !Number.isFinite(startsAt.getTime())
        || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
        throw fail(400, 'A title, valid date/time, and duration between 1 and 1440 minutes are required.');
      }
      if (courseId) await requireCourseAccess(user, courseId);
      const session = await createRecord('planner_sessions', {
        ownerUid: user.id,
        courseId: courseId || null,
        title: title.trim().slice(0, 160),
        startsAt,
        durationMinutes,
        completed: Boolean(completed),
        notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
        sessionType: typeof type === 'string' ? type : 'review',
        createdAt: now(),
      });
      const course = courseId ? await getRecord('courses', courseId) : null;
      return res.status(201).json({
        id: session.id,
        courseId,
        courseCode: course?.code || '',
        title: session.title,
        date: startsAt.toISOString().slice(0, 10),
        startTime: startsAt.toISOString().slice(11, 16),
        durationMinutes,
        completed: Boolean(completed),
        notes: session.notes,
        type: session.sessionType,
      });
    }
    match = path.match(/^\/planner\/sessions\/([^/]+)$/);
    if (method === 'PATCH' && match) {
      const session = await getRecord('planner_sessions', match[1]);
      if (!session || session.ownerUid !== user.id) throw fail(404, 'Planner session not found.');
      await updateRecord('planner_sessions', session.id, { completed: !session.completed });
      return res.json(await listStudentPlannerSessions(user.id));
    }
    if (method === 'POST' && path === '/planner/optimize') {
      throw fail(503, 'AI study planning provider is not configured.');
    }

    if (method === 'GET' && path === '/chat/sessions') {
      const [legacySessions, nestedSessions] = await Promise.all([
        listRecords('conversations', {
          filters: [['ownerUid', '==', user.id]],
          limit: 100,
        }),
        listRecords(`student_agent/${user.id}/conversations`, {
          filters: [['ownerUid', '==', user.id]],
          limit: 100,
        }),
      ]);
      const sessionsById = new Map(legacySessions.map((session) => [session.id, session]));
      nestedSessions.forEach((session) => sessionsById.set(session.id, session));
      const sessions = [...sessionsById.values()]
        .sort((left, right) => (asDate(right.updatedAt)?.getTime() || 0) - (asDate(left.updatedAt)?.getTime() || 0))
        .slice(0, 100);
      return res.json(await Promise.all(sessions.map(async (session) => {
        await getStudentConversation(user.id, session.id);
        const messages = await listRecords('messages', {
          filters: [['conversationId', '==', session.id]],
          limit: 1000,
        });
        const messageCount = messages.length;
        const course = session.courseId ? await getRecord('courses', session.courseId) : null;
        return {
          id: session.id,
          title: session.title || 'Learning Conversation',
          courseId: session.courseId || undefined,
          courseCode: course?.code || session.courseCode || undefined,
          createdAt: asDate(session.createdAt)?.toISOString() || '',
          updatedAt: asDate(session.updatedAt)?.toISOString() || '',
          messageCount,
        };
      })));
    }
    if (method === 'POST' && path === '/chat/sessions') {
      const { title, courseId } = req.body || {};
      if (courseId) await requireCourseAccess(user, courseId);
      const createdAt = now();
      const sessionTitle = typeof title === 'string' && title.trim()
        ? title.trim().slice(0, 120)
        : 'New Learning Conversation';
      const conversation = await createRecord(`student_agent/${user.id}/conversations`, {
        ownerUid: user.id,
        title: sessionTitle,
        courseId: courseId || null,
        createdAt,
        updatedAt: createdAt,
      });
      const course = courseId ? await getRecord('courses', courseId) : null;
      return res.status(201).json({
        id: conversation.id,
        title: sessionTitle,
        courseId,
        courseCode: course?.code || undefined,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        messageCount: 0,
      });
    }
    match = path.match(/^\/chat\/sessions\/([^/]+)\/messages$/);
    if (method === 'GET' && match) {
      const { data: session } = await getStudentConversation(user.id, decodeURIComponent(match[1]));
      const messages = await listRecords('messages', {
        filters: [['conversationId', '==', session.id]],
        orderField: 'createdAt',
        limit: 1000,
      });
      return res.json(messages.map((data) => {
        const steps = data.metadata?.agent_steps;
        return {
          id: data.id,
          sessionId: session.id,
          role: data.role,
          content: data.content,
          timestamp: asDate(data.createdAt)?.toISOString() || '',
          agentSteps: Array.isArray(steps) ? steps.map((step, index) => ({
            layerNumber: index + 1,
            layerName: step.name || 'Agent',
            description: step.description || '',
            durationMs: Number(step.duration_ms || 0),
            status: 'completed',
          })) : undefined,
        };
      }));
    }
    if (method === 'POST' && match) {
      throw fail(503, 'Chat generation is available through the authenticated AI service endpoint.');
    }


    if (method === 'GET' && path === '/assessments') {
      return res.json(await listAssessments(user, { courseId: req.query.courseId }));
    }
    match = path.match(/^\/courses\/([^/]+)\/assessments$/);
    if (method === 'GET' && match) return res.json(await listAssessments(user, { courseId: decodeURIComponent(match[1]) }));
    match = path.match(/^\/assessments\/([^/]+)$/);
    if (method === 'GET' && match) {
      const [assessment] = await listAssessments(user, { assessmentId: match[1] });
      if (!assessment) throw fail(404, 'Assessment not found.');
      return res.json(assessment);
    }
    match = path.match(/^\/assessments\/([^/]+)\/submit$/);
    if (method === 'POST' && match) return res.status(201).json(await submitAssessment(user, match[1], req));
    match = path.match(/^\/courses\/([^/]+)\/assessments\/generate$/);
    if (method === 'POST' && match) throw fail(503, 'Assessment generation provider is not configured.');
    if (method === 'POST' && path === '/faculty/assessments/generate') {
      throw fail(503, 'Assessment generation provider is not configured.');
    }
    match = path.match(/^\/courses\/([^/]+)\/assessments$/);
    if (method === 'POST' && match) {
      const courseId = decodeURIComponent(match[1]);
      if (user.role !== 'instructor') throw fail(403, 'You do not have permission to publish assessments.');
      const course = await getCourse(user, courseId);
      const assessment = req.body || {};
      if (typeof assessment.title !== 'string' || !assessment.title.trim()
        || !Array.isArray(assessment.questions) || assessment.questions.length < 1 || assessment.questions.length > 100) {
        throw fail(400, 'Assessment title and 1 to 100 questions are required.');
      }
      const questions = assessment.questions.map((question, index) => {
        if (typeof question.questionText !== 'string' || !Array.isArray(question.options)
          || question.options.length < 2 || !Number.isInteger(question.correctOptionIndex)
          || question.correctOptionIndex < 0 || question.correctOptionIndex >= question.options.length) {
          throw fail(400, `Question ${index + 1} has invalid answer options.`);
        }
        return {
          id: randomUUID(),
          questionText: question.questionText.slice(0, 5000),
          options: question.options.map((option) => String(option).slice(0, 1000)),
          correctOptionIndex: question.correctOptionIndex,
          explanation: typeof question.explanation === 'string' ? question.explanation.slice(0, 2000) : '',
          topicTag: typeof question.topicTag === 'string' ? question.topicTag.slice(0, 120) : '',
          codeSnippet: typeof question.codeSnippet === 'string' ? question.codeSnippet.slice(0, 10000) : null,
        };
      });
      const created = await createRecord('assessments', {
        courseId,
        title: assessment.title.trim().slice(0, 200),
        topic: typeof assessment.topic === 'string' ? assessment.topic.slice(0, 200) : '',
        difficulty: ['Beginner', 'Intermediate', 'Advanced'].includes(assessment.difficulty) ? assessment.difficulty : 'Intermediate',
        durationMinutes: Number.isInteger(assessment.durationMinutes) ? Math.min(Math.max(assessment.durationMinutes, 1), 600) : 15,
        passingScore: Number.isInteger(assessment.passingScore) ? Math.min(Math.max(assessment.passingScore, 0), 100) : 70,
        status: 'published',
        questions,
        createdBy: user.id,
        createdAt: now(),
      });
      const [published] = await listAssessments(user, { assessmentId: created.id });
      return res.status(201).json(published || { id: created.id, courseCode: course.code || '' });
    }

    if (method === 'GET' && path === '/documents') return res.json(await listDocuments(user));

    if (method === 'GET' && path === '/course-materials') {
      if (!['student', 'instructor'].includes(user.role)) {
        throw fail(403, 'Only students and faculty can access course materials.');
      }
      const requestedCourseId = req.query.courseId
        ? requireUuid(req.query.courseId, 'Course ID')
        : null;
      if (requestedCourseId) await requireCourseAccess(user, requestedCourseId);
      let materials;
      if (user.role === 'student') {
        materials = await listStudentRepository(user.id, 'materials');
        if (requestedCourseId) {
          materials = materials.filter((material) => material.courseId === requestedCourseId);
        }
        const documentIds = materials.flatMap((material) => material.documentId ? [material.documentId] : []);
        const documentRows = documentIds.length
          ? await supabaseApiClient().from('documents').select('id,status').in('id', documentIds)
          : { data: [], error: null };
        if (documentRows.error) throw documentRows.error;
        const documentsById = new Map((documentRows.data || []).map((document) => [document.id, document]));
        return res.json(await Promise.all(materials.map(async (material) => {
          const course = await getRecord('courses', material.courseId);
          const document = documentsById.get(material.documentId);
          return {
            ...material,
            courseCode: course?.code || '',
            fileType: ({ pdf: 'pdf', txt: 'text', md: 'markdown' })[material.fileType] || 'pdf',
            ragReady: document?.status === 'ready' || material.ragReady,
            documentStatus: document?.status ? String(document.status).toUpperCase() : undefined,
          };
        })));
      }
      const filters = [['ownerUid', '==', user.id]];
      if (requestedCourseId) filters.push(['courseId', '==', requestedCourseId]);
      const records = await listRecords('educational_materials', { filters, limit: 500 });
      const documentIds = records.flatMap((record) => record.documentId ? [record.documentId] : []);
      const documentRows = documentIds.length
        ? await supabaseApiClient().from('documents').select('id,status').in('id', documentIds)
        : { data: [], error: null };
      if (documentRows.error) throw documentRows.error;
      const documentsById = new Map((documentRows.data || []).map((document) => [document.id, document]));
      materials = await Promise.all(records.map(async (record) => {
        const course = await getRecord('courses', record.courseId);
        return publicCourseMaterial(record, course?.code || '', documentsById.get(record.documentId));
      }));
      return res.json(materials.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt)));
    }

    match = path.match(/^\/courses\/([^/]+)\/materials$/);
    if (method === 'POST' && match) {
      const courseId = requireUuid(decodeURIComponent(match[1]), 'Course ID');
      return res.status(201).json(await uploadCourseMaterial(user, courseId, req.file, req.body));
    }

    match = path.match(/^\/course-materials\/([^/]+)\/download$/);
    if (method === 'GET' && match) {
      const materialId = decodeURIComponent(match[1]);
      if (user.role === 'student') {
        const download = await getStudentDocumentDownload(user.id, 'materials', materialId);
        return res.json({ url: download.url, expiresInSeconds: download.expiresInSeconds });
      }
      const material = await getOwnedCourseMaterial(user, materialId);
      if (material.storageBucket !== 'course-materials' || !material.storagePath) {
        throw fail(404, 'Course material file not found.');
      }
      const { data, error } = await supabaseApiClient().storage
        .from(material.storageBucket)
        .createSignedUrl(material.storagePath, 300, { download: true });
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('Supabase did not return a signed download URL.');
      return res.json({ url: data.signedUrl, expiresInSeconds: 300 });
    }

    match = path.match(/^\/course-materials\/([^/]+)$/);
    if (match && method === 'PATCH') {
      const materialId = decodeURIComponent(match[1]);
      const material = await getOwnedCourseMaterial(user, materialId);
      const title = requireText(req.body?.title, 'Document title', 200);
      const category = validateCourseMaterialCategory(req.body?.category);
      const description = optionalText(req.body?.description, 'Description', 2000);
      const metadata = {
        ...(material.metadata && typeof material.metadata === 'object' ? material.metadata : {}),
        category,
      };
      const updated = await updateRecord('educational_materials', materialId, {
        title,
        description,
        metadata,
      });
      if (material.documentId) {
        const { error: documentUpdateError } = await getAdminSupabaseClient()
          .from('documents')
          .update({ title })
          .eq('id', material.documentId)
          .eq('owner_id', user.id);
        if (documentUpdateError) throw documentUpdateError;
      }
      const course = await getRecord('courses', updated.courseId);
      return res.json(publicCourseMaterial(updated, course?.code || ''));
    }
    if (match && method === 'DELETE') {
      const material = await getOwnedCourseMaterial(user, decodeURIComponent(match[1]));
      if (material.storageBucket !== 'course-materials' || !material.storagePath) {
        throw fail(409, 'Stored file information is unavailable; the material was not deleted.');
      }
      const client = supabaseApiClient();
      await deleteRecord('educational_materials', material.id);
      if (material.documentId) await deleteRecord('documents', material.documentId);
      const { error: storageError } = await client.storage
        .from(material.storageBucket)
        .remove([material.storagePath]);
      if (storageError) throw storageError;
      return res.json({ success: true });
    }

    match = path.match(/^\/courses\/([^/]+)\/documents$/);
    if (method === 'GET' && match) return res.json(await listDocuments(user, decodeURIComponent(match[1])));
    match = path.match(/^\/documents\/([^/]+)$/);
    if (method === 'DELETE' && match) {
      await removeDocument(user, match[1]);
      return res.json({ success: true });
    }
    match = path.match(/^\/courses\/([^/]+)\/documents$/);
    if (method === 'POST' && match) {
      if (user.role !== 'instructor') {
        throw fail(403, 'Only faculty can upload course materials.');
      }
      const courseId = decodeURIComponent(match[1]);
      if (req.body?.course_id && req.body.course_id !== courseId) {
        throw fail(400, 'Uploaded course ID does not match the request path.');
      }
      const document = await uploadDocument(user, courseId, req.file);
      return res.status(201).json(document);
    }

    if (method === 'GET' && path === '/lab/problems') {
      throw fail(503, 'Coding problem content is not configured on this server.');
    }
    if (method === 'POST' && path === '/lab/execute') {
      throw fail(503, 'A secure code execution provider is not configured.');
    }
    return res.status(404).json({ detail: 'API endpoint not found.' });
  } catch (error) {
    if (Number.isInteger(error?.status)) return res.status(error.status).json({ detail: error.message });
    const failure = classifySupabaseError(error);
    const context = apiFailureContext(req);
    const requestId = req.requestId || 'unknown';
    const rawHttpStatus = error?.statusCode ?? error?.status;
    const httpStatus = Number.isInteger(rawHttpStatus) ? rawHttpStatus : undefined;
    const rawCodeValue = typeof error?.code === 'string' || typeof error?.code === 'number'
      ? String(error.code)
      : '';
    const rawCode = /^[A-Za-z0-9._/-]{1,80}$/.test(rawCodeValue) ? rawCodeValue : 'unknown';
    console.error(JSON.stringify({
      event: 'supabase_api_request_failed',
      request_id: requestId,
      operation: context.operation,
      collections: context.collections,
      error_code: failure.code,
      source_error_code: rawCode,
      error_type: error instanceof Error ? error.name : 'unknown',
      http_status: httpStatus,
      authenticated: Boolean(user?.id),
      role: user?.role || 'unknown',
      backend: 'supabase',
      project_id: 'configured',
      safe_message: failure.message,
    }));
    return res.status(failure.status).json({
      detail: failure.message,
      code: failure.code,
      request_id: requestId,
    });
  }
}
