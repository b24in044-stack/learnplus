export type UserRole = 'student' | 'instructor' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string;
  department: string;
  institutionId?: string;
  departmentId?: string;
  branchId?: string;
  regulationId?: string;
  academicYearId?: string;
  currentSemesterId?: string;
  studentId?: string;
  enrolledSince: string;
}

export interface StudentSubject {
  id: string;
  code: string;
  title: string;
  semesterNumber: number | null;
  departmentId: string | null;
  regulationId: string | null;
}

export interface StudentEnrollment {
  id: string;
  studentUid: string;
  courseId: string;
  subjectId?: string;
  academicYearId?: string | null;
  semesterId?: string | null;
  status: string;
  enrolledAt?: string | null;
  course: { id: string; code: string; title: string } | null;
  subject: { id: string; code: string; title: string; semesterNumber: number | null } | null;
}

export interface StudentAcademicContext {
  uid: string;
  departmentId?: string;
  branchId?: string;
  regulationId?: string;
  academicYearId?: string;
  currentSemesterId?: string;
  studentId?: string;
  subjects: StudentSubject[];
  enrollments: StudentEnrollment[];
}

export interface AcademicDocument {
  id: string;
  documentId?: string | null;
  title: string;
  courseId?: string;
  subjectId?: string;
  departmentId?: string;
  regulationId?: string;
  semesterId?: string;
  academicYearId?: string;
  examinationType?: string;
  description?: string;
  category?: CourseMaterialCategory;
  fileType?: 'pdf' | 'text' | 'markdown';
  fileSizeBytes?: number;
  uploadedAt?: string;
  uploadedBy?: string;
  published?: boolean;
  documentType: 'materials' | 'questionPapers' | 'answerKeys';
  official: boolean;
  ragReady?: boolean;
  provenance: {
    sourceName?: string;
    sourceReference?: string;
    publishedAt?: string;
    [key: string]: unknown;
  } | null;
}

export interface VerifiedSubjectMark {
  id: string;
  subjectId: string;
  courseId?: string;
  semesterId: string;
  academicYearId: string;
  score: number;
  maximumScore: number;
  verifiedByUid: string;
  verifiedAt: string;
  examinationType?: string;
}

export interface VerifiedSemesterResult {
  id: string;
  academicYearId: string;
  semesterId: string;
  creditsEarned: number;
  resultStatus: string;
  verifiedByUid: string;
  verifiedAt: string;
}

export interface Topic {
  id: string;
  courseId: string;
  title: string;
  order: number;
  isCompleted: boolean;
  masteryScore?: number; // 0 - 100
  prerequisites: string[];
  estimatedMinutes: number;
  resourcesCount: number;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  description: string;
  instructor: string;
  semesterId?: string;
  credits: number;
  progress: number; // 0 - 100
  enrolledStudents?: number;
  topicsCount: number;
  materialsCount: number;
  lastStudied?: string;
  nextTopic?: string;
  topics?: Topic[];
}

export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface StudyDocument {
  id: string;
  courseId: string;
  courseCode?: string;
  title: string;
  fileType: 'pdf' | 'text' | 'markdown' | 'doc';
  fileSize: string;
  pages?: number;
  status: DocumentStatus;
  uploadedAt: string;
  chunksCount?: number;
  vectorStatus?: string;
  summary?: string;
  extractedSnippets?: string[];
  errorMessage?: string;
}

export type CourseMaterialCategory = 'syllabus' | 'pyq' | 'ppt' | 'course_pdf' | 'other';

export interface CourseMaterial {
  id: string;
  documentId?: string | null;
  courseId: string;
  courseCode: string;
  title: string;
  description: string;
  category: CourseMaterialCategory;
  fileType: 'pdf' | 'text' | 'markdown';
  fileSizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  semesterId?: string;
  published: boolean;
  ragReady?: boolean;
  documentStatus?: DocumentStatus;
}

export interface AssessmentQuestion {
  id: string;
  questionText: string;
  codeSnippet?: string;
  options: string[];
  correctOptionIndex?: number;
  explanation: string;
  topicTag: string;
}

export interface Assessment {
  id: string;
  courseId: string;
  courseCode: string;
  title: string;
  topic: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  questionCount: number;
  durationMinutes: number;
  passingScore: number; // e.g. 70%
  attemptsCount: number;
  bestScore?: number;
  questions: AssessmentQuestion[];
  aiGenerated?: boolean;
  official?: boolean;
}

export interface AssessmentSubmission {
  assessmentId: string;
  studentId: string;
  answers: Record<string, number>; // questionId -> optionIndex
  timeSpentSeconds: number;
  aiGenerated?: boolean;
}

export interface QuestionResult {
  questionId: string;
  questionText: string;
  selectedOption: number;
  correctOption?: number;
  isCorrect?: boolean;
  explanation?: string;
}

export interface AssessmentResult {
  submissionId: string;
  assessmentId: string;
  assessmentTitle: string;
  courseCode: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  completedAt: string;
  timeSpentSeconds: number;
  topicBreakdown: {
    topic: string;
    score: number;
    total: number;
    percentage: number;
  }[];
  questionResults: QuestionResult[];
  recommendedFollowUp: {
    topic: string;
    reason: string;
    practicePrompt: string;
  };
  aiGenerated?: boolean;
  official?: boolean;
}

export interface SourceCitation {
  documentId: string;
  sourceChunkId?: string;
  chunkIndex?: number;
  documentTitle: string;
  pageNumber?: number;
  section?: string;
  excerpt: string;
  confidenceScore: number; // e.g. 0.94
}

export interface AgentLayerStep {
  layerNumber: 1 | 2 | 3 | 4 | 5 | 6;
  layerName: string;
  description: string;
  durationMs: number;
  status: 'completed' | 'active' | 'pending';
}

export interface AgentWorkflowResult {
  task_type: string;
  data: Record<string, unknown>;
  agent_steps: {
    agent_id: string;
    name: string;
    description: string;
    duration_ms: number;
    status: 'completed';
  }[];
}

export interface PracticeAssessmentQuestion {
  id: string;
  question: string;
  topic: string;
  format: 'mcq' | 'descriptive';
  options: string[];
}

export interface GeneratedPracticeAssessmentResponse {
  assessmentId: string;
  courseId: string;
  title: string;
  topic: string;
  difficulty: Assessment['difficulty'];
  format: 'mcq' | 'descriptive';
  aiGenerated: true;
  official: false;
  questions: PracticeAssessmentQuestion[];
}

export interface GeneratedPracticeAssessment extends GeneratedPracticeAssessmentResponse {
  courseCode?: string;
  durationMinutes: number;
  passingScore: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  citations?: SourceCitation[];
  agentSteps?: AgentLayerStep[];
  error?: string;
  isDemo?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  courseId?: string;
  courseCode?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Recommendation {
  id: string;
  topic: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  reason: string;
  estimatedMinutes: number;
  priority: 'high' | 'medium' | 'low';
  type: 'revision' | 'practice' | 'deep_dive';
}

export interface WeakTopic {
  id: string;
  concept: string;
  courseId: string;
  courseCode: string;
  performanceScore: number; // e.g. 42%
  attempts: number;
  suggestedAction: string;
  recommendedPracticeQuestion: string;
}

export interface LearningActivityDay {
  day: string; // 'Mon', 'Tue', etc.
  date: string;
  minutes: number;
  eventsCount: number;
}

export interface AnalyticsData {
  averageScore: number;
  assessmentsCompleted: number;
  enrolledCoursesCount: number;
  conceptsMasteredCount: number;
  totalConceptsCount: number;
  weeklyActivity: LearningActivityDay[];
  scoreProgression: {
    date: string;
    score: number;
    assessmentTitle: string;
  }[];
  weakTopics: WeakTopic[];
  conceptMasteryList: {
    concept: string;
    courseCode: string;
    mastery: number; // 0 - 100
    totalAttempts: number;
    status: 'Mastered' | 'Developing' | 'Needs Practice';
  }[];
}

export interface LearningPathNode {
  id: string;
  title: string;
  sequenceNumber: number;
  status: 'mastered' | 'in_progress' | 'locked';
  masteryScore?: number;
  prerequisites: string[];
  estimatedMinutes: number;
  relatedResources: string[];
  whyNextReason: string;
  practicePrompt: string;
}

export interface ApiHealthResponse {
  status: 'healthy' | 'unhealthy' | 'offline' | 'ok';
  version?: string;
  agentsActive?: number;
  databaseConnected?: boolean;
  timestamp?: string;
  demo_mode?: boolean;
}

export interface StudyPlannerTask {
  id: string;
  courseId: string;
  courseCode: string;
  title: string;
  dueDate: string;
  dueTime: string;
  type: 'assignment' | 'exam' | 'quiz' | 'review' | 'lecture';
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
}

export interface FacultyQuestionDraft {
  id: string;
  topicTag: string;
  questionText: string;
  codeSnippet?: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
}

export interface FacultyAssessmentDraft {
  id: string;
  courseId: string;
  courseCode: string;
  title: string;
  topic: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  durationMinutes: number;
  passingScore: number;
  questions: FacultyQuestionDraft[];
  status: 'draft' | 'published';
  createdAt: string;
}

export interface CodingProblem {
  id: string;
  title: string;
  courseCode: string;
  topicTag: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  description: string;
  examples: {
    input: string;
    output: string;
    explanation?: string;
  }[];
  constraints: string[];
  starterCode: Record<string, string>; // python, javascript, java, cpp
  solutionTemplates: Record<string, string>;
  testCases: {
    id: string;
    input: string;
    expected: string;
    isHidden?: boolean;
  }[];
  hints: string[];
}

export interface StudyPlannerSession {
  id: string;
  courseId: string;
  courseCode: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // '14:00'
  durationMinutes: number;
  completed: boolean;
  notes?: string;
  type: 'review' | 'quiz_prep' | 'assignment' | 'lecture';
}
