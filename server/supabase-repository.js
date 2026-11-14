import { getAdminSupabaseClient, getSupabaseRequestClient } from './supabase.js';

const TABLES = {
  users: 'profiles',
  profiles: 'profiles',
  courses: 'courses',
  enrollments: 'enrollments',
  subjects: 'subjects',
  departments: 'departments',
  branches: 'branches',
  regulations: 'regulations',
  academic_years: 'academic_years',
  semesters: 'semesters',
  educational_materials: 'course_materials',
  examination_papers: 'examination_papers',
  official_answer_keys: 'official_answer_keys',
  verified_subject_marks: 'verified_subject_marks',
  semester_results: 'semester_results',
  assessments: 'assessments',
  assessment_submissions: 'assessment_submissions',
  student_progress: 'student_progress',
  engagement_events: 'engagement_events',
  learning_activity: 'learning_activity',
  recommendations: 'recommendations',
  learning_path_nodes: 'learning_path_nodes',
  tasks: 'tasks',
  study_tasks: 'tasks',
  planner_sessions: 'planner_sessions',
  conversations: 'conversations',
  messages: 'messages',
  documents: 'documents',
  document_chunks: 'document_chunks',
  student_agent_records: 'student_agent_records',
};

const SELECT_COLUMNS = {
  profiles: 'id,email,role,is_approved,institution_id',
  courses: 'id,code,title,description,instructor_id,institution_id,subject_id,department_id,branch_id,regulation_id,academic_year_id,semester_id,credits,topics,status,metadata,created_at,updated_at',
  enrollments: 'id,student_id,course_id,subject_id,academic_year_id,semester_id,status,enrolled_at,metadata,created_at,updated_at',
  subjects: 'id,code,title,department_id,regulation_id,semester_id,semester_number,metadata,created_at,updated_at',
  departments: 'id,code,name,metadata,created_at,updated_at',
  branches: 'id,department_id,code,name,metadata,created_at,updated_at',
  regulations: 'id,code,name,metadata,created_at,updated_at',
  academic_years: 'id,name,starts_on,ends_on,metadata,created_at,updated_at',
  semesters: 'id,academic_year_id,regulation_id,name,semester_number,metadata,created_at,updated_at',
  course_materials: 'id,course_id,subject_id,document_id,owner_id,title,description,material_type,file_type,bucket_id,object_path,file_size_bytes,published,publication_status,published_at,metadata,created_at,updated_at',
  examination_papers: 'id,course_id,subject_id,document_id,owner_id,title,examination_type,department_id,regulation_id,semester_id,academic_year_id,bucket_id,object_path,file_type,file_size_bytes,published,publication_status,published_at,metadata,created_at,updated_at',
  official_answer_keys: 'id,course_id,subject_id,document_id,owner_id,examination_paper_id,title,examination_type,department_id,regulation_id,semester_id,academic_year_id,bucket_id,object_path,release_at,published,publication_status,published_at,metadata,created_at,updated_at',
  verified_subject_marks: 'id,student_id,course_id,subject_id,academic_year_id,semester_id,examination_type,marks,max_marks,grade,verified_by,verified_at,metadata,created_at,updated_at',
  semester_results: 'id,student_id,academic_year_id,semester_id,semester_number,result_status,sgpa,cgpa,total_credits,verified_by,verified_at,metadata,created_at,updated_at',
  assessments: 'id,course_id,created_by,title,topic,difficulty,duration_minutes,passing_score,status,metadata,created_at,updated_at',
  assessment_questions: 'id,assessment_id,question_key,question_text,options,topic_tag,code_snippet,display_order,metadata,created_at',
  assessment_answer_keys: 'question_id,correct_option_index,explanation',
  assessment_submissions: 'id,assessment_id,course_id,student_id,answers,score,total_questions,percentage,passed,time_spent_seconds,result,submitted_at,metadata',
  student_progress: 'id,student_id,course_id,topic_id,topic_title,mastery_score,total_attempts,is_completed,last_studied_at,metadata,created_at,updated_at',
  engagement_events: 'id,student_id,course_id,event_type,duration_minutes,metadata,created_at',
  learning_activity: 'id,student_id,course_id,assessment_id,activity_type,duration_minutes,ai_generated,metadata,created_at',
  recommendations: 'id,student_id,course_id,payload,created_at,updated_at',
  learning_path_nodes: 'id,student_id,course_id,title,sequence_number,status,mastery_score,prerequisites,estimated_minutes,related_resources,metadata,created_at,updated_at',
  tasks: 'id,legacy_collection,owner_id,course_id,title,task_type,priority,due_at,completed,notes,metadata,created_at,updated_at',
  planner_sessions: 'id,owner_id,course_id,title,starts_at,duration_minutes,completed,notes,session_type,metadata,created_at,updated_at',
  conversations: 'id,legacy_id,legacy_collection,owner_id,course_id,title,metadata,created_at,updated_at',
  messages: 'id,legacy_id,conversation_id,role,content,metadata,created_at',
  student_agent_records: 'id,legacy_id,owner_id,course_id,record_type,payload,created_at,updated_at',
  documents: 'id,owner_id,course_id,title,file_type,file_size_bytes,bucket_id,object_path,status,visibility,published,metadata,created_at,updated_at',
  document_chunks: 'id,document_id,course_id,generation_id,chunk_index,page_number,content,embedding_model,metadata,created_at',
};

const FIELD_COLUMNS = {
  profiles: {
    fullName: 'full_name', displayName: 'full_name', avatarUrl: 'avatar_url',
    departmentId: 'department_id', branchId: 'branch_id', regulationId: 'regulation_id',
    institutionId: 'institution_id',
    academicYearId: 'academic_year_id', currentSemesterId: 'current_semester_id',
    studentId: 'student_id', enrolledSince: 'enrolled_since', createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  courses: {
    facultyUid: 'instructor_id', instructorUid: 'instructor_id', instructorId: 'instructor_id',
    subjectId: 'subject_id', departmentId: 'department_id', branchId: 'branch_id',
    regulationId: 'regulation_id', academicYearId: 'academic_year_id', semesterId: 'semester_id',
    institutionId: 'institution_id',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  enrollments: {
    studentUid: 'student_id', courseId: 'course_id', subjectId: 'subject_id',
    academicYearId: 'academic_year_id', semesterId: 'semester_id', enrolledAt: 'enrolled_at',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  subjects: {
    departmentId: 'department_id', regulationId: 'regulation_id', semesterId: 'semester_id',
    semesterNumber: 'semester_number', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  departments: { createdAt: 'created_at', updatedAt: 'updated_at' },
  branches: { departmentId: 'department_id', createdAt: 'created_at', updatedAt: 'updated_at' },
  regulations: { createdAt: 'created_at', updatedAt: 'updated_at' },
  academic_years: { startsOn: 'starts_on', endsOn: 'ends_on', createdAt: 'created_at', updatedAt: 'updated_at' },
  semesters: {
    academicYearId: 'academic_year_id', regulationId: 'regulation_id',
    semesterNumber: 'semester_number', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  course_materials: {
    courseId: 'course_id', subjectId: 'subject_id', documentId: 'document_id', ownerUid: 'owner_id',
    materialType: 'material_type', fileType: 'file_type', storageBucket: 'bucket_id',
    storagePath: 'object_path', fileSizeBytes: 'file_size_bytes', publicationStatus: 'publication_status',
    publishedAt: 'published_at', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  examination_papers: {
    courseId: 'course_id', subjectId: 'subject_id', documentId: 'document_id', ownerUid: 'owner_id',
    examinationType: 'examination_type', examType: 'examination_type', departmentId: 'department_id',
    regulationId: 'regulation_id', semesterId: 'semester_id', academicYearId: 'academic_year_id',
    storageBucket: 'bucket_id', storagePath: 'object_path', fileType: 'file_type',
    fileSizeBytes: 'file_size_bytes', publicationStatus: 'publication_status',
    publishedAt: 'published_at', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  official_answer_keys: {
    courseId: 'course_id', subjectId: 'subject_id', documentId: 'document_id', ownerUid: 'owner_id',
    examinationPaperId: 'examination_paper_id', examinationType: 'examination_type',
    examType: 'examination_type', departmentId: 'department_id', regulationId: 'regulation_id',
    semesterId: 'semester_id', academicYearId: 'academic_year_id', storageBucket: 'bucket_id',
    storagePath: 'object_path', releaseAt: 'release_at', publicationStatus: 'publication_status',
    publishedAt: 'published_at', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  verified_subject_marks: {
    studentUid: 'student_id', courseId: 'course_id', subjectId: 'subject_id',
    academicYearId: 'academic_year_id', semesterId: 'semester_id', verifiedByUid: 'verified_by',
    verifiedAt: 'verified_at', score: 'marks', maximumScore: 'max_marks',
    examinationType: 'examination_type', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  semester_results: {
    studentUid: 'student_id', academicYearId: 'academic_year_id', semesterId: 'semester_id',
    semesterNumber: 'semester_number', totalCredits: 'total_credits', verifiedByUid: 'verified_by',
    verifiedAt: 'verified_at', creditsEarned: 'total_credits', resultStatus: 'result_status',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  assessments: {
    courseId: 'course_id', createdBy: 'created_by', durationMinutes: 'duration_minutes',
    passingScore: 'passing_score', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  assessment_questions: {
    assessmentId: 'assessment_id', questionKey: 'question_key', questionText: 'question_text',
    topicTag: 'topic_tag', codeSnippet: 'code_snippet', displayOrder: 'display_order',
    createdAt: 'created_at',
  },
  assessment_submissions: {
    assessmentId: 'assessment_id', courseId: 'course_id', studentUid: 'student_id',
    totalQuestions: 'total_questions', timeSpentSeconds: 'time_spent_seconds',
    submittedAt: 'submitted_at',
  },
  student_progress: {
    studentUid: 'student_id', courseId: 'course_id', topicId: 'topic_id',
    topicTitle: 'topic_title', masteryScore: 'mastery_score', totalAttempts: 'total_attempts',
    isCompleted: 'is_completed', lastStudiedAt: 'last_studied_at',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  engagement_events: {
    studentUid: 'student_id', courseId: 'course_id', eventType: 'event_type',
    durationMinutes: 'duration_minutes', createdAt: 'created_at',
  },
  learning_activity: {
    ownerUid: 'student_id', studentUid: 'student_id', courseId: 'course_id',
    assessmentId: 'assessment_id', activityType: 'activity_type',
    durationMinutes: 'duration_minutes', aiGenerated: 'ai_generated', createdAt: 'created_at',
  },
  recommendations: {
    studentUid: 'student_id', courseId: 'course_id', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  learning_path_nodes: {
    studentUid: 'student_id', courseId: 'course_id', sequenceNumber: 'sequence_number',
    masteryScore: 'mastery_score', estimatedMinutes: 'estimated_minutes',
    relatedResources: 'related_resources', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  tasks: {
    ownerUid: 'owner_id', studentUid: 'owner_id', courseId: 'course_id',
    taskType: 'task_type', dueAt: 'due_at', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  planner_sessions: {
    ownerUid: 'owner_id', studentUid: 'owner_id', courseId: 'course_id',
    startsAt: 'starts_at', durationMinutes: 'duration_minutes', sessionType: 'session_type',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  conversations: {
    ownerUid: 'owner_id', studentUid: 'owner_id', courseId: 'course_id',
    createdAt: 'created_at', updatedAt: 'updated_at',
  },
  messages: {
    conversationId: 'conversation_id', createdAt: 'created_at',
  },
  student_agent_records: {
    ownerUid: 'owner_id', studentUid: 'owner_id', courseId: 'course_id',
    recordType: 'record_type', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  documents: {
    ownerUid: 'owner_id', studentUid: 'owner_id', courseId: 'course_id',
    fileType: 'file_type', fileSizeBytes: 'file_size_bytes', storageBucket: 'bucket_id',
    storagePath: 'object_path', activeGeneration: 'active_generation',
    processingGeneration: 'processing_generation', createdAt: 'created_at', updatedAt: 'updated_at',
  },
  document_chunks: {
    documentId: 'document_id', courseId: 'course_id', generationId: 'generation_id',
    chunkIndex: 'chunk_index', pageNumber: 'page_number', embeddingModel: 'embedding_model',
    createdAt: 'created_at',
  },
};

const FOREIGN_TABLES = {
  course_id: 'courses',
  assessment_id: 'assessments',
  document_id: 'documents',
  subject_id: 'subjects',
  department_id: 'departments',
  branch_id: 'branches',
  regulation_id: 'regulations',
  academic_year_id: 'academic_years',
  semester_id: 'semesters',
  examination_paper_id: 'examination_papers',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;

function descriptorFor(collectionName) {
  const nestedConversation = /^student_agent\/([^/]+)\/conversations$/.exec(collectionName);
  if (nestedConversation) {
    return { table: 'conversations', forcedOwnerId: nestedConversation[1] };
  }
  const table = TABLES[collectionName];
  if (!table || !SELECT_COLUMNS[table] || !FIELD_COLUMNS[table]) {
    throw new TypeError(`Unsupported Supabase repository collection: ${collectionName}`);
  }
  return {
    table,
    taskCollection: collectionName === 'study_tasks' ? 'study_tasks' : collectionName === 'tasks' ? 'tasks' : null,
  };
}

function camelCase(value) {
  return value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function toApiRecord(table, row) {
  const record = { id: row.id };
  for (const column of SELECT_COLUMNS[table].split(',')) {
    if (column !== 'id' && Object.hasOwn(row, column)) {
      record[camelCase(column)] = row[column];
    }
  }
  for (const [field, column] of Object.entries(FIELD_COLUMNS[table] || {})) {
    if (Object.hasOwn(row, column)) record[field] = row[column];
  }
  if (table === 'profiles') {
    record.uid = row.id;
    record.name = row.full_name || '';
    record.displayName = row.full_name || '';
    record.role = row.role === 'faculty' ? 'instructor' : row.role;
    record.avatarUrl = row.avatar_url || '';
  }
  if (table === 'courses') {
    record.facultyUid = row.instructor_id || undefined;
    record.instructorUid = row.instructor_id || undefined;
  }
  if (table === 'tasks') record.legacyCollection = row.legacy_collection;
  if (table === 'document_chunks') {
    record.embeddingModel = row.embedding_model;
  }
  return record;
}

function serializeValue(value) {
  return value instanceof Date ? value.toISOString() : value;
}

async function resolveForeignId(client, column, value) {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;
  if (UUID_PATTERN.test(value)) return value;
  const foreignTable = FOREIGN_TABLES[column];
  if (!foreignTable) {
    throw new TypeError(`A UUID is required for ${column}.`);
  }
  const { data, error } = await client
    .from(foreignTable)
    .select('id')
    .eq('legacy_id', value)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error(`The referenced ${foreignTable} record was not found.`);
    notFound.status = 400;
    throw notFound;
  }
  return data.id;
}

async function dbRecord(client, table, record) {
  const result = {};
  const map = FIELD_COLUMNS[table];
  for (const [field, value] of Object.entries(record || {})) {
    if (field === 'id' || field === 'uid' || field === 'questions'
      || field === 'createdAt' || field === 'updatedAt'
      || field === 'created_at' || field === 'updated_at') continue;
    const column = map[field] || field;
    if (!SELECT_COLUMNS[table].split(',').includes(column)
      && !['owner_id', 'student_id', 'instructor_id', 'created_by', 'verified_by'].includes(column)) {
      continue;
    }
    if (table === 'documents' && ['status', 'visibility', 'published'].includes(column)) continue;
    if (column === 'role' && value === 'instructor') {
      result.role = 'faculty';
      continue;
    }
    if (FOREIGN_TABLES[column]) {
      result[column] = await resolveForeignId(client, column, value);
    } else {
      result[column] = serializeValue(value);
    }
  }
  return result;
}

function applyFilter(query, column, operator, value) {
  const operations = {
    '==': 'eq',
    '!=': 'neq',
    '>': 'gt',
    '>=': 'gte',
    '<': 'lt',
    '<=': 'lte',
  };
  const method = operations[operator];
  if (!method || typeof query[method] !== 'function') {
    throw new TypeError(`Unsupported Supabase filter operator: ${operator}`);
  }
  return query[method](column, serializeValue(value));
}

async function assessmentQuestions(client, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((row) => row.id);
  const { data: questions, error: questionError } = await client
    .from('assessment_questions')
    .select(SELECT_COLUMNS.assessment_questions)
    .in('assessment_id', ids)
    .order('display_order', { ascending: true });
  if (questionError) throw questionError;
  if (!questions?.length) {
    return rows.map((row) => ({ ...row, questions: [] }));
  }

  const { data: answerKeys, error: keyError } = await client
    .from('assessment_answer_keys')
    .select(SELECT_COLUMNS.assessment_answer_keys)
    .in('question_id', questions.map((question) => question.id));
  if (keyError) throw keyError;
  const keys = new Map((answerKeys || []).map((key) => [key.question_id, key]));
  const grouped = new Map(ids.map((id) => [id, []]));
  for (const question of questions) {
    const key = keys.get(question.id);
    grouped.get(question.assessment_id)?.push({
      id: question.question_key,
      questionText: question.question_text,
      options: question.options,
      topicTag: question.topic_tag,
      codeSnippet: question.code_snippet,
      ...(key ? {
        correctOptionIndex: key.correct_option_index,
        explanation: key.explanation,
      } : {}),
    });
  }
  return rows.map((row) => ({ ...row, questions: grouped.get(row.id) || [] }));
}

export async function getRecord(collectionName, id, suppliedClient) {
  const descriptor = descriptorFor(collectionName);
  const client = suppliedClient || getSupabaseRequestClient();
  if (typeof id !== 'string' || !id) return null;
  if (descriptor.table === 'profiles' && !UUID_PATTERN.test(id)) return null;

  let query = client.from(descriptor.table).select(SELECT_COLUMNS[descriptor.table]);
  if (UUID_PATTERN.test(id)) {
    query = query.eq('id', id);
  } else {
    query = query.eq('legacy_id', id);
  }
  if (descriptor.taskCollection) query = query.eq('legacy_collection', descriptor.taskCollection);
  if (descriptor.forcedOwnerId) query = query.eq('owner_id', descriptor.forcedOwnerId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [record] = descriptor.table === 'assessments'
    ? await assessmentQuestions(client, [data])
    : [data];
  return toApiRecord(descriptor.table, record);
}

export async function listRecords(collectionName, {
  filters = [],
  orderField,
  direction = 'asc',
  limit = 500,
  client: suppliedClient,
} = {}) {
  const descriptor = descriptorFor(collectionName);
  const client = suppliedClient || getSupabaseRequestClient();
  const table = descriptor.table;
  const fieldMap = FIELD_COLUMNS[table];
  const resolvedFilters = [];
  for (const [field, operator, value] of filters) {
    const column = fieldMap[field] || field;
    if (!SELECT_COLUMNS[table].split(',').includes(column)
      && !['owner_id', 'student_id', 'instructor_id', 'created_by', 'verified_by'].includes(column)) {
      throw new TypeError(`Unsupported Supabase filter field ${field} for ${table}.`);
    }
    let resolvedValue = value;
    if (operator === '==' && FOREIGN_TABLES[column]) {
      resolvedValue = await resolveForeignId(client, column, value);
    }
    resolvedFilters.push([column, operator, resolvedValue]);
  }
  const orderColumn = orderField ? fieldMap[orderField] || orderField : null;
  if (orderColumn && !SELECT_COLUMNS[table].split(',').includes(orderColumn)) {
    throw new TypeError(`Unsupported Supabase order field ${orderField} for ${table}.`);
  }
  const requestedLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, 10000)
    : PAGE_SIZE;
  const records = [];

  for (let offset = 0; offset < requestedLimit; offset += PAGE_SIZE) {
    let query = client.from(table).select(SELECT_COLUMNS[table]);
    if (descriptor.taskCollection) {
      query = query.eq('legacy_collection', descriptor.taskCollection);
    }
    if (descriptor.forcedOwnerId) {
      query = query.eq('owner_id', descriptor.forcedOwnerId);
    }
    for (const [column, operator, value] of resolvedFilters) {
      query = applyFilter(query, column, operator, value);
    }
    if (orderColumn) query = query.order(orderColumn, { ascending: direction !== 'desc' });
    const pageLimit = Math.min(PAGE_SIZE, requestedLimit - offset);
    const { data, error } = await query.range(offset, offset + pageLimit - 1);
    if (error) throw error;
    const page = data || [];
    records.push(...page);
    if (page.length < pageLimit) break;
  }

  const enriched = table === 'assessments'
    ? await assessmentQuestions(client, records)
    : records;
  return enriched.map((row) => toApiRecord(table, row));
}

export async function createRecord(collectionName, record, id, suppliedClient) {
  const descriptor = descriptorFor(collectionName);
  const client = suppliedClient || getSupabaseRequestClient();
  const table = descriptor.table;
  if (table === 'assessments') {
    const data = record || {};
    const { data: createdId, error } = await client.rpc('publish_assessment', {
      target_course_id: await resolveForeignId(client, 'course_id', data.courseId),
      assessment_title: data.title,
      assessment_topic: data.topic || '',
      assessment_difficulty: data.difficulty || 'Intermediate',
      assessment_duration_minutes: data.durationMinutes || 0,
      assessment_passing_score: data.passingScore ?? 70,
      question_payload: data.questions || [],
    });
    if (error) throw error;
    const created = await getRecord('assessments', createdId, client);
    if (!created) throw new Error('The published assessment could not be loaded.');
    return created;
  }

  const values = await dbRecord(client, table, record);
  if (descriptor.taskCollection) values.legacy_collection = descriptor.taskCollection;
  if (id && UUID_PATTERN.test(String(id))) values.id = id;
  if (descriptor.forcedOwnerId) values.owner_id = descriptor.forcedOwnerId;
  const { data, error } = await client
    .from(table)
    .insert(values)
    .select(SELECT_COLUMNS[table])
    .single();
  if (error) throw error;
  return toApiRecord(table, data);
}

export async function updateRecord(collectionName, id, patch, suppliedClient) {
  const descriptor = descriptorFor(collectionName);
  const client = suppliedClient || getSupabaseRequestClient();
  if (typeof id !== 'string' || !id) {
    const invalidId = new TypeError('A record ID is required.');
    invalidId.status = 400;
    throw invalidId;
  }
  if (descriptor.table === 'profiles' && !UUID_PATTERN.test(id)) {
    const notFound = new Error('Record was not found or is not accessible.');
    notFound.status = 404;
    throw notFound;
  }
  const values = await dbRecord(client, descriptor.table, patch);
  let query = client.from(descriptor.table).update(values);
  query = UUID_PATTERN.test(id) ? query.eq('id', id) : query.eq('legacy_id', id);
  if (descriptor.taskCollection) query = query.eq('legacy_collection', descriptor.taskCollection);
  if (descriptor.forcedOwnerId) query = query.eq('owner_id', descriptor.forcedOwnerId);
  const { data, error } = await query.select(SELECT_COLUMNS[descriptor.table]).maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Record was not found or is not accessible.');
    notFound.status = 404;
    throw notFound;
  }
  return toApiRecord(descriptor.table, data);
}

export async function deleteRecord(collectionName, id, suppliedClient) {
  const descriptor = descriptorFor(collectionName);
  const client = suppliedClient || getSupabaseRequestClient();
  if (typeof id !== 'string' || !id) {
    const invalidId = new TypeError('A record ID is required.');
    invalidId.status = 400;
    throw invalidId;
  }
  if (descriptor.table === 'profiles' && !UUID_PATTERN.test(id)) return;
  let query = client.from(descriptor.table).delete();
  query = UUID_PATTERN.test(id) ? query.eq('id', id) : query.eq('legacy_id', id);
  if (descriptor.taskCollection) query = query.eq('legacy_collection', descriptor.taskCollection);
  if (descriptor.forcedOwnerId) query = query.eq('owner_id', descriptor.forcedOwnerId);
  const { error } = await query;
  if (error) throw error;
}

export async function canAccessCourse(user, courseId, suppliedClient) {
  const client = suppliedClient || (
    user.role === 'admin' ? getAdminSupabaseClient() : getSupabaseRequestClient()
  );
  const course = await getRecord('courses', courseId, client);
  if (!course) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'instructor') {
    return course.facultyUid === user.id || course.instructorUid === user.id;
  }
  if (user.role !== 'student') return false;
  const enrollments = await listRecords('enrollments', {
    filters: [['courseId', '==', courseId], ['studentUid', '==', user.id]],
    limit: 1000,
    client,
  });
  return enrollments.some((enrollment) =>
    ['active', 'enrolled'].includes(String(enrollment.status || '').toLowerCase()));
}

export async function requireCourseAccess(user, courseId, client) {
  if (!await canAccessCourse(user, courseId, client)) {
    const error = new Error('Course not found or unavailable to this account.');
    error.status = 404;
    throw error;
  }
}

export function getTableName(collectionName) {
  return descriptorFor(collectionName).table;
}
