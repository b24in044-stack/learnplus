import {
  User,
  UserRole,
  Course,
  StudyDocument,
  Assessment,
  AssessmentSubmission,
  AssessmentResult,
  Recommendation,
  AnalyticsData,
  LearningPathNode,
  ChatSession,
  ChatMessage,
  AgentLayerStep,
  ApiHealthResponse,
  StudyPlannerTask,
  FacultyAssessmentDraft,
  AgentWorkflowResult,
  GeneratedPracticeAssessment,
  GeneratedPracticeAssessmentResponse,
  CodingProblem,
  StudyPlannerSession,
  StudentAcademicContext,
  StudentEnrollment,
  StudentSubject,
  AcademicDocument,
  VerifiedSubjectMark,
  VerifiedSemesterResult,
  CourseMaterial,
  CourseMaterialCategory,
  LearningAssignmentDetail,
  LearningAssignmentHistory
} from '../types';
import {
  INITIAL_COURSES,
  INITIAL_DOCUMENTS,
  INITIAL_ASSESSMENTS,
  INITIAL_RECOMMENDATIONS,
  INITIAL_ANALYTICS,
  INITIAL_LEARNING_PATH,
  INITIAL_CHAT_SESSIONS,
  INITIAL_STUDY_TASKS,
  INITIAL_CODING_PROBLEMS,
  INITIAL_PLANNER_SESSIONS
} from './mockData';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';


const LOCAL_API_BASE_URL = 'http://localhost:8000/api/v1';

export const resolveApiBaseUrl = (configuredUrl: string | undefined, isProduction: boolean): string => {
  if (!configuredUrl) return isProduction ? '/api/v1' : LOCAL_API_BASE_URL;
  if (!isProduction || !/^https?:\/\//i.test(configuredUrl)) return configuredUrl;

  const hostname = new URL(configuredUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopback = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);

  return isLoopback ? '/api/v1' : configuredUrl;
};

export const DEFAULT_API_BASE_URL = resolveApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL,
  import.meta.env.PROD,
);

const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true';

const STORAGE_KEYS = {
  API_BASE_URL: 'sa_ai_api_base_url',
  AUTH_TOKEN: 'sa_ai_auth_token',
  CURRENT_ROLE: 'sa_ai_current_role',
  COURSES: 'sa_ai_courses_data',
  DOCUMENTS: 'sa_ai_documents_data',
  ASSESSMENTS: 'sa_ai_assessments_data',
  RECOMMENDATIONS: 'sa_ai_recommendations_data',
  ANALYTICS: 'sa_ai_analytics_data',
  LEARNING_PATH: 'sa_ai_learning_path_data',
  CHAT_SESSIONS: 'sa_ai_chat_sessions_data',
  CHAT_MESSAGES: 'sa_ai_chat_messages_data',
  SUBMISSIONS: 'sa_ai_submissions_history',
  STUDY_TASKS: 'sa_ai_study_tasks',
  CODING_PROBLEMS: 'sa_ai_coding_problems',
  PLANNER_SESSIONS: 'sa_ai_planner_sessions'
};

export class ApiError extends Error {
  public status: number;
  public detail?: string;
  public isNetworkError: boolean;

  constructor(status: number, message: string, detail?: string, isNetworkError = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.isNetworkError = isNetworkError;
  }
}

const canUseDemoFallback = (result: { error?: ApiError }) =>
  isDemoMode() && result.error?.isNetworkError === true;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isGeneratedPracticeAssessment(value: unknown): value is GeneratedPracticeAssessmentResponse {
  if (!isRecord(value)) return false;
  return typeof value.assessmentId === 'string'
    && typeof value.courseId === 'string'
    && typeof value.title === 'string'
    && typeof value.topic === 'string'
    && ['Beginner', 'Intermediate', 'Advanced'].includes(String(value.difficulty))
    && value.format === 'mcq'
    && value.aiGenerated === true
    && value.official === false
    && Array.isArray(value.questions)
    && value.questions.every((question) =>
      isRecord(question)
      && typeof question.id === 'string'
      && typeof question.question === 'string'
      && typeof question.topic === 'string'
      && question.format === 'mcq'
      && Array.isArray(question.options)
    );
}

export interface AcademicFilters {
  departmentId?: string;
  regulationId?: string;
  semesterId?: string;
  subjectId?: string;
  academicYearId?: string;
  examinationType?: string;
}

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private isLiveAvailable: boolean | null = null;
  private lastPingTime: number = 0;

  constructor() {
    this.baseUrl = localStorage.getItem(STORAGE_KEYS.API_BASE_URL) || DEFAULT_API_BASE_URL;
    this.token = isDemoMode() ? localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || null : null;
    if (isDemoMode()) this.initStorage();
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async sendPasswordReset(email: string): Promise<void> {
    if (isDemoMode()) {
      throw new ApiError(503, 'Password recovery is not available in demo mode.');
    }
    if (!isSupabaseConfigured()) {
      throw new ApiError(503, 'Password recovery is not configured. Contact your institution administrator.');
    }
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw new ApiError(400, error.message);
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.trim().replace(/\/+$/, '');
    localStorage.setItem(STORAGE_KEYS.API_BASE_URL, this.baseUrl);
    this.isLiveAvailable = null;
  }

  public getToken(): string | null {
    return this.token;
  }

  public setToken(token: string | null): void {
    this.token = token;
    if (token && isDemoMode()) {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    }
  }

  private async getFreshAccessToken(): Promise<string | null> {
    if (isDemoMode() || !isSupabaseConfigured()) return this.token;

    let sessionResult;
    try {
      sessionResult = await getSupabaseClient().auth.getSession();
    } catch {
      throw new ApiError(503, 'Your Supabase session could not be refreshed.');
    }
    if (sessionResult.error) {
      throw new ApiError(503, 'Your Supabase session could not be refreshed.');
    }

    const token = sessionResult.data.session?.access_token ?? null;
    const hadToken = Boolean(this.token);
    this.setToken(token);
    if (!token && hadToken) {
      window.dispatchEvent(new Event('sa-ai-unauthorized'));
    }
    if (!token) throw new ApiError(401, 'Your session has expired. Please sign in again.');
    return token;
  }

  public async logout(localOnly = false): Promise<void> {
    this.setToken(null);
    this.clearUserData();
    if (isDemoMode() || !isSupabaseConfigured()) return;
    try {
      const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
      if (error) {
        console.error(
          localOnly ? 'Local Supabase sign-out failed:' : 'Supabase sign-out failed:',
          error.code || 'auth_error',
        );
      }
    } catch (error) {
      console.error(
        localOnly ? 'Local Supabase sign-out failed:' : 'Supabase sign-out failed:',
        error instanceof Error ? error.name : 'auth_error',
      );
    }
  }

  public clearUserData(): void {
    [
      STORAGE_KEYS.COURSES,
      STORAGE_KEYS.DOCUMENTS,
      STORAGE_KEYS.ASSESSMENTS,
      STORAGE_KEYS.RECOMMENDATIONS,
      STORAGE_KEYS.ANALYTICS,
      STORAGE_KEYS.LEARNING_PATH,
      STORAGE_KEYS.CHAT_SESSIONS,
      STORAGE_KEYS.CHAT_MESSAGES,
      STORAGE_KEYS.SUBMISSIONS,
      STORAGE_KEYS.STUDY_TASKS,
      STORAGE_KEYS.PLANNER_SESSIONS,
    ].forEach((key) => localStorage.removeItem(key));
  }

  public async login(
    email: string,
    password: string,
    role: UserRole,
    facultyInviteCode?: string,
  ): Promise<{ token: string; user: User }> {
    if (isDemoMode()) {
      const res = await this.request<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, role })
      });
      if (res.isLive && res.data) {
        this.setToken(res.data.token);
        return res.data;
      }
      throw res.error ?? new ApiError(401, 'Demo authentication failed.');
    }

    if (!isSupabaseConfigured()) {
      throw new ApiError(503, 'Supabase Authentication is not configured.');
    }
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw new ApiError(error?.status || 401, error?.message || 'Authentication failed.');
    }
    const token = data.session.access_token;
    this.setToken(token);
    try {
      const user = await this.getCurrentUser(role === 'instructor' ? undefined : role);
      if (user.role !== role) {
        if (role === 'instructor') {
          const facultyUser = await this.provisionSupabaseAccount(
            user.name || user.email,
            'instructor',
            facultyInviteCode,
          );
          if (facultyUser.role === 'instructor') return { token, user: facultyUser };
        }
        throw new ApiError(403, 'This account does not have access to the selected portal.');
      }
      return { token, user };
    } catch (error) {
      this.logout(true);
      throw error;
    }
  }

  public async provisionSupabaseAccount(
    fullName: string,
    role: UserRole = 'student',
    facultyInviteCode?: string,
  ): Promise<User> {
    const res = await this.request<User>('/auth/provision', {
      method: 'POST',
      body: JSON.stringify({
        fullName,
        role,
        ...(facultyInviteCode ? { facultyInviteCode } : {}),
      }),
    });
    if (!res.isLive || !res.data) {
      throw res.error ?? new ApiError(503, 'The account profile could not be initialized.');
    }
    return res.data;
  }

  public async validateFacultyInvite(inviteCode: string): Promise<void> {
    const res = await this.request<{ valid: boolean }>('/auth/faculty-invite/validate', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    });
    if (!res.isLive || !res.data?.valid) {
      throw res.error ?? new ApiError(503, 'Faculty invitations are unavailable.');
    }
  }

  private initStorage() {
    if (!localStorage.getItem(STORAGE_KEYS.COURSES)) {
      localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(INITIAL_COURSES));
    }
    if (!localStorage.getItem(STORAGE_KEYS.DOCUMENTS)) {
      localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(INITIAL_DOCUMENTS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.ASSESSMENTS)) {
      localStorage.setItem(STORAGE_KEYS.ASSESSMENTS, JSON.stringify(INITIAL_ASSESSMENTS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.RECOMMENDATIONS)) {
      localStorage.setItem(STORAGE_KEYS.RECOMMENDATIONS, JSON.stringify(INITIAL_RECOMMENDATIONS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.ANALYTICS)) {
      localStorage.setItem(STORAGE_KEYS.ANALYTICS, JSON.stringify(INITIAL_ANALYTICS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.LEARNING_PATH)) {
      localStorage.setItem(STORAGE_KEYS.LEARNING_PATH, JSON.stringify(INITIAL_LEARNING_PATH));
    }
    if (!localStorage.getItem(STORAGE_KEYS.CHAT_SESSIONS)) {
      localStorage.setItem(STORAGE_KEYS.CHAT_SESSIONS, JSON.stringify(INITIAL_CHAT_SESSIONS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.STUDY_TASKS)) {
      localStorage.setItem(STORAGE_KEYS.STUDY_TASKS, JSON.stringify(INITIAL_STUDY_TASKS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.CODING_PROBLEMS)) {
      localStorage.setItem(STORAGE_KEYS.CODING_PROBLEMS, JSON.stringify(INITIAL_CODING_PROBLEMS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.PLANNER_SESSIONS)) {
      localStorage.setItem(STORAGE_KEYS.PLANNER_SESSIONS, JSON.stringify(INITIAL_PLANNER_SESSIONS));
    }
  }

  // Health check for the Express backend.
  public async checkHealth(): Promise<{ isLive: boolean; response?: ApiHealthResponse; error?: string; latencyMs: number }> {
    const startTime = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);

      if (res.ok) {
        const data = await res.json();
        this.isLiveAvailable = true;
        this.lastPingTime = Date.now();
        return { isLive: true, response: data, latencyMs };
      }

      this.isLiveAvailable = false;
      return { isLive: false, error: `API responded with HTTP ${res.status}: ${res.statusText}`, latencyMs };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);
      this.isLiveAvailable = false;
      const errMsg = err instanceof Error ? err.message : 'Connection failed';
      return { isLive: false, error: errMsg, latencyMs };
    }
  }

  public getIsLive(): boolean | null {
    return this.isLiveAvailable;
  }

  // Generic request with explicit error handling. Demo mode is opt-in only.
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    isMultipart = false
  ): Promise<{ data: T; isLive: boolean; error?: ApiError }> {
    if (!isDemoMode() && endpoint !== '/auth/faculty-invite/validate') {
      try {
        await this.getFreshAccessToken();
      } catch (error) {
        return {
          data: null as unknown as T,
          isLive: false,
          error: error instanceof ApiError
            ? error
            : new ApiError(503, 'Your Supabase session could not be refreshed.'),
        };
      }
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
    };

    if (!isMultipart && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers as Record<string, string> || {})
        },
        signal: controller.signal
      });
    } catch (error) {
      const apiErr = new ApiError(
        503,
        error instanceof Error ? error.message : 'The backend is unavailable. Start the API server or enable demo mode.',
        'Service unavailable',
        true
      );
      return { data: null as unknown as T, isLive: false, error: apiErr };
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.ok) {
      try {
        const data = await res.json();
        this.isLiveAvailable = true;
        return { data, isLive: true };
      } catch {
        return {
          data: null as unknown as T,
          isLive: false,
          error: new ApiError(502, 'The backend returned an invalid JSON response.')
        };
      }
    }

    let errorDetail = '';
    try {
      const errJson = await res.json();
      const message = errJson.detail || errJson.message || '';
      const code = typeof errJson.code === 'string' ? errJson.code : '';
      errorDetail = code ? `${message} (code: ${code})` : message;
    } catch {
      errorDetail = res.statusText;
    }

    const apiErr = new ApiError(
      res.status,
      `HTTP ${res.status}: ${errorDetail || res.statusText}`,
      errorDetail
    );
    if (res.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/logout') {
      this.setToken(null);
      window.dispatchEvent(new Event('sa-ai-unauthorized'));
    }
    return { data: null as unknown as T, isLive: false, error: apiErr };
  }

  private async requestAgent<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (isDemoMode()) {
      throw new ApiError(503, 'AI agents require a verified Supabase account and are unavailable in demo mode.');
    }
    const accessToken = await this.getFreshAccessToken();
    if (!accessToken) throw new ApiError(401, 'Sign in with Supabase before using AI agents.');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(options.headers as Record<string, string> || {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new ApiError(
        timedOut ? 504 : 503,
        timedOut ? 'The AI agent request timed out. Please try again.' : 'The AI agent service could not be reached.',
        'AI agent service unavailable',
        !timedOut,
      );
    } finally {
      clearTimeout(timeoutId);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      const requestId = response.headers?.get('x-request-id');
      throw new ApiError(
        502,
        `The AI agent service returned an invalid response.${requestId ? ` Request ID: ${requestId}` : ''}`,
      );
    }
    if (!isRecord(payload)) {
      const requestId = response.headers?.get('x-request-id');
      throw new ApiError(
        502,
        `The AI agent service returned an invalid response.${requestId ? ` Request ID: ${requestId}` : ''}`,
      );
    }
    if (!response.ok) {
      const detail = typeof payload.detail === 'string' ? payload.detail : 'The AI agent request failed.';
      if (response.status === 401) {
        this.setToken(null);
        window.dispatchEvent(new Event('sa-ai-unauthorized'));
      }
      const requestId = response.headers?.get('x-request-id');
      const requestReference = requestId ? ` Request ID: ${requestId}` : '';
      throw new ApiError(response.status, `${detail}${requestReference}`, detail);
    }
    return payload as T;
  }

  // --- 1. USER & AUTH (`GET /me`) ---
  public async getCurrentUser(expectedRole?: UserRole): Promise<User> {
    if (!isDemoMode() && !isSupabaseConfigured()) {
      throw new ApiError(503, 'Supabase Authentication is not configured.');
    }

    const res = await this.request<User>('/me');
    if (res.isLive && res.data) {
      if (expectedRole && res.data.role !== expectedRole) {
        throw new ApiError(403, 'This account does not have access to the selected portal.');
      }
      return res.data;
    }
    throw res.error ?? new ApiError(503, 'Authentication service unavailable.');
  }

  public async getAdminCourseAssignments(): Promise<{
    faculty: Array<{ id: string; email: string }>;
    courses: Array<{ id: string; code: string; title: string; instructorId: string | null; branchId: string | null }>;
  }> {
    const res = await this.request<{
      faculty: Array<{ id: string; email: string }>;
      courses: Array<{ id: string; code: string; title: string; instructorId: string | null; branchId: string | null }>;
    }>('/admin/course-assignments');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Course assignment service is unavailable.');
  }

  public async getAdminInstitutionSetup(): Promise<{
    institutionId: string | null;
    canCreateInstitution: boolean;
    institutions: Array<{ id: string; name: string; code: string; createdBy: string }>;
  }> {
    const res = await this.request<{
      institutionId: string | null;
      canCreateInstitution: boolean;
      institutions: Array<{ id: string; name: string; code: string; createdBy: string }>;
    }>('/admin/institutions/setup');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Institution setup service is unavailable.');
  }

  public async getAdminOverview(): Promise<{
    students: number;
    faculty: number;
    departments: number;
    courses: number;
    activeEnrollments: number;
  }> {
    const res = await this.request<{
      students: number;
      faculty: number;
      departments: number;
      courses: number;
      activeEnrollments: number;
    }>('/admin/overview');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Administrator overview is unavailable.');
  }

  public async createAdminInstitution(name: string, code: string): Promise<{
    id: string;
    name: string;
    code: string;
    assigned: boolean;
  }> {
    const res = await this.request<{
      id: string;
      name: string;
      code: string;
      assigned: boolean;
    }>('/admin/institutions', {
      method: 'POST',
      body: JSON.stringify({ name, code }),
    });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Institution could not be created.');
  }

  public async getUnassignedInstitutionUsers(institutionId: string): Promise<
    Array<{ id: string; email: string; role: UserRole }>
  > {
    const res = await this.request<Array<{ id: string; email: string; role: UserRole }>>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/unassigned-users`,
    );
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Unassigned users could not be loaded.');
  }

  public async getInstitutionStudents(institutionId: string): Promise<Array<{
    id: string;
    email: string;
    isApproved: boolean | null;
    branchId: string | null;
  }>> {
    const res = await this.request<Array<{
      id: string;
      email: string;
      isApproved: boolean | null;
      branchId: string | null;
    }>>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/students`,
    );
    if (res.isLive && Array.isArray(res.data)) return res.data;
    throw res.error ?? new ApiError(503, 'Institution students could not be loaded.');
  }

  public async getAdminAcademicStructure(institutionId: string): Promise<{
    departments: Array<{ id: string; code: string; name: string }>;
    branches: Array<{ id: string; department_id: string; code: string; name: string }>;
  }> {
    const res = await this.request<Awaited<ReturnType<ApiClient['getAdminAcademicStructure']>>>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/academic-structure`,
    );
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Academic class structure could not be loaded.');
  }

  public async createAdminDepartment(institutionId: string, department: { code: string; name: string }): Promise<void> {
    const res = await this.request<{ id: string }>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/departments`,
      { method: 'POST', body: JSON.stringify(department) },
    );
    if (!res.isLive || !res.data?.id) throw res.error ?? new ApiError(503, 'Department could not be created.');
  }

  public async createAdminBranch(institutionId: string, departmentId: string, branch: { code: string; name: string }): Promise<void> {
    const res = await this.request<{ id: string }>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/departments/${encodeURIComponent(departmentId)}/branches`,
      { method: 'POST', body: JSON.stringify(branch) },
    );
    if (!res.isLive || !res.data?.id) throw res.error ?? new ApiError(503, 'Branch could not be created.');
  }

  public async assignStudentBranch(institutionId: string, profileId: string, branchId: string): Promise<{ enrolledCourseCount: number; branchCourseCount: number }> {
    const res = await this.request<{ id: string; branchId: string; enrolledCourseCount: number; branchCourseCount: number }>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(profileId)}/branch`,
      { method: 'POST', body: JSON.stringify({ branchId }) },
    );
    if (!res.isLive || res.data?.branchId !== branchId) {
      throw res.error ?? new ApiError(503, 'Student branch assignment could not be confirmed.');
    }
    return {
      enrolledCourseCount: res.data.enrolledCourseCount,
      branchCourseCount: res.data.branchCourseCount,
    };
  }

  public async assignStudentsBranch(institutionId: string, profileIds: string[], branchId: string): Promise<{
    assignedCount: number;
    enrolledCourseCount: number;
    branchCourseCount: number;
  }> {
    const res = await this.request<{
      assignedCount: number;
      enrolledCourseCount: number;
      branchCourseCount: number;
    }>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/students/branch`,
      { method: 'POST', body: JSON.stringify({ profileIds, branchId }) },
    );
    if (!res.isLive || res.data?.assignedCount !== profileIds.length) {
      throw res.error ?? new ApiError(503, 'Student branch assignments could not be confirmed.');
    }
    return res.data;
  }

  public async assignStudentsToCourse(institutionId: string, courseId: string, profileIds: string[]): Promise<{
    assignedCount: number;
    alreadyEnrolledCount: number;
  }> {
    const res = await this.request<{
      assignedCount: number;
      alreadyEnrolledCount: number;
    }>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/courses/${encodeURIComponent(courseId)}/students`,
      { method: 'POST', body: JSON.stringify({ profileIds }) },
    );
    if (!res.isLive || !res.data
        || res.data.assignedCount + res.data.alreadyEnrolledCount !== profileIds.length) {
      throw res.error ?? new ApiError(503, 'Student course assignments could not be confirmed.');
    }
    return res.data;
  }

  public async approveStudentAccount(institutionId: string, profileId: string): Promise<void> {
    const res = await this.request<{ id: string; approved: boolean; notificationSent: boolean }>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(profileId)}/approve`,
      { method: 'POST' },
    );
    if (!res.isLive || res.data?.approved !== true || res.data.notificationSent !== true) {
      throw res.error ?? new ApiError(503, 'Student approval or inbox notification could not be confirmed.');
    }
  }

  public async assignUserToInstitution(institutionId: string, profileId: string): Promise<void> {
    const res = await this.request<{ id: string }>(
      `/admin/institutions/${encodeURIComponent(institutionId)}/assign-user`,
      { method: 'POST', body: JSON.stringify({ profileId }) },
    );
    if (!res.isLive || !res.data?.id) {
      throw res.error ?? new ApiError(503, 'The user could not be assigned to the institution.');
    }
  }

  public async assignCourseToFaculty(courseId: string, facultyId: string | null): Promise<void> {
    const res = await this.request<{ success: boolean }>(
      `/admin/courses/${encodeURIComponent(courseId)}/assignment`,
      { method: 'PATCH', body: JSON.stringify({ facultyId }) },
    );
    if (!res.isLive || !res.data?.success) {
      throw res.error ?? new ApiError(503, 'Course assignment could not be saved.');
    }
  }

  public async createAdminCourse(course: {
    code: string;
    title: string;
    description: string;
    facultyId: string;
    branchId: string;
  }): Promise<number> {
    const res = await this.request<{ success: boolean; enrolledStudentCount: number }>('/admin/courses', {
      method: 'POST',
      body: JSON.stringify(course),
    });
    if (!res.isLive || !res.data?.success) {
      throw res.error ?? new ApiError(503, 'Course could not be created.');
    }
    return res.data.enrolledStudentCount;
  }

  public async getCourseAcademicFoundation(courseId: string): Promise<{
    outcomes: Array<{ id: string; code: string; description: string; display_order: number }>;
    units: Array<{ id: string; unit_number: number; title: string; description: string; display_order: number }>;
    schedules: Array<{ id: string; title: string; starts_at: string; ends_at: string; location: string; meeting_url: string | null }>;
    announcements: Array<{ id: string; title: string; content: string; status: string; published_at: string | null; created_at: string }>;
    assignments: Array<{ id: string; title: string; description: string; due_at: string | null; max_points: number; status: string }>;
  }> {
    const res = await this.request(`/courses/${encodeURIComponent(courseId)}/academic-foundation`);
    if (res.isLive && res.data) return res.data as Awaited<ReturnType<ApiClient['getCourseAcademicFoundation']>>;
    throw res.error ?? new ApiError(503, 'Course academic information is unavailable.');
  }

  public async getAnnouncements(): Promise<Array<{ id: string; course_id: string; title: string; content: string; published_at: string | null; created_at: string }>> {
    const res = await this.request<Array<{ id: string; course_id: string; title: string; content: string; published_at: string | null; created_at: string }>>('/me/announcements');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Announcements are unavailable.');
  }

  public async getNotifications(): Promise<Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    entity_type: string | null;
    entity_id: string | null;
    read_at: string | null;
    created_at: string;
  }>> {
    const res = await this.request('/me/notifications');
    if (res.isLive && Array.isArray(res.data)) return res.data as Awaited<ReturnType<ApiClient['getNotifications']>>;
    throw res.error ?? new ApiError(503, 'Notifications are unavailable.');
  }

  public async markNotificationRead(notificationId: string): Promise<void> {
    const res = await this.request(`/me/notifications/${encodeURIComponent(notificationId)}`, { method: 'PATCH' });
    if (!res.isLive) throw res.error ?? new ApiError(503, 'Notification could not be updated.');
  }

  public async markAllNotificationsRead(): Promise<void> {
    const res = await this.request('/me/notifications/read-all', { method: 'POST' });
    if (!res.isLive) throw res.error ?? new ApiError(503, 'Notifications could not be updated.');
  }

  public async getAttendance(): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>('/attendance');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance is unavailable.');
  }

  public async getAttendanceBranches(): Promise<Array<{
    id: string;
    code: string;
    name: string;
    departmentCode: string;
  }>> {
    const res = await this.request<Array<{
      id: string;
      code: string;
      name: string;
      departmentCode: string;
    }>>('/attendance/branches');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance branches are unavailable.');
  }

  public async getAttendanceSummary(filters: { courseId?: string; from?: string; to?: string } = {}): Promise<Array<{ courseId: string; total: number; present: number; absent: number; late: number; excused: number; percentage: number }>> {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as Array<[string, string]>).toString();
    const res = await this.request<Array<{ courseId: string; total: number; present: number; absent: number; late: number; excused: number; percentage: number }>>(`/attendance/summary${query ? `?${query}` : ''}`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance summary is unavailable.');
  }

  public async getAttendanceReport(filters: { branchId?: string; semesterId?: string; courseId?: string; from?: string; to?: string } = {}): Promise<Array<{ courseId: string; branchId: string; semesterId: string | null; date: string; studentId: string; total: number; present: number; absent: number; late: number; excused: number; percentage: number }>> {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as Array<[string, string]>).toString();
    const res = await this.request<Array<{ courseId: string; branchId: string; semesterId: string | null; date: string; studentId: string; total: number; present: number; absent: number; late: number; excused: number; percentage: number }>>(`/attendance/report${query ? `?${query}` : ''}`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance report is unavailable.');
  }

  public async getAttendanceActivity(filters: { branchId?: string; semesterId?: string; courseId?: string; from?: string; to?: string } = {}): Promise<Array<{
    courseId: string;
    branchId: string;
    semesterId: string | null;
    facultyId: string;
    sessions: number;
    latestSessionDate: string;
    latestCreatedAt: string;
  }>> {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as Array<[string, string]>).toString();
    const res = await this.request<Array<{
      courseId: string;
      branchId: string;
      semesterId: string | null;
      facultyId: string;
      sessions: number;
      latestSessionDate: string;
      latestCreatedAt: string;
    }>>(`/attendance/activity${query ? `?${query}` : ''}`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance activity is unavailable.');
  }

  public async getAttendanceRoster(courseId: string): Promise<Array<{ student_id: string; studentCode: string; studentName: string; email: string }>> {
    const res = await this.request<Array<{ student_id: string; studentCode: string; studentName: string; email: string }>>(`/attendance/courses/${encodeURIComponent(courseId)}/roster`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance roster is unavailable.');
  }

  public async previewAttendanceUpload(courseId: string, file: File): Promise<{
    totalRows: number;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    unknownCount: number;
    rows: Array<{
      rowNumber: number | null;
      studentId: string | null;
      studentCode: string | null;
      studentName: string;
      email: string;
      status: string;
      issues: string[];
    }>;
    validRecords: Array<{ studentId: string; status: string }>;
  }> {
    const formData = new FormData();
    formData.append('courseId', courseId);
    formData.append('file', file);
    const res = await this.request<{
      totalRows: number;
      validCount: number;
      invalidCount: number;
      duplicateCount: number;
      unknownCount: number;
      rows: Array<{
        rowNumber: number | null;
        studentId: string | null;
        studentCode: string | null;
        studentName: string;
        email: string;
        status: string;
        issues: string[];
      }>;
      validRecords: Array<{ studentId: string; status: string }>;
    }>('/attendance/upload/preview', { method: 'POST', body: formData }, true);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance upload preview is unavailable.');
  }

  public async downloadAttendanceTemplate(courseId: string, format: 'csv' | 'xlsx'): Promise<void> {
    if (!isDemoMode()) await this.getFreshAccessToken();
    const headers: Record<string, string> = { Accept: '*/*' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(
      `${this.baseUrl}/attendance/courses/${encodeURIComponent(courseId)}/template?format=${format}`,
      { headers },
    );
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json() as { detail?: string; message?: string };
        detail = body.detail || body.message || detail;
      } catch {
        // Keep the HTTP status as the surfaced error when no JSON body is returned.
      }
      throw new ApiError(response.status, `HTTP ${response.status}: ${detail}`, detail);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `attendance-template.${format}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  public async createAttendanceSession(
    courseId: string,
    sessionDate: string,
    title: string,
    records: Array<{ studentId: string; status: string }>,
  ): Promise<{ session: Record<string, unknown>; records: Array<Record<string, unknown>> }> {
    const res = await this.request<{ session: Record<string, unknown>; records: Array<Record<string, unknown>> }>('/attendance/sessions', {
      method: 'POST',
      body: JSON.stringify({ courseId, sessionDate, title, records }),
    });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance session could not be created.');
  }

  public async getAttendanceSession(sessionId: string): Promise<{
    session: Record<string, unknown>;
    records: Array<{
      id: string;
      student_id: string;
      status: string;
      marked_at: string;
      studentCode: string;
      studentName: string;
      email: string;
    }>;
    corrections: Array<Record<string, unknown>>;
  }> {
    const res = await this.request<{
      session: Record<string, unknown>;
      records: Array<{
        id: string;
        student_id: string;
        status: string;
        marked_at: string;
        studentCode: string;
        studentName: string;
        email: string;
      }>;
      corrections: Array<Record<string, unknown>>;
    }>(`/attendance/sessions/${encodeURIComponent(sessionId)}`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Attendance session details are unavailable.');
  }

  public async saveAttendance(
    sessionId: string,
    records: Array<{ studentId: string; status: string }>,
    correctionReason: string,
  ): Promise<void> {
    const res = await this.request(`/attendance/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      body: JSON.stringify({ records, correctionReason }),
    });
    if (!res.isLive) throw res.error ?? new ApiError(503, 'Attendance could not be saved.');
  }

  public async getProjects(): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>('/projects');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Projects are unavailable.');
  }

  public async createProject(payload: { title: string; abstract: string; description: string; courseId?: string }): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>('/projects', { method: 'POST', body: JSON.stringify(payload) });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Project could not be registered.');
  }

  public async getProject(projectId: string): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Project details are unavailable.');
  }

  public async getProjectMembers(projectId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>(`/projects/${encodeURIComponent(projectId)}/members`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Project members are unavailable.');
  }

  public async addProjectMember(projectId: string, studentId: string): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ studentId }),
    });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'The project member could not be added.');
  }

  public async removeProjectMember(projectId: string, studentId: string): Promise<void> {
    const res = await this.request(`/projects/${encodeURIComponent(projectId)}/members`, {
      method: 'DELETE',
      body: JSON.stringify({ studentId }),
    });
    if (!res.isLive) throw res.error ?? new ApiError(503, 'The project member could not be removed.');
  }

  public async addProjectUpdate(projectId: string, content: string): Promise<void> {
    const res = await this.request(`/projects/${encodeURIComponent(projectId)}/updates`, { method: 'POST', body: JSON.stringify({ content }) });
    if (!res.isLive) throw res.error ?? new ApiError(503, 'Project update could not be saved.');
  }

  public async reviewProject(projectId: string, decision: string, content: string): Promise<void> {
    const res = await this.request(`/projects/${encodeURIComponent(projectId)}/feedback`, { method: 'POST', body: JSON.stringify({ decision, content }) });
    if (!res.isLive) throw res.error ?? new ApiError(503, 'Project review could not be saved.');
  }

  public async getProjectDocuments(projectId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>(`/projects/${encodeURIComponent(projectId)}/documents`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Project documents are unavailable.');
  }

  public async uploadProjectDocument(projectId: string, file: File, documentType: 'progress' | 'final_report' | 'supporting', milestoneId?: string): Promise<Record<string, unknown>> {
    const body = new FormData();
    body.append('file', file);
    body.append('documentType', documentType);
    if (milestoneId) body.append('milestoneId', milestoneId);
    const res = await this.request<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/documents`, { method: 'POST', body });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Project document upload failed.');
  }

  public async getProjectDocumentDownload(documentId: string): Promise<{ url: string; expiresIn: number }> {
    const res = await this.request<{ url: string; expiresIn: number }>(`/project-documents/${encodeURIComponent(documentId)}/download`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Project document download failed.');
  }

  public async createProjectMilestone(projectId: string, payload: { title: string; description: string; dueAt?: string }): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/milestones`, { method: 'POST', body: JSON.stringify(payload) });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Milestone could not be created.');
  }

  public async updateProjectMilestone(milestoneId: string, payload: Record<string, string | null>): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/project-milestones/${encodeURIComponent(milestoneId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Milestone could not be updated.');
  }

  public async getProjectMilestoneHistory(milestoneId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>(`/project-milestones/${encodeURIComponent(milestoneId)}/history`);
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Milestone history is unavailable.');
  }

  public async getResearchWorkspaces(): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>('/research/workspaces');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Research workspaces are unavailable.');
  }

  public async createResearchWorkspace(payload: { title: string; topic: string; problemStatement: string }): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>('/research/workspaces', { method: 'POST', body: JSON.stringify(payload) });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Research workspace could not be created.');
  }

  public async updateResearchWorkspace(workspaceId: string, payload: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(`/research/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Research workspace could not be updated.');
  }

  public async generateResearchPlan(topic: string, problemStatement: string): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>('/agents/execute', {
      method: 'POST',
      body: JSON.stringify({ task_type: 'research_planning', topic, message: problemStatement }),
    });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Research planning service is unavailable.');
  }

  public async getAssignments(): Promise<Array<{ id: string; course_id: string; title: string; description: string; due_at: string | null; max_points: number; status: string }>> {
    const res = await this.request<Array<{ id: string; course_id: string; title: string; description: string; due_at: string | null; max_points: number; status: string }>>('/me/assignments');
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Assignments are unavailable.');
  }

  public async createCourseAcademicResource(
    courseId: string,
    resource: 'outcomes' | 'units' | 'schedules' | 'announcements' | 'assignments',
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(
      `/courses/${encodeURIComponent(courseId)}/${resource}`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Academic resource could not be saved.');
  }

  public async submitAssignment(assignmentId: string, content: string, attachmentUrl?: string): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(
      `/assignments/${encodeURIComponent(assignmentId)}/submission`,
      { method: 'POST', body: JSON.stringify({ content, attachmentUrl }) },
    );
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Assignment submission could not be saved.');
  }

  public async getAssignmentSubmissions(assignmentId: string): Promise<Array<Record<string, unknown>>> {
    const res = await this.request<Array<Record<string, unknown>>>(
      `/assignments/${encodeURIComponent(assignmentId)}/submissions`,
    );
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Assignment submissions could not be loaded.');
  }

  public async gradeAssignmentSubmission(submissionId: string, grade: number, feedback: string): Promise<Record<string, unknown>> {
    const res = await this.request<Record<string, unknown>>(
      `/assignment-submissions/${encodeURIComponent(submissionId)}`,
      { method: 'PATCH', body: JSON.stringify({ grade, feedback }) },
    );
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Assignment grade could not be saved.');
  }

  // --- 2. COURSES (`GET /me/courses`) ---
  public async getCourses(): Promise<Course[]> {
    const res = await this.request<Course[]>('/me/courses');
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Courses service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.COURSES);
    return stored ? JSON.parse(stored) : INITIAL_COURSES;
  }

  public async getCourseById(courseId: string): Promise<Course | null> {
    const res = await this.request<Course>(`/me/courses/${encodeURIComponent(courseId)}`);
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(404, 'Course not found.');
    }
    const courses = await this.getCourses();
    return courses.find(c => c.id === courseId) || null;
  }

  private academicQuery(filters: AcademicFilters = {}): string {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim()) query.set(key, value.trim());
    });
    const serialized = query.toString();
    return serialized ? `?${serialized}` : '';
  }

  private async getAcademicRecords<T>(endpoint: string, unavailableMessage: string): Promise<T> {
    const response = await this.request<T>(endpoint);
    if (response.isLive && response.data !== null) return response.data;
    throw response.error ?? new ApiError(503, unavailableMessage);
  }

  public async getStudentAcademicContext(): Promise<StudentAcademicContext> {
    return this.getAcademicRecords(
      '/me/academic-profile',
      'Student academic profile service unavailable.'
    );
  }

  public async getStudentEnrollments(): Promise<StudentEnrollment[]> {
    return this.getAcademicRecords('/me/enrollments', 'Student enrollment service unavailable.');
  }

  public async getStudentSubjects(): Promise<StudentSubject[]> {
    return this.getAcademicRecords('/me/subjects', 'Student subject service unavailable.');
  }

  public async getEducationalMaterials(filters: AcademicFilters = {}): Promise<AcademicDocument[]> {
    return this.getAcademicRecords(
      `/academic/materials${this.academicQuery(filters)}`,
      'Educational materials service unavailable.'
    );
  }

  public async getPreviousQuestionPapers(filters: AcademicFilters = {}): Promise<AcademicDocument[]> {
    return this.getAcademicRecords(
      `/academic/question-papers${this.academicQuery(filters)}`,
      'Previous examination papers service unavailable.'
    );
  }

  public async getOfficialAnswerKeys(filters: AcademicFilters = {}): Promise<AcademicDocument[]> {
    return this.getAcademicRecords(
      `/academic/answer-keys${this.academicQuery(filters)}`,
      'Official answer keys service unavailable.'
    );
  }

  public async getVerifiedSubjectMarks(filters: AcademicFilters = {}): Promise<VerifiedSubjectMark[]> {
    return this.getAcademicRecords(
      `/me/marks${this.academicQuery(filters)}`,
      'Verified marks service unavailable.'
    );
  }

  public async getVerifiedSemesterResults(filters: AcademicFilters = {}): Promise<VerifiedSemesterResult[]> {
    return this.getAcademicRecords(
      `/me/semester-results${this.academicQuery(filters)}`,
      'Semester results service unavailable.'
    );
  }

  public async getAcademicDocumentDownload(
    repository: 'materials' | 'question-papers' | 'answer-keys',
    documentId: string
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.getAcademicRecords(
      `/academic/${repository}/${encodeURIComponent(documentId)}/download`,
      'Academic document download service unavailable.'
    );
  }

  public async getCourseMaterials(): Promise<CourseMaterial[]> {
    return this.getAcademicRecords('/course-materials', 'Course materials service unavailable.');
  }

  public async uploadCourseMaterial(
    courseId: string,
    file: File,
    payload: { title: string; category: CourseMaterialCategory; description?: string },
  ): Promise<CourseMaterial> {
    const body = new FormData();
    body.append('file', file);
    body.append('title', payload.title);
    body.append('category', payload.category);
    if (payload.description?.trim()) body.append('description', payload.description.trim());
    const response = await this.request<CourseMaterial>(
      `/courses/${encodeURIComponent(courseId)}/materials`,
      { method: 'POST', body },
      true,
    );
    if (response.isLive && response.data) return response.data;
    throw response.error ?? new ApiError(503, 'Course material upload failed.');
  }

  public async updateCourseMaterial(
    materialId: string,
    payload: { title: string; description: string; category: CourseMaterialCategory },
  ): Promise<CourseMaterial> {
    const response = await this.request<CourseMaterial>(
      `/course-materials/${encodeURIComponent(materialId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    );
    if (response.isLive && response.data) return response.data;
    throw response.error ?? new ApiError(503, 'Course material update failed.');
  }

  public async deleteCourseMaterial(materialId: string): Promise<void> {
    const response = await this.request<{ success: boolean }>(
      `/course-materials/${encodeURIComponent(materialId)}`,
      { method: 'DELETE' },
    );
    if (response.isLive && response.data?.success) return;
    throw response.error ?? new ApiError(503, 'Course material deletion failed.');
  }

  public async getCourseMaterialDownload(materialId: string): Promise<{ url: string; expiresInSeconds: number }> {
    return this.getAcademicRecords(
      `/course-materials/${encodeURIComponent(materialId)}/download`,
      'Course material download service unavailable.',
    );
  }

  // --- 3. DOCUMENTS (`POST /courses/{course_id}/documents`) ---
  public async getDocuments(courseId?: string): Promise<StudyDocument[]> {
    const endpoint = courseId ? `/courses/${encodeURIComponent(courseId)}/documents` : '/documents';
    const res = await this.request<StudyDocument[]>(endpoint);
    if (res.isLive && Array.isArray(res.data)) {
      return isDemoMode() ? res.data.map(markDocumentProcessingUnavailable) : res.data;
    }
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Documents service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.DOCUMENTS);
    const docs: StudyDocument[] = (stored ? JSON.parse(stored) : INITIAL_DOCUMENTS)
      .map(markDocumentProcessingUnavailable);
    return courseId ? docs.filter(d => d.courseId === courseId) : docs;
  }

  public async uploadDocument(courseId: string, file: File): Promise<StudyDocument> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('course_id', courseId);

    const res = await this.request<StudyDocument>(`/courses/${encodeURIComponent(courseId)}/documents`, {
      method: 'POST',
      body: formData
    }, true);

    if (res.isLive && res.data) return res.data;

    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Document upload service unavailable.');
    }

    // Explicit offline demo mode stores only metadata; no file upload or processing occurs.
    const extension = file.name.split('.').pop()?.toLowerCase();
    const fileType = extension === 'pdf' ? 'pdf' : extension === 'txt' ? 'text' : 'markdown';
    const fileSize = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    const newDoc: StudyDocument = {
      id: `doc_${Date.now()}`,
      courseId,
      courseCode: (await this.getCourseById(courseId))?.code || 'CS 201',
      title: file.name,
      fileType,
      fileSize,
      status: 'UPLOADED',
      uploadedAt: 'Just now',
      chunksCount: 0,
      vectorStatus: 'Demo metadata only; file storage and document processing are unavailable.'
    };

    const docs = await this.getDocuments();
    const updated = [newDoc, ...docs];
    localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(updated));

    return newDoc;
  }

  public async processDocument(
    documentId: string,
    courseId?: string
  ): Promise<{ documentId: string; chunksCount: number; status: 'ready' }> {
    if (isDemoMode()) {
      throw new ApiError(503, 'Document processing requires authenticated backend storage and is unavailable in demo mode.');
    }
    const accessToken = await this.getFreshAccessToken();
    if (!accessToken) throw new ApiError(401, 'Sign in with Supabase before processing documents.');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/documents/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          document_id: documentId,
          ...(courseId ? { course_id: courseId } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Document processing timed out. Check its status before retrying.'
        : 'The AI document-processing service could not be reached.';
      throw new ApiError(503, message, 'AI document processing unavailable', true);
    } finally {
      clearTimeout(timeoutId);
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const detail = payload && typeof payload.detail === 'string'
        ? payload.detail
        : 'The document could not be processed.';
      if (response.status === 401) {
        this.setToken(null);
        window.dispatchEvent(new Event('sa-ai-unauthorized'));
      }
      throw new ApiError(response.status, detail, detail);
    }
    if (
      !payload ||
      payload.document_id !== documentId ||
      payload.status !== 'ready' ||
      typeof payload.chunks_count !== 'number'
    ) {
      throw new ApiError(502, 'The AI service returned an incomplete document-processing result.');
    }
    return { documentId, chunksCount: payload.chunks_count, status: 'ready' };
  }

  public async checkRagAvailability(signal?: AbortSignal): Promise<boolean> {
    if (isDemoMode()) return false;
    const accessToken = await this.getFreshAccessToken();
    if (!accessToken) return false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeoutId = setTimeout(abort, 10_000);
    try {
      const response = await fetch(`${this.baseUrl}/agents/status`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        if (response.status === 401) {
          this.setToken(null);
          window.dispatchEvent(new Event('sa-ai-unauthorized'));
        }
        throw new ApiError(
          response.status,
          payload && typeof payload.detail === 'string'
            ? payload.detail
            : 'Could not verify document retrieval readiness.'
        );
      }
      if (!payload || typeof payload.rag_available !== 'boolean') {
        throw new ApiError(502, 'The AI service returned an invalid readiness response.');
      }
      return payload.rag_available;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Document retrieval readiness check timed out.'
        : 'Document retrieval readiness could not be verified.';
      throw new ApiError(503, message, 'RAG readiness unavailable', true);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
    }
  }

  public async getAgentStatus(): Promise<{
    agents: { agent_id: string; status: 'available' | 'degraded' | 'unavailable' }[];
    rag_available: boolean;
  }> {
    return this.requestAgent<{
      agents: { agent_id: string; status: 'available' | 'degraded' | 'unavailable' }[];
      rag_available: boolean;
    }>('/agents/status');
  }

  public async deleteDocument(docId: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>(`/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE'
    });
    if (res.isLive && res.data?.success === true) return true;
    if (canUseDemoFallback(res)) {
      const docs = await this.getDocuments();
      const filtered = docs.filter(d => d.id !== docId);
      localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(filtered));
      return true;
    }
    throw res.error ?? new ApiError(500, 'The document could not be deleted.');
  }

  // --- 4. ASSESSMENTS (`GET /assessments`, `POST /assessments/{id}/submit`) ---
  public async getAssessments(courseId?: string): Promise<Assessment[]> {
    const endpoint = courseId ? `/courses/${encodeURIComponent(courseId)}/assessments` : '/assessments';
    const res = await this.request<Assessment[]>(endpoint);
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Assessment service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.ASSESSMENTS);
    const list: Assessment[] = stored ? JSON.parse(stored) : INITIAL_ASSESSMENTS;
    return courseId ? list.filter(a => a.courseId === courseId) : list;
  }

  public async getAssessmentById(id: string): Promise<Assessment | null> {
    const res = await this.request<Assessment>(`/assessments/${encodeURIComponent(id)}`);
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(404, 'Assessment not found.');
    }
    const list = await this.getAssessments();
    return list.find(a => a.id === id) || null;
  }

  public async submitAssessment(submission: AssessmentSubmission): Promise<AssessmentResult> {
    if (submission.aiGenerated) {
      const workflow = await this.submitPracticeAssessment(
        submission.assessmentId,
        submission.answers,
        submission.timeSpentSeconds,
      );
      const result = workflow.data;
      const rawQuestions = result.questionResults;
      if (
        !Array.isArray(rawQuestions)
        || typeof result.percentage !== 'number'
        || typeof result.totalQuestions !== 'number'
      ) {
        throw new ApiError(502, 'The AI service returned an invalid practice assessment result.');
      }
      const questionResults = rawQuestions.flatMap((item) => {
        if (!isRecord(item) || typeof item.questionId !== 'string' || typeof item.questionText !== 'string') {
          return [];
        }
        return [{
          questionId: item.questionId,
          questionText: item.questionText,
          selectedOption: typeof item.selectedOption === 'number' ? item.selectedOption : -1,
          selectedAnswer: typeof item.selectedAnswer === 'string' || typeof item.selectedAnswer === 'number'
            ? item.selectedAnswer
            : '',
          correctOption: typeof item.correctOption === 'number' ? item.correctOption : undefined,
          correctAnswer: typeof item.correctAnswer === 'string' ? item.correctAnswer : undefined,
          isCorrect: typeof item.isCorrect === 'boolean' ? item.isCorrect : undefined,
          explanation: typeof item.explanation === 'string' ? item.explanation : '',
          topic: typeof item.topic === 'string' ? item.topic : '',
          score: typeof item.score === 'number' ? item.score : 0,
        }];
      });
      if (questionResults.length !== result.totalQuestions) {
        throw new ApiError(502, 'The AI service returned an incomplete practice assessment result.');
      }
      const topicBreakdown = Array.isArray(result.topicBreakdown)
        ? result.topicBreakdown.flatMap((item) => {
          if (!isRecord(item) || typeof item.topic !== 'string'
            || typeof item.score !== 'number' || typeof item.total !== 'number'
            || typeof item.percentage !== 'number') return [];
          return [{
            topic: item.topic,
            score: item.score,
            total: item.total,
            percentage: item.percentage,
          }];
        })
        : [];
      const followUp = isRecord(result.recommendedFollowUp) ? result.recommendedFollowUp : {};
      const suggestedTopic = typeof followUp.topic === 'string' ? followUp.topic : 'your completed topics';
      return {
        submissionId: typeof result.submissionId === 'string' ? result.submissionId : '',
        assessmentId: submission.assessmentId,
        courseId: typeof result.courseId === 'string' ? result.courseId : undefined,
        assessmentTitle: typeof result.assessmentTitle === 'string' ? result.assessmentTitle : 'Practice assignment',
        courseCode: typeof result.courseCode === 'string' ? result.courseCode : '',
        score: typeof result.marksObtained === 'number'
          ? result.marksObtained
          : questionResults.filter((item) => item.isCorrect).length,
        marksObtained: typeof result.marksObtained === 'number' ? result.marksObtained : undefined,
        maximumScore: typeof result.maximumScore === 'number' ? result.maximumScore : result.totalQuestions,
        totalQuestions: result.totalQuestions,
        percentage: result.percentage,
        passed: result.percentage >= 70,
        completedAt: typeof result.completedAt === 'string' ? result.completedAt : '',
        timeSpentSeconds: typeof result.timeSpentSeconds === 'number'
          ? result.timeSpentSeconds
          : submission.timeSpentSeconds,
        topicBreakdown,
        questionResults,
        recommendedFollowUp: {
          topic: suggestedTopic,
          reason: typeof followUp.reason === 'string' ? followUp.reason : 'Review the topics identified in your results.',
          practicePrompt: typeof followUp.practicePrompt === 'string'
            ? followUp.practicePrompt
            : `Review ${suggestedTopic} before your next assignment.`,
        },
        aiGenerated: true,
        official: false,
        status: typeof result.status === 'string' ? result.status : undefined,
        learningAnalysisStatus: typeof result.learningAnalysisStatus === 'string'
          ? result.learningAnalysisStatus
          : undefined,
      };
    }

    // Official backend grading contract
    const res = await this.request<AssessmentResult>(`/assessments/${encodeURIComponent(submission.assessmentId)}/submit`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(submission)
    });
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Assessment submission service unavailable.');
    }

    // Authentic server simulation: calculates official grade without exposing client keys beforehand
    const assessment = await this.getAssessmentById(submission.assessmentId);
    if (!assessment) throw new Error('Assessment not found');

    let correctCount = 0;
    const questionResults = assessment.questions.map(q => {
      const selected = submission.answers[q.id];
      const correctOption = q.correctOptionIndex;
      const isCorrect = typeof correctOption === 'number' && selected === correctOption;
      if (isCorrect) correctCount++;
      return {
        questionId: q.id,
        questionText: q.questionText,
        selectedOption: typeof selected === 'number' ? selected : -1,
        correctOption: correctOption ?? -1,
        isCorrect,
        explanation: q.explanation
      };
    });

    const percentage = Math.round((correctCount / assessment.questions.length) * 100);
    const passed = percentage >= assessment.passingScore;

    // Topic breakdown
    const topicMap: Record<string, { score: number; total: number }> = {};
    assessment.questions.forEach(q => {
      if (!topicMap[q.topicTag]) topicMap[q.topicTag] = { score: 0, total: 0 };
      topicMap[q.topicTag].total++;
      if (submission.answers[q.id] === q.correctOptionIndex) {
        topicMap[q.topicTag].score++;
      }
    });

    const topicBreakdown = Object.entries(topicMap).map(([topic, data]) => ({
      topic,
      score: data.score,
      total: data.total,
      percentage: Math.round((data.score / data.total) * 100)
    }));

    const result: AssessmentResult = {
      submissionId: `sub_${Date.now()}`,
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      courseCode: assessment.courseCode,
      score: correctCount,
      totalQuestions: assessment.questions.length,
      percentage,
      passed,
      completedAt: 'Just now',
      timeSpentSeconds: submission.timeSpentSeconds,
      topicBreakdown,
      questionResults,
      recommendedFollowUp: {
        topic: assessment.topic,
        reason: passed
          ? `Solid foundation established (${percentage}%). Proceed to next advanced topic.`
          : `Gaps identified in ${assessment.topic} (${percentage}%). We recommend targeted practice on missed concepts.`,
        practicePrompt: `I just completed ${assessment.title} and scored ${percentage}%. Can you provide 2 review questions on the concepts I missed?`
      }
    };

    // Update assessment stats in localStorage
    const assessments = await this.getAssessments();
    const target = assessments.find(a => a.id === assessment.id);
    if (target) {
      target.attemptsCount += 1;
      target.bestScore = Math.max(target.bestScore || 0, percentage);
      localStorage.setItem(STORAGE_KEYS.ASSESSMENTS, JSON.stringify(assessments));
    }

    return result;
  }

  // --- 5. PROGRESS & ANALYTICS (`GET /me/progress`) ---
  public async getAnalytics(): Promise<AnalyticsData> {
    const res = await this.request<AnalyticsData>('/me/progress');
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Progress service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.ANALYTICS);
    return stored ? JSON.parse(stored) : INITIAL_ANALYTICS;
  }

  // --- 6. RECOMMENDATIONS (`GET /me/recommendations`) ---
  public async getRecommendations(): Promise<Recommendation[]> {
    const res = await this.request<Recommendation[]>('/me/recommendations');
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Recommendations service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.RECOMMENDATIONS);
    return stored ? JSON.parse(stored) : INITIAL_RECOMMENDATIONS;
  }

  public async getAgentInsights(courseId?: string): Promise<AgentWorkflowResult> {
    const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : '';
    return this.requestAgent<AgentWorkflowResult>(`/agents/insights${query}`);
  }

  public async getAgentRecommendations(courseId?: string): Promise<AgentWorkflowResult> {
    const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : '';
    return this.requestAgent<AgentWorkflowResult>(`/agents/recommendations${query}`);
  }

  public async getPersonalizedLearning(courseId?: string): Promise<AgentWorkflowResult> {
    return this.requestAgent<AgentWorkflowResult>('/agents/personalized-learning', {
      method: 'POST',
      body: JSON.stringify(courseId ? { course_id: courseId } : {}),
    });
  }

  public async generatePracticeAssessment(input: {
    courseId: string;
    courseCode?: string;
    topic?: string;
    topics?: string[];
    difficulty: Assessment['difficulty'];
    learningObjectives?: string[];
    questionCount?: number;
  }): Promise<GeneratedPracticeAssessment> {
    const workflow = await this.requestAgent<AgentWorkflowResult>('/agents/assessments', {
      method: 'POST',
      body: JSON.stringify({
        course_id: input.courseId,
        topic: input.topic,
        topics: input.topics || [],
        difficulty: input.difficulty,
        learning_objectives: input.learningObjectives || [],
        question_count: input.questionCount || 5,
        question_format: 'mcq',
      }),
    });
    const data = workflow.data;
    if (!isGeneratedPracticeAssessment(data)) {
      throw new ApiError(502, 'The AI service returned an invalid generated practice assessment.');
    }
    const assessment: Assessment = {
      id: data.assessmentId,
      courseId: input.courseId,
      courseCode: input.courseCode || '',
      title: data.title,
      topic: data.topic,
      difficulty: data.difficulty,
      questionCount: data.questions.length,
      durationMinutes: 15,
      passingScore: 70,
      attemptsCount: 0,
      aiGenerated: true,
      official: false,
      questions: data.questions.map((question) => ({
        id: question.id,
        questionText: question.question,
        options: question.options,
        explanation: '',
        topicTag: question.topic,
      })),
    };
    return {
      ...data,
      courseCode: assessment.courseCode,
      durationMinutes: assessment.durationMinutes,
      passingScore: assessment.passingScore,
    };
  }

  public async submitPracticeAssessment(
    assessmentId: string,
    answers: Record<string, number | string>,
    timeSpentSeconds = 0,
  ): Promise<AgentWorkflowResult> {
    return this.requestAgent<AgentWorkflowResult>(
      `/agents/assessments/${encodeURIComponent(assessmentId)}/submit`,
      {
        method: 'POST',
        body: JSON.stringify({ answers, timeSpentSeconds }),
      },
    );
  }

  public async startPracticeAssessment(assessmentId: string): Promise<void> {
    await this.requestAgent<{ assessmentId: string; status: string }>(
      `/agents/assessments/${encodeURIComponent(assessmentId)}/start`,
      { method: 'POST' },
    );
  }

  public async getLearningAssignmentHistory(): Promise<LearningAssignmentHistory> {
    return this.requestAgent<LearningAssignmentHistory>('/agents/learning/assignments');
  }

  public async getLearningAssignmentDetail(assessmentId: string): Promise<LearningAssignmentDetail> {
    return this.requestAgent<LearningAssignmentDetail>(
      `/agents/learning/assignments/${encodeURIComponent(assessmentId)}`,
    );
  }

  public async retryLearningAssignmentAnalysis(assessmentId: string): Promise<{
    status: string;
    message?: string;
  }> {
    return this.requestAgent(`/agents/learning/assignments/${encodeURIComponent(assessmentId)}/retry-analysis`, {
      method: 'POST',
    });
  }

  // --- 7. LEARNING PATH (`GET /learning-path` or `GET /courses/{id}/learning-path`) ---
  public async getLearningPath(courseId?: string): Promise<LearningPathNode[]> {
    const endpoint = courseId ? `/courses/${encodeURIComponent(courseId)}/learning-path` : '/learning-path';
    const res = await this.request<LearningPathNode[]>(endpoint);
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Learning path service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.LEARNING_PATH);
    const list: LearningPathNode[] = stored ? JSON.parse(stored) : INITIAL_LEARNING_PATH;
    return list;
  }

  // --- 8. AI TUTOR & CHAT (`POST /chat/sessions/{session_id}/messages` and `POST /agent/query`) ---
  public async getChatSessions(): Promise<ChatSession[]> {
    const res = await this.request<ChatSession[]>('/chat/sessions');
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Chat sessions service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.CHAT_SESSIONS);
    return stored ? JSON.parse(stored) : INITIAL_CHAT_SESSIONS;
  }

  public async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    const res = await this.request<ChatMessage[]>(`/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Chat messages service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES);
    const map = stored ? JSON.parse(stored) : {};
    const messages: ChatMessage[] = map[sessionId] || [];
    return messages.filter((message) => message.role !== 'assistant');
  }

  public async createChatSession(title: string, courseId?: string, courseCode?: string): Promise<ChatSession> {
    const res = await this.request<ChatSession>('/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: title || 'New Learning Conversation', courseId, courseCode })
    });
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Chat session service unavailable.');
    }

    const newSession: ChatSession = {
      id: `session_${Date.now()}`,
      title: title || 'New Learning Conversation',
      courseId,
      courseCode,
      createdAt: 'Just now',
      updatedAt: 'Just now',
      messageCount: 0
    };

    const sessions = await this.getChatSessions();
    const updated = [newSession, ...sessions];
    localStorage.setItem(STORAGE_KEYS.CHAT_SESSIONS, JSON.stringify(updated));

    const messagesMap = JSON.parse(localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) || '{}');
    messagesMap[newSession.id] = [];
    localStorage.setItem(STORAGE_KEYS.CHAT_MESSAGES, JSON.stringify(messagesMap));

    return newSession;
  }

  public async sendMessage(
    sessionId: string,
    userText: string,
    courseId?: string,
    useDocuments = false
  ): Promise<ChatMessage> {
    if (isDemoMode()) {
      throw new ApiError(503, 'The AI tutor requires a verified Supabase account and is unavailable in demo mode.');
    }
    const accessToken = await this.getFreshAccessToken();
    if (!accessToken) throw new ApiError(401, 'Sign in with Supabase before using the AI tutor.');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40_000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/agents/tutor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: userText,
          ...(courseId ? { course_id: courseId } : {}),
          ...(useDocuments ? { use_documents: true } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'The AI tutor request timed out. Please try again.'
        : 'The AI service could not be reached. Start the AI service or check its configuration.';
      throw new ApiError(503, message, 'AI service unavailable', true);
    } finally {
      clearTimeout(timeoutId);
    }

    let payload: Record<string, unknown>;
    try {
      payload = await response.json() as Record<string, unknown>;
    } catch {
      throw new ApiError(502, 'The AI service returned an invalid response.');
    }
    if (!response.ok) {
      const detail = typeof payload.detail === 'string' ? payload.detail : 'The AI tutor request failed.';
      if (response.status === 401) {
        this.setToken(null);
        window.dispatchEvent(new Event('sa-ai-unauthorized'));
      }
      throw new ApiError(response.status, detail, detail);
    }

    if (
      typeof payload.id !== 'string' ||
      typeof payload.session_id !== 'string' ||
      typeof payload.content !== 'string' ||
      typeof payload.timestamp !== 'string'
    ) {
      throw new ApiError(502, 'The AI service returned an incomplete tutor response.');
    }
    const citations = Array.isArray(payload.citations)
      ? payload.citations.flatMap((citation) => {
        if (!citation || typeof citation !== 'object') return [];
        const source = citation as Record<string, unknown>;
        if (
          typeof source.document_id !== 'string' ||
          typeof source.document_title !== 'string' ||
          typeof source.excerpt !== 'string'
        ) return [];
        return [{
          documentId: source.document_id,
          sourceChunkId: typeof source.source_chunk_id === 'string' ? source.source_chunk_id : undefined,
          documentTitle: source.document_title,
          pageNumber: typeof source.page_number === 'number' ? source.page_number : undefined,
          chunkIndex: typeof source.chunk_index === 'number' ? source.chunk_index : undefined,
          excerpt: source.excerpt,
          confidenceScore: typeof source.similarity === 'number' ? source.similarity : 0,
        }];
      })
      : [];
    const agentSteps = Array.isArray(payload.agent_steps)
      ? payload.agent_steps.slice(0, 6).map((step, index) => {
        const item = step as Record<string, unknown>;
        return {
          layerNumber: ([1, 2, 3, 4, 5, 6] as const)[index] as AgentLayerStep['layerNumber'],
          layerName: typeof item.name === 'string' ? item.name : 'Agent',
          description: typeof item.description === 'string' ? item.description : '',
          durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : 0,
          status: 'completed' as const,
        };
      })
      : undefined;

    return {
      id: payload.id,
      sessionId: payload.session_id,
      role: 'assistant',
      content: payload.content,
      timestamp: payload.timestamp,
      citations,
      agentSteps,
    };
  }

  // --- 9. STUDY PLANNER TASKS (`GET /me/tasks`, `POST /me/tasks`) ---
  public async getStudyTasks(): Promise<StudyPlannerTask[]> {
    const res = await this.request<StudyPlannerTask[]>('/me/tasks');
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Study tasks service unavailable.');
    }
    const stored = localStorage.getItem(STORAGE_KEYS.STUDY_TASKS);
    return stored ? JSON.parse(stored) : INITIAL_STUDY_TASKS;
  }

  public async toggleStudyTask(taskId: string): Promise<StudyPlannerTask[]> {
    const res = await this.request<StudyPlannerTask[]>(`/me/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ toggleCompleted: true })
    });
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Study task update service unavailable.');
    }

    const tasks = await this.getStudyTasks();
    const updated = tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
    localStorage.setItem(STORAGE_KEYS.STUDY_TASKS, JSON.stringify(updated));
    return updated;
  }

  public async addStudyTask(task: Omit<StudyPlannerTask, 'id' | 'completed'>): Promise<StudyPlannerTask> {
    const res = await this.request<StudyPlannerTask>('/me/tasks', {
      method: 'POST',
      body: JSON.stringify(task)
    });
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Study task service unavailable.');
    }

    const tasks = await this.getStudyTasks();
    const newTask: StudyPlannerTask = {
      ...task,
      id: `task_${Date.now()}`,
      completed: false
    };
    const updated = [newTask, ...tasks];
    localStorage.setItem(STORAGE_KEYS.STUDY_TASKS, JSON.stringify(updated));
    return newTask;
  }

  // --- 10. FACULTY PORTAL ACTIONS (`POST /courses/{id}/assessments/publish`) ---
  public async getFacultyCourseRoster(courseId: string): Promise<{
    id: string;
    name: string;
    email: string;
    score: string;
    status: string;
    weakArea: string;
    lastActive: string;
  }[]> {
    const res = await this.request<{
      id: string;
      name: string;
      email: string;
      score: string;
      status: string;
      weakArea: string;
      lastActive: string;
    }[]>(`/faculty/courses/${encodeURIComponent(courseId)}/roster`);
    if (res.isLive && Array.isArray(res.data)) return res.data;
    throw res.error ?? new ApiError(503, 'Course roster service unavailable.');
  }

  public async publishFacultyAssessment(draft: FacultyAssessmentDraft): Promise<Assessment> {
    const newAssessment: Assessment = {
      id: `asmt_${Date.now()}`,
      courseId: draft.courseId,
      courseCode: draft.courseCode,
      title: draft.title,
      topic: draft.topic,
      difficulty: draft.difficulty,
      questionCount: draft.questions.length,
      durationMinutes: draft.durationMinutes,
      passingScore: draft.passingScore,
      attemptsCount: 0,
      questions: draft.questions.map(q => ({
        id: q.id,
        questionText: q.questionText,
        codeSnippet: q.codeSnippet,
        options: q.options,
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation,
        topicTag: q.topicTag
      }))
    };

    const res = await this.request<Assessment>(`/courses/${encodeURIComponent(draft.courseId)}/assessments`, {
      method: 'POST',
      body: JSON.stringify(newAssessment)
    });
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Assessment publishing service unavailable.');
    }

    const list = await this.getAssessments();
    const updated = [newAssessment, ...list];
    localStorage.setItem(STORAGE_KEYS.ASSESSMENTS, JSON.stringify(updated));
    return newAssessment;
  }

  // --- 11. CODING PRACTICE LAB ---
  public async getCodingProblems(): Promise<CodingProblem[]> {
    const res = await this.request<CodingProblem[]>('/lab/problems');
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Coding lab service unavailable.');
    }

    const stored = localStorage.getItem(STORAGE_KEYS.CODING_PROBLEMS);
    return stored ? JSON.parse(stored) : INITIAL_CODING_PROBLEMS;
  }

  public async getCodingProblem(id: string): Promise<CodingProblem | undefined> {
    const list = await this.getCodingProblems();
    return list.find(p => p.id === id);
  }

  public async runCodingSolution(
    problemId: string,
    code: string,
    language: string
  ): Promise<{
    success: boolean;
    passedCount: number;
    totalCount: number;
    results: { id: string; passed: boolean; output: string; expected: string; executionTimeMs: number }[];
    consoleOutput: string;
    complexityAnalysis?: { time: string; space: string; explanation: string };
    isDemo?: boolean;
  }> {
    const res = await this.request<any>('/lab/execute', {
      method: 'POST',
      body: JSON.stringify({ problemId, code, language })
    });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'Secure code execution is not configured.');
  }

  // --- 12. STUDY PLANNER & CALENDAR SESSIONS ---
  public async getPlannerSessions(): Promise<StudyPlannerSession[]> {
    const res = await this.request<StudyPlannerSession[]>('/planner/sessions');
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Planner service unavailable.');
    }

    const stored = localStorage.getItem(STORAGE_KEYS.PLANNER_SESSIONS);
    return stored ? JSON.parse(stored) : INITIAL_PLANNER_SESSIONS;
  }

  public async addPlannerSession(session: Omit<StudyPlannerSession, 'id'>): Promise<StudyPlannerSession> {
    const res = await this.request<StudyPlannerSession>('/planner/sessions', {
      method: 'POST',
      body: JSON.stringify(session)
    });
    if (res.isLive && res.data) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Planner service unavailable.');
    }

    const newSession: StudyPlannerSession = {
      ...session,
      id: `plan_sess_${Date.now()}`
    };
    const list = await this.getPlannerSessions();
    const updated = [newSession, ...list];
    localStorage.setItem(STORAGE_KEYS.PLANNER_SESSIONS, JSON.stringify(updated));
    return newSession;
  }

  public async togglePlannerSession(sessionId: string): Promise<StudyPlannerSession[]> {
    const res = await this.request<StudyPlannerSession[]>(`/planner/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ toggleCompleted: true })
    });
    if (res.isLive && Array.isArray(res.data)) return res.data;
    if (!canUseDemoFallback(res)) {
      throw res.error ?? new ApiError(503, 'Planner session update service unavailable.');
    }

    const list = await this.getPlannerSessions();
    const updated = list.map(s => s.id === sessionId ? { ...s, completed: !s.completed } : s);
    localStorage.setItem(STORAGE_KEYS.PLANNER_SESSIONS, JSON.stringify(updated));
    return updated;
  }

  public async generateAiStudyPlan(preferences: {
    examFocusCourseId?: string;
    dailyTargetHours: number;
  }): Promise<StudyPlannerSession[]> {
    const res = await this.request<StudyPlannerSession[]>('/planner/optimize', {
      method: 'POST',
      body: JSON.stringify(preferences)
    });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'AI study planning is unavailable because no AI provider is configured.');
  }

  // --- 13. FACULTY AI ASSESSMENT SYNTHESIZER ---
  public async generateFacultyAssessmentDraft(params: {
    courseId: string;
    topic: string;
    difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
    questionCount: number;
    bloomLevel?: string;
  }): Promise<FacultyAssessmentDraft> {
    const res = await this.request<FacultyAssessmentDraft>('/agents/faculty/assessments', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    if (res.isLive && res.data) return res.data;
    throw res.error ?? new ApiError(503, 'AI assessment generation is unavailable because no AI provider is configured.');
  }
}

function markDocumentProcessingUnavailable(document: StudyDocument): StudyDocument {
  return {
    ...document,
    status: document.status === 'FAILED' ? 'FAILED' : 'UPLOADED',
    chunksCount: 0,
    vectorStatus: 'Demo metadata only; storage and document processing are unavailable.',
    summary: undefined,
    extractedSnippets: undefined,
  };
}

export const api = new ApiClient();
