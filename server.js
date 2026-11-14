import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, timingSafeEqual } from 'crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authenticateSupabaseToken,
  getAdminSupabaseClient,
  isSupabaseSchemaUnavailable,
  isSupabaseConfigured,
  provisionSupabaseProfile,
  getSupabaseRequestClient,
  runWithSupabaseRequestClient,
  writeAuditLog,
} from './server/supabase.js';
import { proxyAgentRequest } from './server/ai-proxy.js';
import { handleApiRequest } from './server/api.js';
import {
  prepareBranchCourseEnrollments,
  prepareCourseStudentEnrollments,
  saveBranchCourseEnrollments,
} from './server/branch-enrollment.js';

const app = express();
const port = Number(process.env.PORT || 8000);
const frontendBuildPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const facultyInviteCode = process.env.FACULTY_INVITE_CODE?.trim() || '';
const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
}
app.set('trust proxy', trustedProxyHops);
if (DEMO_MODE && process.env.NODE_ENV === 'production') {
  throw new Error('DEMO_MODE cannot be enabled in production.');
}
if (process.env.NODE_ENV === 'production' && !existsSync(path.join(frontendBuildPath, 'index.html'))) {
  throw new Error('The production frontend build is missing. Run npm run build before starting the server.');
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const configuredOrigins = process.env.CORS_ORIGINS
  || 'http://localhost:3000,http://127.0.0.1:3000';
const developmentOrigins = process.env.NODE_ENV === 'production'
  ? []
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3003', 'http://127.0.0.1:3003'];
const allowedOrigins = new Set([...configuredOrigins.split(','), ...developmentOrigins]
  .map((origin) => origin.trim())
  .filter(Boolean));
const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many requests. Please try again later.' },
});
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many authentication attempts. Please try again later.' },
});
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many upload attempts. Please try again later.' },
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
}));
app.use('/api/v1', (req, res, next) => {
  const suppliedId = req.get('x-request-id');
  req.requestId = suppliedId && /^[A-Za-z0-9._-]{1,128}$/.test(suppliedId)
    ? suppliedId
    : randomUUID();
  res.set('X-Request-ID', req.requestId);
  next();
});
app.use('/api/v1', apiRateLimit);
app.use(express.json({ limit: '2mb' }));

const DEMO_USERS = {
  'a.chen@university.edu': {
    role: 'student',
    password: 'AcademicPass2026!',
    user: {
      id: 'usr_student_alex_01',
      name: 'Alex Chen',
      email: 'a.chen@university.edu',
      role: 'student',
      avatarUrl: '/src/assets/images/avatar_student_alex_1791648182699.jpg',
      department: 'Computer Science & Software Engineering',
      studentId: 'CS-2027-8492',
      enrolledSince: 'Fall 2024',
    },
  },
  'elena.rostova@university.edu': {
    role: 'instructor',
    password: 'FacultyPass2026!',
    user: {
      id: 'usr_inst_elena_02',
      name: 'Dr. Elena Rostova',
      email: 'elena.rostova@university.edu',
      role: 'instructor',
      avatarUrl: '/src/assets/images/avatar_professor_elena_1791648194876.jpg',
      department: 'Faculty of Computer Science',
      enrolledSince: 'Fall 2019',
    },
  },
};

const sessions = new Map();

const courseCatalog = [
  {
    id: 'course_cs201',
    code: 'CS 201',
    title: 'Data Structures & Algorithms',
    description: 'Fundamental abstractions, asymptotic runtime analysis, tree structures, balanced search trees, graph traversals, and dynamic programming.',
    instructor: 'Dr. Elena Rostova',
    credits: 4,
    progress: 68,
    enrolledStudents: 142,
    topicsCount: 8,
    materialsCount: 6,
    lastStudied: 'Yesterday, 4:20 PM',
    nextTopic: 'AVL Tree Rotations & Balance Invariants',
    topics: [
      { id: 'top_1', courseId: 'course_cs201', title: 'Asymptotic Analysis & Big-O Notation', order: 1, isCompleted: true, masteryScore: 92, prerequisites: [], estimatedMinutes: 45, resourcesCount: 3 },
      { id: 'top_2', courseId: 'course_cs201', title: 'Dynamic Arrays & Linked Lists', order: 2, isCompleted: true, masteryScore: 88, prerequisites: ['top_1'], estimatedMinutes: 60, resourcesCount: 2 },
      { id: 'top_3', courseId: 'course_cs201', title: 'Stacks, Queues, & Deques', order: 3, isCompleted: true, masteryScore: 95, prerequisites: ['top_2'], estimatedMinutes: 50, resourcesCount: 2 },
      { id: 'top_4', courseId: 'course_cs201', title: 'Binary Search Trees & Traversal Orders', order: 4, isCompleted: true, masteryScore: 81, prerequisites: ['top_3'], estimatedMinutes: 65, resourcesCount: 4 },
      { id: 'top_5', courseId: 'course_cs201', title: 'AVL Trees & Self-Balancing Invariants', order: 5, isCompleted: false, masteryScore: 48, prerequisites: ['top_4'], estimatedMinutes: 90, resourcesCount: 3 },
    ],
  },
  {
    id: 'course_cs305',
    code: 'CS 305',
    title: 'Computer Systems & Architecture',
    description: 'Hardware-software interface, virtual memory, cache hierarchy, pipelining, race conditions, POSIX threads, and memory models.',
    instructor: 'Prof. Marcus Vance',
    credits: 4,
    progress: 44,
    enrolledStudents: 98,
    topicsCount: 6,
    materialsCount: 4,
    lastStudied: '3 days ago',
    nextTopic: 'Direct-Mapped vs Set-Associative Caching',
    topics: [
      { id: 'top_sys1', courseId: 'course_cs305', title: 'Bit Manipulation & Floating Point Representation', order: 1, isCompleted: true, masteryScore: 84, prerequisites: [], estimatedMinutes: 55, resourcesCount: 2 },
      { id: 'top_sys2', courseId: 'course_cs305', title: 'x86-64 Machine-Level Assembly Calling Conventions', order: 2, isCompleted: true, masteryScore: 76, prerequisites: ['top_sys1'], estimatedMinutes: 80, resourcesCount: 3 },
      { id: 'top_sys3', courseId: 'course_cs305', title: 'Cache Memory Hierarchy & Locality of Reference', order: 3, isCompleted: false, masteryScore: 52, prerequisites: ['top_sys2'], estimatedMinutes: 95, resourcesCount: 4 },
    ],
  },
];

const defaultDocuments = [
  {
    id: 'doc_1',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'Lecture-06-Self-Balancing-Binary-Trees.pdf',
    fileType: 'pdf',
    fileSize: '3.4 MB',
    pages: 38,
    status: 'UPLOADED',
    uploadedAt: 'Oct 6, 2026',
    chunksCount: 0,
    vectorStatus: 'Demo sample metadata only; storage and document processing are unavailable.',
    ownerId: 'usr_student_alex_01',
  },
];

const assessments = [
  {
    id: 'asmt_avl_01',
    courseId: 'course_cs201',
    courseCode: 'CS 201',
    title: 'AVL Trees Fundamentals',
    topic: 'AVL Balancing',
    difficulty: 'Intermediate',
    questionCount: 3,
    durationMinutes: 15,
    passingScore: 70,
    attemptsCount: 0,
    questions: [
      {
        id: 'q1',
        questionText: 'Which condition defines an AVL tree imbalance?',
        options: ['|hL - hR| >= 1', '|hL - hR| >= 2', 'height(root) <= 10', 'left subtree empty'],
        correctOptionIndex: 1,
        explanation: 'AVL trees require the balance factor to stay within -1, 0, 1. A difference of 2 triggers rebalancing.',
        topicTag: 'AVL Trees',
      },
      {
        id: 'q2',
        questionText: 'Which rotation repairs an LR imbalance?',
        options: ['Single left rotation', 'Single right rotation', 'Double left-right rotation', 'Double right-left rotation'],
        correctOptionIndex: 2,
        explanation: 'An LR imbalance requires a left rotation on the left child followed by a right rotation at the ancestor.',
        topicTag: 'AVL Trees',
      },
      {
        id: 'q3',
        questionText: 'Which balance factors are permitted at every node of an AVL tree?',
        options: ['-2, -1, 0', '-1, 0, 1', '0, 1, 2', 'Any integer'],
        correctOptionIndex: 1,
        explanation: 'AVL nodes must have a balance factor of -1, 0, or 1 to satisfy the height-balance invariant.',
        topicTag: 'AVL Trees',
      },
    ],
  },
];

const chatSessions = [{
  id: 'session_01',
  ownerId: 'usr_student_alex_01',
  title: 'AVL balancing',
  courseId: 'course_cs201',
  courseCode: 'CS 201',
  createdAt: 'Just now',
  updatedAt: 'Just now',
  messageCount: 0,
}];

const chatMessages = {
  session_01: [],
};

const recommendations = [
  { id: 'rec_1', topic: 'AVL rotation proof drills', courseId: 'course_cs201', courseCode: 'CS 201', courseTitle: 'Data Structures & Algorithms', reason: 'Your recent quiz showed uneven balance-factor confidence.', estimatedMinutes: 25, priority: 'high', type: 'practice' },
];

const analytics = {
  averageScore: 86,
  assessmentsCompleted: 4,
  enrolledCoursesCount: 3,
  conceptsMasteredCount: 12,
  totalConceptsCount: 14,
  weeklyActivity: [
    { day: 'Mon', date: '2026-10-05', minutes: 55, eventsCount: 3 },
    { day: 'Tue', date: '2026-10-06', minutes: 90, eventsCount: 4 },
  ],
  scoreProgression: [
    { date: '2026-09-28', score: 83, assessmentTitle: 'Trees Diagnostic' },
    { date: '2026-10-04', score: 89, assessmentTitle: 'Binary Search Tree Quiz' },
  ],
  weakTopics: [],
  conceptMasteryList: [],
};

const learningPath = [
  {
    id: 'lp_1',
    title: 'Review balance factors',
    sequenceNumber: 1,
    status: 'in_progress',
    masteryScore: 48,
    prerequisites: [],
    estimatedMinutes: 30,
    relatedResources: ['Lecture-06-Self-Balancing-Binary-Trees.pdf'],
    whyNextReason: 'Review balance-factor invariants before practicing AVL rotations.',
    practicePrompt: 'Explain how a balance factor identifies an AVL tree imbalance.',
  },
  {
    id: 'lp_2',
    title: 'Practice AVL rotations',
    sequenceNumber: 2,
    status: 'locked',
    prerequisites: ['lp_1'],
    estimatedMinutes: 45,
    relatedResources: [],
    whyNextReason: 'Practice rotations after reviewing balance-factor invariants.',
    practicePrompt: 'Identify the rotation needed for an LR imbalance.',
  },
];

const plannerSessions = [
  { id: 'plan_sess_1', ownerId: 'usr_student_alex_01', courseId: 'course_cs201', courseCode: 'CS 201', title: 'AVL revision sprint', date: '2026-10-14', startTime: '17:00', durationMinutes: 60, completed: false, notes: 'Review LR/RL rotation cases.', type: 'review' },
];
const studyTasks = [
  { id: 'task_1', ownerId: 'usr_student_alex_01', courseId: 'course_cs201', courseCode: 'CS 201', title: 'Quiz 4: AVL Tree Balance & Rotations', dueDate: 'Tomorrow', dueTime: '11:59 PM', type: 'quiz', completed: false, priority: 'high' },
  { id: 'task_2', ownerId: 'usr_student_alex_01', courseId: 'course_cs305', courseCode: 'CS 305', title: 'Review cache locality', dueDate: 'In 3 days', dueTime: '5:00 PM', type: 'review', completed: false, priority: 'medium' },
];

function buildUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    department: user.department,
    institutionId: user.institutionId || '',
    studentId: user.studentId,
    enrolledSince: user.enrolledSince,
  };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ detail: 'A valid bearer access token is required.' });
  }
  if (DEMO_MODE) {
    const demoUser = sessions.get(token);
    if (!demoUser) return res.status(401).json({ detail: 'The demo session is invalid or has expired.' });
    req.user = demoUser;
    req.isDemoSession = true;
    return next();
  }
  if (isSupabaseConfigured()) {
    void (async () => {
      try {
        const authenticated = await authenticateSupabaseToken(token);
        if (!authenticated) {
          return res.status(403).json({
            detail: 'No trusted application profile exists for this account.',
            code: 'APP_PROFILE_MISSING',
          });
        }
        if (authenticated.user.isApproved === false) {
          return res.status(403).json({
            detail: 'This account is awaiting administrator approval.',
            code: 'ACCOUNT_NOT_APPROVED',
          });
        }
        req.user = authenticated.user;
        if (req.user.role === 'admin') {
          const institutionContext = await getInstitutionSetupContext(req.user.id);
          req.user = await activateSingleAdminInstitution(req.user, institutionContext);
        }
        req.authSource = 'supabase';
        return runWithSupabaseRequestClient(authenticated.client, next);
      } catch (error) {
        const status = Number(error?.status);
        const code = typeof error?.code === 'string' ? error.code : 'auth_error';
        console.error('Supabase authentication request failed:', code);
        if (status >= 500 || !status) {
          return res.status(503).json({ detail: 'Supabase authentication is temporarily unavailable.' });
        }
        if (status === 403 || status === 409) {
          return res.status(status).json({ detail: error.message });
        }
        return res.status(401).json({ detail: 'The Supabase access token is invalid or expired.' });
      }
    })().catch((error) => {
      console.error('Supabase authentication request failed:', error?.code || 'auth_error');
      if (!res.headersSent) res.status(503).json({ detail: 'Supabase authentication is temporarily unavailable.' });
    });
    return;
  }
  return res.status(503).json({ detail: 'Supabase Authentication is not configured on this server.' });
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ detail: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getInstitutionSetupContext(userId) {
  const client = getAdminSupabaseClient();
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id,role,institution_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.role !== 'admin') return { profile: null, institutions: [] };

  const results = await Promise.all([
    client.from('institutions').select('id,name,code,created_by').eq('created_by', userId),
    client.from('institution_admins').select('institution_id').eq('profile_id', userId),
  ]);
  for (const result of results) {
    if (result.error) throw result.error;
  }
  const created = results[0].data || [];
  const administeredIds = results[1].data?.map((row) => row.institution_id) || [];
  const institutions = [...created];
  if (administeredIds.length) {
    const { data, error } = await client
      .from('institutions')
      .select('id,name,code,created_by')
      .in('id', administeredIds);
    if (error) throw error;
    for (const institution of data || []) {
      if (!institutions.some((item) => item.id === institution.id)) institutions.push(institution);
    }
  }
  return { profile, institutions };
}

function requireInstitutionSetupAccess(context, institutionId) {
  return context.institutions.some((institution) => institution.id === institutionId);
}

function resolveAdminInstitutionId(context, preferredInstitutionId) {
  if (preferredInstitutionId) {
    if (!requireInstitutionSetupAccess(context, preferredInstitutionId)) {
      throw Object.assign(new Error('This administrator is not authorized to manage that institution.'), { status: 403 });
    }
    return preferredInstitutionId;
  }
  if (context.institutions.length === 1) return context.institutions[0].id;
  if (context.institutions.length > 1) {
    throw Object.assign(new Error('This administrator manages multiple institutions; contact the platform owner to set the active institution.'), { status: 409 });
  }
  return null;
}

async function activateSingleAdminInstitution(user, context) {
  const institutionId = resolveAdminInstitutionId(context, user.institutionId);
  if (!institutionId) return user;
  if (!context.profile.institution_id) {
    const client = getAdminSupabaseClient();
    const { error: grantError } = await client.from('institution_admins').upsert({
      institution_id: institutionId,
      profile_id: user.id,
      granted_by: user.id,
    }, { onConflict: 'institution_id,profile_id' });
    if (grantError) throw grantError;
    const { data, error } = await client.from('profiles')
      .update({ institution_id: institutionId })
      .eq('id', user.id)
      .is('institution_id', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: current, error: currentError } = await client.from('profiles')
        .select('institution_id').eq('id', user.id).maybeSingle();
      if (currentError) throw currentError;
      if (current?.institution_id !== institutionId) {
        throw Object.assign(new Error('The administrator institution assignment changed. Refresh and retry.'), { status: 409 });
      }
    }
    await writeAuditLog({
      institutionId,
      actorId: user.id,
      action: 'administrator_assigned_to_owned_institution',
      entityType: 'profile',
      entityId: user.id,
      details: {},
    });
  }
  return { ...user, institutionId };
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get('/api/v1/health', asyncRoute(async (_req, res) => {
  let supabaseConnected = false;
  let supabaseErrorCode;
  if (isSupabaseConfigured()) {
    const { error } = await getAdminSupabaseClient().from('profiles').select('id').limit(1);
    supabaseConnected = !error;
    supabaseErrorCode = error?.code;
  }
  res.status(isSupabaseConfigured() && supabaseConnected ? 200 : 503).json({
    status: isSupabaseConfigured() && supabaseConnected ? 'ok' : 'degraded',
    service: 'student-agent-ai',
    demo_mode: DEMO_MODE,
    supabase_configured: isSupabaseConfigured(),
    supabase_connected: supabaseConnected,
    ...(supabaseErrorCode ? { supabase_error_code: supabaseErrorCode } : {}),
    timestamp: new Date().toISOString(),
  });
}));

app.post('/api/v1/auth/login', authRateLimit, (req, res) => {
  const { email, password, role } = req.body || {};

  if (!DEMO_MODE) {
    return res.status(410).json({ detail: 'Use Supabase Authentication from the frontend; server-side password login is disabled.' });
  }
  if (!email || !password || !role) {
    return res.status(400).json({ detail: 'Email, password, and role are required.' });
  }

  const known = DEMO_USERS[String(email).trim().toLowerCase()];
  if (!known || known.role !== role || known.password !== password) {
    return res.status(401).json({ detail: 'Invalid academic credentials for the selected portal.' });
  }

  const token = randomUUID();
  sessions.set(token, { ...known.user, token });
  return res.json({ token, user: buildUserPayload(known.user) });
});

function validFacultyInvite(candidate) {
  if (!facultyInviteCode || typeof candidate !== 'string' || candidate.length > 256) return false;
  const expected = Buffer.from(facultyInviteCode);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

app.post('/api/v1/auth/faculty-invite/validate', authRateLimit, (req, res) => {
  if (!facultyInviteCode) {
    return res.status(503).json({ detail: 'Faculty invitations are not configured on this server.' });
  }
  if (!validFacultyInvite(req.body?.inviteCode)) {
    return res.status(403).json({ detail: 'The faculty invite code is invalid.' });
  }
  return res.json({ valid: true });
});

app.post('/api/v1/auth/provision', authRateLimit, asyncRoute(async (req, res) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ detail: 'A bearer access token is required.' });
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
  if (!fullName || fullName.length > 120) {
    return res.status(400).json({ detail: 'A name between 1 and 120 characters is required.' });
  }
  const requestedRole = req.body?.role ?? 'student';
  if (!['student', 'instructor'].includes(requestedRole)) {
    return res.status(400).json({ detail: 'Unsupported account role.' });
  }

  if (isSupabaseConfigured()) {
    try {
      const authenticated = await authenticateSupabaseToken(token);
      if (!authenticated) {
        return res.status(503).json({ detail: 'The Supabase profile trigger has not provisioned this account yet.' });
      }
      if (requestedRole === 'student' && authenticated.user.role !== 'student') {
        return res.status(403).json({ detail: 'Public registration is limited to student accounts.' });
      }
      if (requestedRole === 'instructor') {
        if (authenticated.user.role === 'instructor') {
          return res.status(200).json(buildUserPayload(authenticated.user));
        }
        if (authenticated.requestedRole !== 'faculty') {
          return res.status(403).json({ detail: 'This account did not request faculty access.' });
        }
        if (!validFacultyInvite(req.body?.facultyInviteCode)) {
          return res.status(403).json({
            detail: 'A valid faculty invite code is required to enable faculty access.',
            code: 'FACULTY_INVITE_REQUIRED',
          });
        }
        await provisionSupabaseProfile(authenticated.user.id, 'faculty');
        return res.status(200).json(buildUserPayload({
          ...authenticated.user,
          role: 'instructor',
          name: fullName,
        }));
      }
      return res.status(201).json(buildUserPayload(authenticated.user));
    } catch (error) {
      console.error('Supabase profile provisioning check failed:', error?.code || 'profile_error');
      return res.status(503).json({ detail: 'The Supabase profile could not be loaded.' });
    }
  }

  return res.status(503).json({ detail: 'Supabase Authentication is not configured on this server.' });
}));

app.get('/api/v1/me', requireAuth, (req, res) => {
  res.json(buildUserPayload(req.user));
});

app.get('/api/v1/me/notifications', requireAuth, asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const { data, error } = await getSupabaseRequestClient()
    .from('notifications')
    .select('id,type,title,body,entity_type,entity_id,read_at,created_at')
    .eq('recipient_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return res.json(data || []);
}));

app.patch('/api/v1/me/notifications/:notificationId', requireAuth, asyncRoute(async (req, res) => {
  if (!UUID_PATTERN.test(req.params.notificationId)) {
    return res.status(400).json({ detail: 'A valid notification is required.' });
  }
  const { data, error } = await getSupabaseRequestClient()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', req.params.notificationId)
    .eq('recipient_id', req.user.id)
    .select('id,read_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ detail: 'Notification not found.' });
  return res.json(data);
}));

app.post('/api/v1/me/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  const { error } = await getSupabaseRequestClient()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', req.user.id)
    .is('read_at', null);
  if (error) throw error;
  return res.json({ success: true });
}));

app.get('/api/v1/admin/institutions/setup', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const context = await getInstitutionSetupContext(req.user.id);
  const institutionId = resolveAdminInstitutionId(context, req.user.institutionId);
  return res.json({
    institutionId,
    institutions: context.institutions.map(({ id, name, code, created_by: createdBy }) => ({
      id, name, code, createdBy,
    })),
    canCreateInstitution: !context.profile?.institution_id,
  });
}));

app.get('/api/v1/admin/overview', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const context = await getInstitutionSetupContext(req.user.id);
  const institutionId = resolveAdminInstitutionId(context, req.user.institutionId);
  if (!institutionId) {
    return res.status(403).json({ detail: 'Assign this administrator to an institution first.' });
  }
  const client = getAdminSupabaseClient();
  const [{ count: students, error: studentsError }, { count: faculty, error: facultyError },
    { count: departments, error: departmentsError }, { data: courseRows, count: courses, error: coursesError }] = await Promise.all([
    client.from('profiles').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).eq('role', 'student'),
    client.from('profiles').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).eq('role', 'faculty'),
    client.from('departments').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
    client.from('courses').select('id', { count: 'exact' }).eq('institution_id', institutionId),
  ]);
  const failed = [studentsError, facultyError, departmentsError, coursesError].find(Boolean);
  if (failed) throw failed;
  const courseIds = (courseRows || []).map((course) => course.id);
  let enrollments = 0;
  if (courseIds.length) {
    const enrollmentResult = await client.from('enrollments')
      .select('id', { count: 'exact', head: true }).in('course_id', courseIds).eq('status', 'active');
    if (enrollmentResult.error) throw enrollmentResult.error;
    enrollments = enrollmentResult.count || 0;
  }
  return res.json({
    students: students || 0,
    faculty: faculty || 0,
    departments: departments || 0,
    courses: courses || 0,
    activeEnrollments: enrollments || 0,
  });
}));

app.post('/api/v1/admin/institutions', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 200 || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)) {
    return res.status(400).json({ detail: 'Institution name and a valid unique code are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (context.profile?.institution_id || context.institutions.length > 0) {
    return res.status(403).json({ detail: 'This administrator already has an institution setup in progress.' });
  }
  const { data, error } = await getAdminSupabaseClient()
    .from('institutions')
    .insert({ name, code, created_by: req.user.id })
    .select('id,name,code,created_by')
    .single();
  if (error) throw error;
  await writeAuditLog({
    institutionId: data.id,
    actorId: req.user.id,
    action: 'institution_created',
    entityType: 'institution',
    entityId: data.id,
    details: { code: data.code },
  });
  return res.status(201).json({
    id: data.id,
    name: data.name,
    code: data.code,
    createdBy: data.created_by,
    assigned: false,
  });
}));

app.get('/api/v1/admin/institutions/:institutionId/unassigned-users', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId } = req.params;
  if (!UUID_PATTERN.test(institutionId)) return res.status(400).json({ detail: 'A valid institution is required.' });
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to configure this institution.' });
  }
  const { data, error } = await getAdminSupabaseClient()
    .from('profiles')
    .select('id,email,role')
    .is('institution_id', null)
    .in('role', ['student', 'faculty', 'admin'])
    .order('email');
  if (error) throw error;
  return res.json((data || []).map(({ id, email, role }) => ({ id, email, role })));
}));

app.get('/api/v1/admin/institutions/:institutionId/students', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId } = req.params;
  if (!UUID_PATTERN.test(institutionId)) return res.status(400).json({ detail: 'A valid institution is required.' });
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to review students in this institution.' });
  }
  const { data, error } = await getAdminSupabaseClient()
    .from('profiles')
    .select('id,email,is_approved,branch_id')
    .eq('institution_id', institutionId)
    .eq('role', 'student')
    .order('email');
  if (error) throw error;
  return res.json((data || []).map(({ id, email, is_approved: isApproved, branch_id: branchId }) => ({
    id,
    email,
    isApproved: typeof isApproved === 'boolean' ? isApproved : null,
    branchId,
  })));
}));

app.get('/api/v1/admin/institutions/:institutionId/academic-structure', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId } = req.params;
  if (!UUID_PATTERN.test(institutionId)) return res.status(400).json({ detail: 'A valid institution is required.' });
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to manage academic structure for this institution.' });
  }
  const client = getAdminSupabaseClient();
  const { data: departments, error: departmentsError } = await client
    .from('departments').select('id,code,name').eq('institution_id', institutionId).order('name');
  if (departmentsError) throw departmentsError;
  const departmentIds = (departments || []).map((department) => department.id);
  let branches = [];
  if (departmentIds.length) {
    const { data, error } = await client.from('branches')
      .select('id,department_id,code,name').in('department_id', departmentIds).order('code');
    if (error) throw error;
    branches = data || [];
  }
  return res.json({
    departments: departments || [],
    branches,
  });
}));

app.post('/api/v1/admin/institutions/:institutionId/departments', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId } = req.params;
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!UUID_PATTERN.test(institutionId) || !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)
      || !name || name.length > 200) {
    return res.status(400).json({ detail: 'A valid department code and name are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to create departments for this institution.' });
  }
  const client = getAdminSupabaseClient();
  const { data: existing, error: lookupError } = await client.from('departments')
    .select('id').eq('institution_id', institutionId).eq('code', code).limit(1);
  if (lookupError) throw lookupError;
  if (existing?.length) return res.status(409).json({ detail: 'A department with this code already exists.' });
  const { data: department, error } = await client.from('departments')
    .insert({ institution_id: institutionId, code, name })
    .select('id,code,name').single();
  if (error) throw error;
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'department_created',
    entityType: 'department',
    entityId: department.id,
    details: { code },
  });
  return res.status(201).json(department);
}));

app.post('/api/v1/admin/institutions/:institutionId/departments/:departmentId/branches', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId, departmentId } = req.params;
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (![institutionId, departmentId].every((id) => UUID_PATTERN.test(id || ''))
      || !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code) || !name || name.length > 200) {
    return res.status(400).json({ detail: 'A valid department, branch code, and branch name are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to create branches for this institution.' });
  }
  const client = getAdminSupabaseClient();
  const { data: department, error: departmentError } = await client.from('departments')
    .select('id').eq('id', departmentId).eq('institution_id', institutionId).maybeSingle();
  if (departmentError) throw departmentError;
  if (!department) return res.status(404).json({ detail: 'Department not found in this institution.' });
  const { data: existing, error: lookupError } = await client.from('branches')
    .select('id').eq('department_id', departmentId).eq('code', code).limit(1);
  if (lookupError) throw lookupError;
  if (existing?.length) return res.status(409).json({ detail: 'A branch with this code already exists in the department.' });
  const { data: branch, error } = await client.from('branches')
    .insert({ department_id: departmentId, code, name })
    .select('id,department_id,code,name').single();
  if (error) throw error;
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'branch_created',
    entityType: 'branch',
    entityId: branch.id,
    details: { departmentId, code },
  });
  return res.status(201).json(branch);
}));

app.post('/api/v1/admin/institutions/:institutionId/students/:profileId/branch', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId, profileId } = req.params;
  const branchId = req.body?.branchId;
  if (![institutionId, profileId, branchId].every((id) => UUID_PATTERN.test(id || ''))) {
    return res.status(400).json({ detail: 'Valid institution, student, and branch identifiers are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to assign students in this institution.' });
  }
  const client = getAdminSupabaseClient();
  const [{ data: student, error: studentError }, { data: branch, error: branchError }] = await Promise.all([
    client.from('profiles').select('id,role,institution_id').eq('id', profileId).maybeSingle(),
    client.from('branches').select('id,department_id,code').eq('id', branchId).maybeSingle(),
  ]);
  if (studentError) throw studentError;
  if (branchError) throw branchError;
  if (!student || student.role !== 'student' || student.institution_id !== institutionId) {
    return res.status(404).json({ detail: 'Student not found in this institution.' });
  }
  if (!branch) return res.status(404).json({ detail: 'The selected branch was not found.' });
  const { data: department, error: departmentError } = await client.from('departments')
    .select('id,institution_id').eq('id', branch.department_id).maybeSingle();
  if (departmentError) throw departmentError;
  if (!department || department.institution_id !== institutionId) {
    return res.status(404).json({ detail: 'The selected branch is not part of this institution.' });
  }
  const enrollmentPlan = await prepareBranchCourseEnrollments(client, {
    institutionId,
    branchId,
    studentIds: [profileId],
  });
  const { data, error } = await client.from('profiles')
    .update({ department_id: department.id, branch_id: branchId })
    .eq('id', profileId)
    .eq('institution_id', institutionId)
    .eq('role', 'student')
    .select('id,branch_id').single();
  if (error) throw error;
  let enrolledCount;
  try {
    enrolledCount = await saveBranchCourseEnrollments(client, enrollmentPlan);
  } catch (error) {
    const enrollmentError = new Error(
      'The student was assigned to the branch, but course enrollment could not be completed. Reassign the same branch to retry.',
    );
    enrollmentError.status = 503;
    enrollmentError.cause = error;
    throw enrollmentError;
  }
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'student_branch_assignment_changed',
    entityType: 'profile',
    entityId: profileId,
    details: { branchCode: branch.code, enrolledCourseCount: enrolledCount },
  });
  return res.json({
    id: data.id,
    branchId: data.branch_id,
    assigned: true,
    enrolledCourseCount: enrolledCount,
    branchCourseCount: enrollmentPlan.courseCount,
  });
}));

app.post('/api/v1/admin/institutions/:institutionId/students/branch', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId } = req.params;
  const profileIds = req.body?.profileIds;
  const branchId = req.body?.branchId;
  if (!UUID_PATTERN.test(institutionId || '') || !UUID_PATTERN.test(branchId || '')
      || !Array.isArray(profileIds) || profileIds.length === 0
      || profileIds.length > 1000 || !profileIds.every((id) => UUID_PATTERN.test(id || ''))
      || new Set(profileIds).size !== profileIds.length) {
    return res.status(400).json({ detail: 'A valid branch and a unique list of student profile identifiers are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to assign students in this institution.' });
  }
  const client = getAdminSupabaseClient();
  const [{ data: students, error: studentsError }, { data: branch, error: branchError }] = await Promise.all([
    client.from('profiles').select('id').in('id', profileIds).eq('institution_id', institutionId).eq('role', 'student'),
    client.from('branches').select('id,department_id,code').eq('id', branchId).maybeSingle(),
  ]);
  if (studentsError) throw studentsError;
  if (branchError) throw branchError;
  if (!students || students.length !== profileIds.length) {
    return res.status(404).json({ detail: 'One or more selected students were not found in this institution.' });
  }
  if (!branch) return res.status(404).json({ detail: 'The selected branch was not found.' });
  const { data: department, error: departmentError } = await client.from('departments')
    .select('id,institution_id').eq('id', branch.department_id).maybeSingle();
  if (departmentError) throw departmentError;
  if (!department || department.institution_id !== institutionId) {
    return res.status(404).json({ detail: 'The selected branch is not part of this institution.' });
  }
  const enrollmentPlan = await prepareBranchCourseEnrollments(client, {
    institutionId,
    branchId,
    studentIds: profileIds,
  });
  const { data, error } = await client.from('profiles')
    .update({ department_id: department.id, branch_id: branchId })
    .in('id', profileIds)
    .eq('institution_id', institutionId)
    .eq('role', 'student')
    .select('id');
  if (error) throw error;
  if (!data || data.length !== profileIds.length) {
    throw new Error('Student branch assignment count did not match the requested student count.');
  }
  let enrolledCount;
  try {
    enrolledCount = await saveBranchCourseEnrollments(client, enrollmentPlan);
  } catch (error) {
    const enrollmentError = new Error(
      'Students were assigned to the branch, but course enrollment could not be completed. Reassign the same branch to retry.',
    );
    enrollmentError.status = 503;
    enrollmentError.cause = error;
    throw enrollmentError;
  }
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'student_branch_batch_assignment_changed',
    entityType: 'branch',
    entityId: branchId,
    details: {
      assignedCount: data.length,
      enrolledCourseCount: enrolledCount,
      branchCourseCount: enrollmentPlan.courseCount,
    },
  });
  return res.json({
    assignedCount: data.length,
    enrolledCourseCount: enrolledCount,
    branchCourseCount: enrollmentPlan.courseCount,
  });
}));

app.post('/api/v1/admin/institutions/:institutionId/courses/:courseId/students', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId, courseId } = req.params;
  const profileIds = req.body?.profileIds;
  if (!UUID_PATTERN.test(institutionId || '') || !UUID_PATTERN.test(courseId || '')
      || !Array.isArray(profileIds) || profileIds.length === 0
      || profileIds.length > 1000 || !profileIds.every((id) => UUID_PATTERN.test(id || ''))
      || new Set(profileIds).size !== profileIds.length) {
    return res.status(400).json({ detail: 'A valid course and a unique list of student profile identifiers are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to assign students in this institution.' });
  }
  const client = getAdminSupabaseClient();
  const [{ data: course, error: courseError }, { data: students, error: studentsError }] = await Promise.all([
    client.from('courses').select('id').eq('id', courseId).eq('institution_id', institutionId).maybeSingle(),
    client.from('profiles').select('id').in('id', profileIds)
      .eq('institution_id', institutionId).eq('role', 'student'),
  ]);
  if (courseError) throw courseError;
  if (studentsError) throw studentsError;
  if (!course) return res.status(404).json({ detail: 'Course not found in this institution.' });
  if (!students || students.length !== profileIds.length) {
    return res.status(404).json({ detail: 'One or more selected students were not found in this institution.' });
  }

  const enrollmentPlan = await prepareCourseStudentEnrollments(client, {
    institutionId,
    courseId,
    studentIds: profileIds,
  });
  let enrolledCount;
  try {
    enrolledCount = await saveBranchCourseEnrollments(client, enrollmentPlan);
  } catch (error) {
    const enrollmentError = new Error('Student course assignments could not be completed. Retry the assignment.');
    enrollmentError.status = 503;
    enrollmentError.cause = error;
    throw enrollmentError;
  }
  const alreadyEnrolledCount = profileIds.length - enrolledCount;
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'course_student_assignment_changed',
    entityType: 'course',
    entityId: courseId,
    details: { assignedCount: enrolledCount, alreadyEnrolledCount },
  });
  return res.json({
    assignedCount: enrolledCount,
    alreadyEnrolledCount,
  });
}));

app.post('/api/v1/admin/institutions/:institutionId/students/:profileId/approve', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId, profileId } = req.params;
  if (!UUID_PATTERN.test(institutionId) || !UUID_PATTERN.test(profileId)) {
    return res.status(400).json({ detail: 'A valid institution and student profile are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to approve students in this institution.' });
  }

  const client = getAdminSupabaseClient();
  const { data: target, error: targetError } = await client
    .from('profiles')
    .select('id,email,role,institution_id,is_approved')
    .eq('id', profileId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target || target.role !== 'student' || target.institution_id !== institutionId) {
    return res.status(404).json({ detail: 'Pending student not found in this institution.' });
  }

  let newlyApproved = false;
  if (target.is_approved === false) {
    const { data: approvedProfile, error } = await client
      .from('profiles')
      .update({ is_approved: true })
      .eq('id', profileId)
      .eq('institution_id', institutionId)
      .eq('role', 'student')
      .eq('is_approved', false)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!approvedProfile) return res.status(409).json({ detail: 'The student approval status changed. Refresh and try again.' });
    newlyApproved = true;
  } else if (target.is_approved !== true) {
    return res.status(503).json({ detail: 'The student approval status is unavailable.' });
  }

  const notificationTitle = 'Student account approved';
  const { data: existingNotification, error: notificationLookupError } = await client
    .from('notifications')
    .select('id')
    .eq('recipient_id', profileId)
    .eq('type', 'system')
    .eq('entity_type', 'profile')
    .eq('entity_id', profileId)
    .eq('title', notificationTitle)
    .maybeSingle();
  if (notificationLookupError) throw notificationLookupError;
  if (!existingNotification) {
    const { error } = await client.from('notifications').insert({
      recipient_id: profileId,
      institution_id: institutionId,
      type: 'system',
      title: notificationTitle,
      body: 'Your student account has been approved. You can now sign in to Student Agent AI.',
      entity_type: 'profile',
      entity_id: profileId,
    });
    if (error) throw error;
  }

  if (newlyApproved) {
    await writeAuditLog({
      institutionId,
      actorId: req.user.id,
      action: 'student_account_approved',
      entityType: 'profile',
      entityId: profileId,
      details: {},
    });
  }
  return res.json({ id: profileId, approved: true, notificationSent: true });
}));

app.post('/api/v1/admin/institutions/:institutionId/assign-user', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId } = req.params;
  const profileId = req.body?.profileId;
  if (!UUID_PATTERN.test(institutionId) || !UUID_PATTERN.test(profileId || '')) {
    return res.status(400).json({ detail: 'A valid institution and profile are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to configure this institution.' });
  }
  if (profileId === req.user.id) {
    return res.status(409).json({ detail: 'An administrator cannot assign their own profile to an institution.' });
  }
  const client = getAdminSupabaseClient();
  const { data: target, error: targetError } = await client
    .from('profiles')
    .select('id,role,institution_id')
    .eq('id', profileId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) return res.status(404).json({ detail: 'Profile not found.' });
  if (target.institution_id && target.institution_id !== institutionId) {
    return res.status(409).json({ detail: 'The profile is already assigned to another institution.' });
  }
  const { data, error } = await client
    .from('profiles')
    .update({ institution_id: institutionId })
    .eq('id', profileId)
    .select('id,email,role,institution_id')
    .single();
  if (error) throw error;
  if (data.role === 'admin') {
    const { error: grantError } = await client
      .from('institution_admins')
      .upsert({
        institution_id: institutionId,
        profile_id: profileId,
        granted_by: req.user.id,
      }, { onConflict: 'institution_id,profile_id' });
    if (grantError) throw grantError;
  }
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'user_assigned_to_institution',
    entityType: 'profile',
    entityId: data.id,
    details: { role: data.role },
  });
  return res.json({ id: data.id, email: data.email, role: data.role, institutionId: data.institution_id });
}));

app.post('/api/v1/admin/institutions/:institutionId/assign-department', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { institutionId } = req.params;
  const departmentId = req.body?.departmentId;
  if (!UUID_PATTERN.test(institutionId) || !UUID_PATTERN.test(departmentId || '')) {
    return res.status(400).json({ detail: 'A valid institution and department are required.' });
  }
  const context = await getInstitutionSetupContext(req.user.id);
  if (!requireInstitutionSetupAccess(context, institutionId)) {
    return res.status(403).json({ detail: 'You are not authorized to configure this institution.' });
  }
  const { data, error } = await getAdminSupabaseClient()
    .from('departments')
    .update({ institution_id: institutionId })
    .eq('id', departmentId)
    .is('institution_id', null)
    .select('id,name,institution_id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ detail: 'Unassigned department not found.' });
  return res.json({ id: data.id, name: data.name, institutionId: data.institution_id });
}));

app.get('/api/v1/admin/course-assignments', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const context = await getInstitutionSetupContext(req.user.id);
  const institutionId = resolveAdminInstitutionId(context, req.user.institutionId);
  if (!institutionId) {
    return res.status(403).json({ detail: 'Assign this administrator to an institution before managing courses.' });
  }
  const client = getAdminSupabaseClient();
  const [{ data: faculty, error: facultyError }, { data: courses, error: coursesError }] = await Promise.all([
    client.from('profiles').select('id,email').eq('role', 'faculty').eq('institution_id', institutionId).order('email'),
    client.from('courses').select('id,code,title,instructor_id,branch_id').eq('institution_id', institutionId).order('code'),
  ]);
  if (facultyError) throw facultyError;
  if (coursesError) throw coursesError;
  return res.json({
    faculty: faculty.map(({ id, email }) => ({ id, email })),
    courses: courses.map(({ id, code, title, instructor_id, branch_id: branchId }) => ({
      id,
      code,
      title,
      instructorId: instructor_id,
      branchId,
    })),
  });
}));

app.post('/api/v1/admin/courses', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { code, title, description, facultyId, branchId } = req.body || {};
  if (typeof code !== 'string' || !code.trim() || code.trim().length > 40 ||
      typeof title !== 'string' || !title.trim() || title.trim().length > 200 ||
      (description !== undefined && (typeof description !== 'string' || description.length > 2000)) ||
      typeof facultyId !== 'string' || !UUID_PATTERN.test(facultyId) ||
      typeof branchId !== 'string' || !UUID_PATTERN.test(branchId)) {
    return res.status(400).json({ detail: 'Course code, title, faculty account, and class branch are required.' });
  }
  const client = getAdminSupabaseClient();
  const context = await getInstitutionSetupContext(req.user.id);
  const institutionId = resolveAdminInstitutionId(context, req.user.institutionId);
  if (!institutionId) {
    return res.status(403).json({ detail: 'Assign this administrator to an institution before managing courses.' });
  }
  const { data: faculty, error: facultyError } = await client
    .from('profiles')
    .select('id')
    .eq('id', facultyId)
    .eq('role', 'faculty')
    .eq('institution_id', institutionId)
    .maybeSingle();
  if (facultyError) throw facultyError;
  if (!faculty) return res.status(400).json({ detail: 'Choose an existing faculty account.' });

  const { data: branch, error: branchError } = await client.from('branches')
    .select('id,department_id').eq('id', branchId).maybeSingle();
  if (branchError) throw branchError;
  if (!branch) return res.status(400).json({ detail: 'Choose a valid class branch.' });
  const { data: department, error: departmentError } = await client.from('departments')
    .select('id').eq('id', branch.department_id).eq('institution_id', institutionId).maybeSingle();
  if (departmentError) throw departmentError;
  if (!department) return res.status(400).json({ detail: 'Choose a branch belonging to this institution.' });

  const { count: branchStudentCount, error: studentsError } = await client.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('institution_id', institutionId)
    .eq('role', 'student')
    .eq('branch_id', branch.id);
  if (studentsError) throw studentsError;
  if ((branchStudentCount || 0) > 5000) {
    return res.status(413).json({
      detail: 'This branch has too many students for automatic enrollment. Contact support to complete course enrollment safely.',
    });
  }
  const { data: branchStudents, error: branchStudentsError } = await client.from('profiles')
    .select('id')
    .eq('institution_id', institutionId)
    .eq('role', 'student')
    .eq('branch_id', branch.id)
    .range(0, 4999);
  if (branchStudentsError) throw branchStudentsError;
  const { data: course, error } = await client.from('courses').insert({
    code: code.trim(),
    title: title.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    instructor_id: facultyId,
    institution_id: institutionId,
    branch_id: branch.id,
    department_id: department.id,
  }).select('id').single();
  if (error) throw error;
  let enrolledCount;
  try {
    const enrollmentPlan = await prepareBranchCourseEnrollments(client, {
      institutionId,
      branchId: branch.id,
      studentIds: (branchStudents || []).map((student) => student.id),
    });
    enrolledCount = await saveBranchCourseEnrollments(client, enrollmentPlan);
  } catch (error) {
    const enrollmentError = new Error(
      'The course was created, but student enrollment could not be completed. Reassign students to this branch to retry.',
    );
    enrollmentError.status = 503;
    enrollmentError.cause = error;
    throw enrollmentError;
  }
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'course_created',
    entityType: 'course',
    entityId: course.id,
    details: { facultyId, branchId: branch.id, enrolledStudentCount: enrolledCount },
  });
  return res.status(201).json({ success: true, enrolledStudentCount: enrolledCount });
}));

app.patch('/api/v1/admin/courses/:courseId/assignment', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const { courseId } = req.params;
  const facultyId = req.body?.facultyId;
  if (facultyId !== null && (typeof facultyId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(facultyId))) {
    return res.status(400).json({ detail: 'A valid faculty account or null assignment is required.' });
  }
  const client = getAdminSupabaseClient();
  const context = await getInstitutionSetupContext(req.user.id);
  const institutionId = resolveAdminInstitutionId(context, req.user.institutionId);
  if (!institutionId) {
    return res.status(403).json({ detail: 'Assign this administrator to an institution before managing courses.' });
  }
  if (facultyId !== null) {
    const { data: faculty, error: facultyError } = await client
      .from('profiles')
      .select('id')
      .eq('id', facultyId)
      .eq('role', 'faculty')
      .eq('institution_id', institutionId)
      .maybeSingle();
    if (facultyError) throw facultyError;
    if (!faculty) return res.status(400).json({ detail: 'Choose an existing faculty account.' });
  }
  const { data: course, error: courseError } = await client
    .from('courses')
    .update({ instructor_id: facultyId })
    .eq('id', courseId)
    .eq('institution_id', institutionId)
    .select('id')
    .maybeSingle();
  if (courseError) throw courseError;
  if (!course) return res.status(404).json({ detail: 'Course not found.' });
  await writeAuditLog({
    institutionId,
    actorId: req.user.id,
    action: 'course_faculty_assignment_changed',
    entityType: 'course',
    entityId: course.id,
    details: { facultyId },
  });
  return res.json({ success: true });
}));

app.post('/api/v1/auth/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').slice('Bearer '.length);
  sessions.delete(token);
  return res.json({ success: true });
});

async function dispatchAgentRequest(req, res) {
  const allowedPath = /^\/(?:agents\/(?:status|tutor|execute|personalized-learning|insights|recommendations|faculty\/assessments|assessments(?:\/[0-9a-f-]+(?:\/submit)?)?)|documents\/ingest)$/i;
  if (!allowedPath.test(req.path)) {
    return res.status(404).json({ detail: 'Agent endpoint not found.', request_id: req.requestId });
  }
  return proxyAgentRequest(req, res, { serviceUrl: process.env.AI_SERVICE_URL });
}

app.use('/api/v1', (req, res, next) => {
  if (DEMO_MODE) return next();
  const dispatch = () => {
    if (req.path.startsWith('/agents/') || req.path === '/documents/ingest') {
      return dispatchAgentRequest(req, res);
    }
    void handleApiRequest(req, res, () => {
      if (!res.headersSent) res.status(404).json({ detail: 'API endpoint not found.' });
    });
  };
  if (req.method === 'POST' && (/^\/courses\/[^/]+\/documents$/.test(req.path)
    || /^\/courses\/[^/]+\/materials$/.test(req.path)
    || /^\/projects\/[^/]+\/documents$/.test(req.path))) {
    return requireAuth(req, res, () => uploadRateLimit(req, res, () =>
      upload.single('file')(req, res, (error) => error ? next(error) : dispatch())
    ));
  }
  return requireAuth(req, res, dispatch);
});

app.get('/api/v1/me/courses', requireAuth, asyncRoute(async (req, res) => {
  
  const courses = courseCatalog.map((course) => {
    if (req.user.role === 'student') {
      const { enrolledStudents, ...studentCourse } = course;
      return studentCourse;
    }
    return course;
  });
  res.json(courses);
}));

app.get('/api/v1/me/courses/:courseId', requireAuth, asyncRoute(async (req, res) => {
  
  const course = courseCatalog.find((item) => item.id === req.params.courseId);
  if (!course) return res.status(404).json({ detail: 'Course not found.' });
  if (req.user.role === 'student') {
    const { enrolledStudents, ...studentCourse } = course;
    return res.json(studentCourse);
  }
  return res.json(course);
}));

app.get('/api/v1/faculty/courses/:courseId/roster', requireAuth, requireRole('instructor'), (_req, res) => (
  res.status(503).json({ detail: 'The database-backed faculty roster is unavailable in demo mode.' })
));

app.get('/api/v1/me/progress', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  res.json(analytics);
}));

app.get('/api/v1/me/recommendations', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  res.json(recommendations);
}));

app.get('/api/v1/learning-path', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  res.json(learningPath);
}));

app.get('/api/v1/me/tasks', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  res.json(studyTasks.filter((task) => task.ownerId === req.user.id).map(({ ownerId, ...task }) => task));
}));

app.post('/api/v1/me/tasks', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const { courseId, courseCode, title, dueDate, dueTime, type, priority } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || typeof courseId !== 'string') {
    return res.status(400).json({ detail: 'A title and course ID are required.' });
  }
  
  const task = {
    id: randomUUID(),
    ownerId: req.user.id,
    courseId,
    courseCode: courseCode || '',
    title: title.trim().slice(0, 160),
    dueDate: dueDate || '',
    dueTime: dueTime || '',
    type: type || 'review',
    priority: priority || 'medium',
    completed: false,
  };
  studyTasks.unshift(task);
  const { ownerId, ...publicTask } = task;
  return res.status(201).json(publicTask);
}));

app.patch('/api/v1/me/tasks/:taskId', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  const task = studyTasks.find((item) => item.id === req.params.taskId);
  if (!task) return res.status(404).json({ detail: 'Study task not found.' });
  if (task.ownerId !== req.user.id) return res.status(403).json({ detail: 'You do not have permission to update this task.' });
  task.completed = !task.completed;
  return res.json(studyTasks.filter((item) => item.ownerId === req.user.id).map(({ ownerId, ...item }) => item));
}));

app.get('/api/v1/planner/sessions', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  res.json(plannerSessions.filter((session) => session.ownerId === req.user.id).map(({ ownerId, ...session }) => session));
}));

app.post('/api/v1/planner/sessions', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const { courseId, courseCode, title, date, startTime, durationMinutes, completed, notes, type } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || !Number.isFinite(Number(durationMinutes))) {
    return res.status(400).json({ detail: 'A title and valid duration are required.' });
  }
  
  const session = {
    id: randomUUID(),
    ownerId: req.user.id,
    courseId,
    courseCode,
    title: title.trim().slice(0, 160),
    date,
    startTime,
    durationMinutes: Number(durationMinutes),
    completed: Boolean(completed),
    notes: typeof notes === 'string' ? notes : '',
    type: type || 'review',
  };
  plannerSessions.unshift(session);
  const { ownerId, ...publicSession } = session;
  return res.status(201).json(publicSession);
}));

app.patch('/api/v1/planner/sessions/:sessionId', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  const session = plannerSessions.find((item) => item.id === req.params.sessionId);
  if (!session) return res.status(404).json({ detail: 'Planner session not found.' });
  if (session.ownerId !== req.user.id) return res.status(403).json({ detail: 'You do not have permission to update this session.' });
  session.completed = !session.completed;
  return res.json(plannerSessions.filter((item) => item.ownerId === req.user.id).map(({ ownerId, ...item }) => item));
}));

app.post('/api/v1/planner/optimize', requireAuth, requireRole('student'), (_req, res) => {
  return res.status(503).json({ detail: 'AI study planning provider is not configured.' });
});

app.get('/api/v1/courses/:courseId/learning-path', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  const courseId = req.params.courseId;
  const list = learningPath.filter((item) => item.courseId === courseId || !item.courseId);
  res.json(list.length ? list : learningPath);
}));

app.get('/api/v1/chat/sessions', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  const sessionsForUser = chatSessions
    .filter((session) => session.ownerId === req.user.id)
    .map(({ ownerId, ...session }) => session);
  res.json(sessionsForUser);
}));

app.post('/api/v1/chat/sessions', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const { title, courseId, courseCode } = req.body || {};
  
  if (courseId && !courseCatalog.some((course) => course.id === courseId)) {
    return res.status(404).json({ detail: 'Course not found.' });
  }
  const session = {
    id: randomUUID(),
    ownerId: req.user.id,
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'New Learning Conversation',
    courseId,
    courseCode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
  };
  chatSessions.unshift(session);
  chatMessages[session.id] = [];
  const { ownerId, ...publicSession } = session;
  return res.status(201).json(publicSession);
}));

app.get('/api/v1/chat/sessions/:sessionId/messages', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  const { sessionId } = req.params;
  const session = chatSessions.find((item) => item.id === sessionId);
  if (!session) return res.status(404).json({ detail: 'Conversation not found.' });
  if (session && session.ownerId !== req.user.id) {
    return res.status(403).json({ detail: 'You do not have permission to view this conversation.' });
  }
  res.json(chatMessages[sessionId] || []);
}));

app.post('/api/v1/chat/sessions/:sessionId/messages', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const { content } = req.body || {};

  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ detail: 'Message content is required.' });
  }
  return res.status(503).json({
    detail: 'The AI tutor provider is not configured. Your message was not submitted.',
  });
}));

app.get('/api/v1/assessments', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  const filtered = req.query.courseId
    ? assessments.filter((assessment) => assessment.courseId === req.query.courseId)
    : assessments;
  res.json(filtered);
}));

app.get('/api/v1/courses/:courseId/assessments', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  res.json(assessments.filter((assessment) => assessment.courseId === req.params.courseId));
}));

app.get('/api/v1/assessments/:assessmentId', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  
  const assessment = assessments.find((item) => item.id === req.params.assessmentId);
  if (!assessment) {
    return res.status(404).json({ detail: 'Assessment not found.' });
  }
  return res.json(assessment);
}));

app.post('/api/v1/assessments/:assessmentId/submit', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const { assessmentId } = req.params;
  const submission = req.body || {};
  
  const assessment = assessments.find((item) => item.id === assessmentId);

  if (!assessment) {
    return res.status(404).json({ detail: 'Assessment not found.' });
  }

  const answers = submission.answers || {};
  let correctCount = 0;
  const questionResults = assessment.questions.map((question) => {
    const selectedOption = answers[question.id];
    const isCorrect = selectedOption === question.correctOptionIndex;
    if (isCorrect) correctCount += 1;
    return {
      questionId: question.id,
      questionText: question.questionText,
      selectedOption: selectedOption ?? -1,
      correctOption: question.correctOptionIndex,
      isCorrect,
      explanation: question.explanation,
    };
  });

  const percentage = Math.round((correctCount / assessment.questions.length) * 100);
  const passed = percentage >= assessment.passingScore;

  const result = {
    submissionId: `sub_${Date.now()}`,
    assessmentId,
    assessmentTitle: assessment.title,
    courseCode: assessment.courseCode,
    score: correctCount,
    totalQuestions: assessment.questions.length,
    percentage,
    passed,
    completedAt: new Date().toISOString(),
    timeSpentSeconds: submission.timeSpentSeconds || 0,
    topicBreakdown: [{ topic: assessment.topic, score: correctCount, total: assessment.questions.length, percentage }],
    questionResults,
    recommendedFollowUp: {
      topic: assessment.topic,
      reason: passed ? 'Strong performance. Advance to the next concept.' : 'Targeted review suggested before the next assessment.',
      practicePrompt: `Review the concepts behind ${assessment.topic} and practice two short examples before the next quiz.`,
    },
  };

  return res.json(result);
}));

app.post('/api/v1/courses/:courseId/assessments/generate', requireAuth, requireRole('instructor'), (_req, res) => {
  return res.status(503).json({ detail: 'Assessment generation provider is not configured.' });
});

app.post('/api/v1/faculty/assessments/generate', requireAuth, requireRole('instructor'), (_req, res) => {
  return res.status(503).json({ detail: 'Assessment generation provider is not configured.' });
});

app.post('/api/v1/courses/:courseId/assessments', requireAuth, requireRole('instructor'), asyncRoute(async (req, res) => {
  
  const course = courseCatalog.find((item) => item.id === req.params.courseId);
  if (!course) return res.status(404).json({ detail: 'Course not found.' });

  const assessment = req.body || {};
  if (
    typeof assessment.title !== 'string' ||
    !assessment.title.trim() ||
    !Array.isArray(assessment.questions) ||
    assessment.questions.length === 0
  ) {
    return res.status(400).json({ detail: 'Assessment title and at least one question are required.' });
  }

  const storedAssessment = {
    ...assessment,
    id: randomUUID(),
    courseId: course.id,
    courseCode: course.code,
    attemptsCount: 0,
    bestScore: undefined,
  };
  assessments.unshift(storedAssessment);
  return res.status(201).json(storedAssessment);
}));

app.get('/api/v1/documents', requireAuth, asyncRoute(async (req, res) => {
  
  const documents = defaultDocuments
    .filter((document) => document.ownerId === req.user.id)
    .map(({ ownerId, ...document }) => document);
  res.json(documents);
}));

app.get('/api/v1/courses/:courseId/documents', requireAuth, asyncRoute(async (req, res) => {
  
  const documentsForCourse = defaultDocuments.filter(
    (document) => document.courseId === req.params.courseId && document.ownerId === req.user.id
  );
  res.json(documentsForCourse.map(({ ownerId, ...document }) => document));
}));

app.delete('/api/v1/documents/:documentId', requireAuth, asyncRoute(async (req, res) => {
  const { documentId } = req.params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(documentId)) {
    return res.status(400).json({ detail: 'Invalid document ID.' });
  }

  

  const documentIndex = defaultDocuments.findIndex((document) => document.id === documentId);
  if (documentIndex === -1) {
    return res.status(404).json({ detail: 'Document not found.' });
  }

  if (defaultDocuments[documentIndex].ownerId !== req.user.id) {
    return res.status(403).json({ detail: 'You do not have permission to delete this document.' });
  }

  defaultDocuments.splice(documentIndex, 1);
  return res.json({ success: true });
}));

app.post('/api/v1/courses/:courseId/documents', requireAuth, requireRole('instructor'), uploadRateLimit, upload.single('file'), asyncRoute(async (req, res) => {
  const file = req.file;
  const { course_id: courseIdFromBody } = req.body || {};
  const courseIdUsed = req.params.courseId;

  if (courseIdFromBody && courseIdFromBody !== courseIdUsed) {
    return res.status(400).json({ detail: 'Uploaded course ID does not match the request path.' });
  }
  if (!file) {
    return res.status(400).json({ detail: 'A file upload is required.' });
  }

  const allowedExtensions = ['pdf', 'txt', 'md', 'doc', 'docx'];
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  if (!extension || !allowedExtensions.includes(extension)) {
    return res.status(415).json({ detail: 'Unsupported file type. Allowed: PDF, TXT, MD, DOC, DOCX.' });
  }

  if (file.size > 10 * 1024 * 1024) {
    return res.status(413).json({ detail: 'Uploaded files must be 10 MB or smaller.' });
  }

  

  if (!courseCatalog.some((course) => course.id === courseIdUsed)) {
    return res.status(404).json({ detail: 'Course not found.' });
  }

  const doc = {
    id: `doc_${Date.now()}`,
    courseId: courseIdUsed,
    courseCode: courseCatalog.find((course) => course.id === courseIdUsed)?.code || 'CS 201',
    title: file.originalname,
    fileType: extension === 'pdf' ? 'pdf' : extension === 'txt' ? 'text' : 'markdown',
    fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
    status: 'UPLOADED',
    uploadedAt: 'Just now',
    chunksCount: 0,
    vectorStatus: 'Demo upload metadata only; the file was not persisted or processed.',
    ownerId: req.user.id,
  };

  defaultDocuments.unshift(doc);
  const { ownerId, ...responseDocument } = doc;
  return res.status(202).json(responseDocument);
}));

app.get('/api/v1/lab/problems', requireAuth, requireRole('student'), (_req, res) => {
  return res.status(503).json({ detail: 'Coding problem content is not configured on this server.' });
});

app.post('/api/v1/lab/execute', requireAuth, requireRole('student'), (_req, res) => {
  return res.status(503).json({ detail: 'A secure code execution provider is not configured.' });
});

app.use('/api/v1', (_req, res) => {
  res.status(404).json({ detail: 'API endpoint not found.' });
});

if (existsSync(path.join(frontendBuildPath, 'index.html'))) {
  app.use(express.static(frontendBuildPath, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  if (err && err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ detail: 'Origin not allowed.' });
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ detail: 'Uploaded files must be 10 MB or smaller.' });
  }
  if (isSupabaseSchemaUnavailable(err)) {
    return res.status(503).json({
      detail: 'This feature is unavailable until its Supabase migration is applied.',
      code: 'FEATURE_UNAVAILABLE',
    });
  }
  console.error('API request failed:', err?.code || 'internal_error');
  return res.status(err?.status || 500).json({
    detail: err?.status ? err.message : 'Internal server error.',
  });
});

app.listen(port, () => {
  console.log(`Student Agent AI API running on http://localhost:${port}`);
  if (!DEMO_MODE && !isSupabaseConfigured()) {
    console.warn('Supabase is not configured; authenticated API requests will return HTTP 503.');
  }
});
