// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, DEFAULT_API_BASE_URL, resolveApiBaseUrl } from './api';

const { authClient } = vi.hoisted(() => ({
  authClient: { auth: { getSession: vi.fn() } },
}));

vi.mock('./supabase', () => ({
  getSupabaseClient: () => authClient,
  isSupabaseConfigured: () => true,
}));

describe('API demo and failure behavior', () => {
  beforeEach(() => {
    authClient.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-access-token' } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('uses same-origin API routing for loopback URLs in production builds', () => {
    expect(resolveApiBaseUrl('http://localhost:8000/api/v1', true)).toBe('/api/v1');
    expect(resolveApiBaseUrl('http://127.0.0.1:8000/api/v1', true)).toBe('/api/v1');
    expect(resolveApiBaseUrl('https://api.example.test/api/v1', true)).toBe('https://api.example.test/api/v1');
    expect(resolveApiBaseUrl(undefined, false)).toBe('http://localhost:8000/api/v1');
  });

  it('reports the AI service as unavailable in live mode instead of returning simulated output', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await expect(client.sendMessage('session-1', 'Explain AVL rotations'))
      .rejects.toThrow(/AI service could not be reached/);
  });

  it('does not send demo credentials to the AI service', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setToken('demo-token');

    await expect(client.sendMessage('session-1', 'Explain AVL rotations'))
      .rejects.toThrow(/verified Supabase account/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends faculty assessment generation to the authenticated AI endpoint', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'draft-1',
        courseId: 'course-cs201',
        courseCode: 'CS 201',
        title: 'AVL Trees',
        topic: 'AVL trees',
        difficulty: 'Intermediate',
        durationMinutes: 15,
        passingScore: 70,
        questions: [{
          id: 'question-1',
          topicTag: 'Rotations',
          questionText: 'Which rotation restores balance?',
          options: ['Left', 'Right'],
          correctOptionIndex: 0,
          explanation: 'A left rotation restores the height balance.',
        }],
        status: 'draft',
        createdAt: '2026-11-01T10:00:00Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    const draft = await client.generateFacultyAssessmentDraft({
      courseId: 'course-cs201',
      topic: 'AVL trees',
      difficulty: 'Intermediate',
      questionCount: 1,
      bloomLevel: 'Application',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_API_BASE_URL}/agents/faculty/assessments`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      courseId: 'course-cs201',
      topic: 'AVL trees',
      difficulty: 'Intermediate',
      questionCount: 1,
      bloomLevel: 'Application',
    });
    expect(draft.status).toBe('draft');
    expect(draft.questions[0].correctOptionIndex).toBe(0);
  });

  it('sends authenticated tutor requests to the AI service and accepts only returned citations', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'assistant-1',
        session_id: 'session-1',
        role: 'assistant',
        content: 'AVL balance is maintained by rotations.',
        timestamp: '2026-11-01T10:00:00Z',
        intent: 'tutoring',
        provider: 'groq',
        citations: [],
        agent_steps: [
          { agent_id: 'coordinator', name: 'Coordinator', description: 'Routed tutoring task.', duration_ms: 2 },
          { agent_id: 'tutor', name: 'Tutor Agent', description: 'Generated provider response.', duration_ms: 20 },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    const message = await client.sendMessage('session-1', 'Explain AVL rotations', 'course-ignored');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_API_BASE_URL}/agents/tutor`);
    expect(options.headers.Authorization).toMatch(/^Bearer supabase-access-token$/);
    expect(JSON.parse(options.body)).toEqual({
      session_id: 'session-1',
      message: 'Explain AVL rotations',
      course_id: 'course-ignored',
    });
    expect(message.content).toContain('AVL balance');
    expect(message.citations).toEqual([]);
    expect(message.agentSteps?.map((step) => step.layerName)).toEqual(['Coordinator', 'Tutor Agent']);
  });

  it('requests document-grounded answers and exposes only returned source records', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'assistant-2',
        session_id: 'session-1',
        content: 'The notes define recursion as self-reference. [Source 1]',
        timestamp: '2026-11-01T10:00:00Z',
        citations: [{
          source_chunk_id: 'chunk-1',
          chunk_index: 6,
          document_id: 'document-1',
          document_title: 'Lecture notes',
          page_number: 4,
          excerpt: 'A recursive function calls itself.',
          similarity: 0.81,
        }],
        agent_steps: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    const message = await client.sendMessage('session-1', 'What do my notes say?', 'course-cs101', true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      session_id: 'session-1',
      message: 'What do my notes say?',
      course_id: 'course-cs101',
      use_documents: true,
    });
    expect(message.citations).toEqual([{
      documentId: 'document-1',
      sourceChunkId: 'chunk-1',
      chunkIndex: 6,
      documentTitle: 'Lecture notes',
      pageNumber: 4,
      excerpt: 'A recursive function calls itself.',
      confidenceScore: 0.81,
    }]);
  });

  it('processes documents through the AI service and requires an actual ready response', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        document_id: 'document-1',
        status: 'ready',
        chunks_count: 7,
        embedding_model: 'sentence-transformers/all-MiniLM-L6-v2',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await expect(client.processDocument('document-1')).resolves.toEqual({
      documentId: 'document-1',
      chunksCount: 7,
      status: 'ready',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_API_BASE_URL}/documents/ingest`);
  });

  it('passes the selected course context when indexing published course materials', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        document_id: 'document-1',
        status: 'ready',
        chunks_count: 2,
        embedding_model: 'sentence-transformers/all-MiniLM-L6-v2',
      }),
    }));
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await client.processDocument('document-1', 'course-cs101');

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      document_id: 'document-1',
      course_id: 'course-cs101',
    });
  });

  it('checks authenticated RAG readiness through the database-backed agent status endpoint', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rag_available: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await expect(client.checkRagAvailability()).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_API_BASE_URL}/agents/status`);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer supabase-access-token$/);
  });

  it('surfaces the proxy request ID for structured agent errors', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ 'x-request-id': 'request-123' }),
      json: async () => ({ detail: 'The AI agent service is unavailable.', request_id: 'request-123' }),
    }));
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await expect(client.getAgentStatus()).rejects.toThrow(/Request ID: request-123/);
  });

  it('rejects malformed agent response shapes instead of passing them to callers', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }));
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await expect(client.getAgentStatus()).rejects.toThrow(/invalid response/);
  });

  it('uses the configured versioned API base URL for requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();

    await client.getCourses();

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_API_BASE_URL}/me/courses`);
  });

  it('surfaces provider errors from the AI service without generating a fallback', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Service Unavailable',
      json: async () => ({ detail: 'AI tutor provider is not configured.' }),
    }));
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await expect(client.sendMessage('session-1', 'Explain AVL rotations')).rejects.toThrow(
      'AI tutor provider is not configured.'
    );
  });

  it('does not simulate code execution after an explicit service-unavailable response', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ detail: 'A secure code execution provider is not configured.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();

    await expect(client.runCodingSolution('prob_avl_rot', 'function solve() {}', 'javascript'))
      .rejects.toThrow('A secure code execution provider is not configured.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not report coding execution as successful when the provider is unreachable in demo mode', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new ApiClient();

    await expect(client.runCodingSolution('prob_avl_rot', 'function solve() {}', 'javascript'))
      .rejects.toThrow('offline');
  });

  it('does not expose stored assistant demo responses as tutor history', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    localStorage.setItem('sa_ai_chat_messages_data', JSON.stringify({
      'session-1': [
        { id: 'user-1', sessionId: 'session-1', role: 'user', content: 'Question', timestamp: 'now' },
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Example response',
          timestamp: 'now',
          citations: [{ documentId: 'fake', documentTitle: 'Fake source', excerpt: 'Fake', confidenceScore: 0.99 }],
          agentSteps: [{ layerNumber: 4, layerName: 'RAG', description: 'Fake retrieval', durationMs: 1, status: 'completed' }],
        },
      ],
    }));
    const client = new ApiClient();

    const messages = await client.getChatMessages('session-1');
    expect(messages.map((message) => message.role)).toEqual(['user']);
    expect(messages.some((message) => message.content === 'Example response')).toBe(false);
  });

  it('does not seed demo chat history or assistant replies', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new ApiClient();

    await expect(client.getChatSessions()).resolves.toEqual([]);
    expect(localStorage.getItem('sa_ai_chat_messages_data')).toBeNull();
  });

  it('does not generate or persist a local AI study plan when the provider is unavailable', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new ApiClient();
    const existingSessions = localStorage.getItem('sa_ai_planner_sessions');

    await expect(client.generateAiStudyPlan({ dailyTargetHours: 3 }))
      .rejects.toThrow('offline');
    expect(localStorage.getItem('sa_ai_planner_sessions')).toBe(existingSessions);
  });

  it('does not generate or persist a local faculty assessment when the provider is unavailable', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new ApiClient();
    const existingAssessments = localStorage.getItem('sa_ai_assessments_data');

    await expect(client.generateFacultyAssessmentDraft({
      courseId: 'course_cs201',
      topic: 'AVL trees',
      difficulty: 'Intermediate',
      questionCount: 3,
    })).rejects.toThrow('offline');
    expect(localStorage.getItem('sa_ai_assessments_data')).toBe(existingAssessments);
  });

  it('marks demo documents as unprocessed and removes sample extraction content', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 'doc-demo',
        courseId: 'course_cs201',
        title: 'Sample lecture.pdf',
        fileType: 'pdf',
        fileSize: '1 MB',
        status: 'READY',
        uploadedAt: 'today',
        chunksCount: 20,
        vectorStatus: 'Indexed',
        summary: 'Sample summary',
        extractedSnippets: ['Sample source text'],
      }],
    }));
    const client = new ApiClient();

    const [document] = await client.getDocuments();

    expect(document.status).toBe('UPLOADED');
    expect(document.chunksCount).toBe(0);
    expect(document.vectorStatus).toContain('unavailable');
    expect(document.summary).toBeUndefined();
    expect(document.extractedSnippets).toBeUndefined();
  });

  it('does not report local-only deletion as success outside demo mode', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new ApiClient();

    await expect(client.deleteDocument('doc_1')).rejects.toThrow();
    expect(localStorage.getItem('sa_ai_documents_data')).toBeNull();
  });

  it('clears cached user records but preserves API configuration on logout', () => {
    const client = new ApiClient();
    localStorage.setItem('sa_ai_api_base_url', 'http://api.example.test');
    localStorage.setItem('sa_ai_courses_data', '[{"id":"private-course"}]');

    client.clearUserData();

    expect(localStorage.getItem('sa_ai_courses_data')).toBeNull();
    expect(localStorage.getItem('sa_ai_api_base_url')).toBe('http://api.example.test');
  });
});
