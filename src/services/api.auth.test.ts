// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { authClient, signIn, signOut, resetPassword, getSession } = vi.hoisted(() => ({
  authClient: { auth: {} as Record<string, ReturnType<typeof vi.fn>> },
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('./supabase', () => ({
  getSupabaseClient: () => authClient,
  isSupabaseConfigured: () => true,
}));

const faculty = {
  id: 'supabase-faculty-uid',
  name: 'Faculty Member',
  email: 'faculty@example.edu',
  role: 'instructor' as const,
  avatarUrl: '',
  department: 'Computer Science',
  enrolledSince: '',
};

describe('Supabase-backed API authentication', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
    vi.resetModules();
  });

  it('uses Supabase password authentication and sends its access token to the profile API', async () => {
    signIn.mockResolvedValue({
      data: { session: { access_token: 'fresh-supabase-access-token' } },
      error: null,
    });
    getSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-supabase-access-token' } },
      error: null,
    });
    authClient.auth.signInWithPassword = signIn;
    authClient.auth.getSession = getSession;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => faculty });
    vi.stubGlobal('fetch', fetchMock);
    const { ApiClient } = await import('./api');
    const client = new ApiClient();

    const result = await client.login('faculty@example.edu', 'user-entered-password', 'instructor');

    expect(signIn).toHaveBeenCalledWith({ email: 'faculty@example.edu', password: 'user-entered-password' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${client.getBaseUrl()}/me`);
    expect(String(fetchMock.mock.calls[0][1].headers.Authorization)).toMatch(/fresh-supabase-access-token$/);
    expect(result.user).toEqual(faculty);
    expect(localStorage.getItem('sa_ai_auth_token')).toBeNull();
  });

  it('does not call the application API after Supabase rejects credentials', async () => {
    signIn.mockResolvedValue({
      data: { session: null },
      error: { status: 400, message: 'Invalid login credentials' },
    });
    authClient.auth.signInWithPassword = signIn;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { ApiClient } = await import('./api');

    await expect(new ApiClient().login('faculty@example.edu', 'invalid', 'instructor'))
      .rejects.toThrow('Invalid login credentials');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs out locally when the trusted profile role does not match the selected portal', async () => {
    signIn.mockResolvedValue({
      data: { session: { access_token: 'student-supabase-access-token' } },
      error: null,
    });
    getSession.mockResolvedValue({
      data: { session: { access_token: 'student-supabase-access-token' } },
      error: null,
    });
    authClient.auth.signInWithPassword = signIn;
    authClient.auth.getSession = getSession;
    authClient.auth.signOut = signOut;
    signOut.mockResolvedValue({ error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...faculty, role: 'student' }),
    }));
    const { ApiClient } = await import('./api');
    const client = new ApiClient();

    await expect(client.login('student@example.edu', 'password', 'instructor'))
      .rejects.toThrow('This account does not have access to the selected portal.');
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(client.getToken()).toBeNull();
  });

  it('sends password recovery through Supabase Auth', async () => {
    authClient.auth.resetPasswordForEmail = resetPassword;
    resetPassword.mockResolvedValue({ error: null });
    const { ApiClient } = await import('./api');

    await new ApiClient().sendPasswordReset('student@example.edu');

    expect(resetPassword).toHaveBeenCalledWith('student@example.edu', {
      redirectTo: window.location.origin,
    });
  });

  it('rejects profile restoration without an active Supabase session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    authClient.auth.getSession = getSession;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { ApiClient } = await import('./api');

    await expect(new ApiClient().getCurrentUser()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the refreshed Supabase access token before protected profile requests', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'refreshed-supabase-token' } },
      error: null,
    });
    authClient.auth.getSession = getSession;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...faculty, role: 'student' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { ApiClient } = await import('./api');

    await new ApiClient().getCurrentUser('student');

    expect(String(fetchMock.mock.calls[0][1].headers.Authorization)).toMatch(/refreshed-supabase-token$/);
  });

  it('clears local and remote Supabase session state on logout', async () => {
    authClient.auth.signOut = signOut;
    signOut.mockResolvedValue({ error: null });
    const { ApiClient } = await import('./api');
    const client = new ApiClient();
    client.setToken('temporary-token');

    await client.logout();

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(client.getToken()).toBeNull();
  });

  it('clears API state and awaits Supabase sign-out when logout is local-only', async () => {
    authClient.auth.signOut = signOut;
    signOut.mockResolvedValue({ error: null });
    const { ApiClient } = await import('./api');
    const client = new ApiClient();
    client.setToken('temporary-token');

    await client.logout(true);

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(client.getToken()).toBeNull();
  });

  it('checks the server profile using the verified bearer token', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-access-token' } },
      error: null,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => faculty });
    vi.stubGlobal('fetch', fetchMock);
    const { ApiClient } = await import('./api');
    const client = new ApiClient();
    client.setToken('supabase-access-token');

    await client.provisionSupabaseAccount('Faculty Member');

    expect(fetchMock.mock.calls[0][0]).toBe(`${client.getBaseUrl()}/auth/provision`);
    expect(String(fetchMock.mock.calls[0][1].headers.Authorization)).toMatch(/supabase-access-token$/);
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({
      fullName: 'Faculty Member',
      role: 'student',
    }));
  });

  it('requires a faculty invite code to promote a requested account after email confirmation', async () => {
    signIn.mockResolvedValue({
      data: { session: { access_token: 'fresh-supabase-access-token' } },
      error: null,
    });
    getSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-supabase-access-token' } },
      error: null,
    });
    authClient.auth.signInWithPassword = signIn;
    authClient.auth.getSession = getSession;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...faculty, role: 'student' }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          detail: 'A valid faculty invite code is required to enable faculty access.',
          code: 'FACULTY_INVITE_REQUIRED',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    authClient.auth.signOut = signOut;
    signOut.mockResolvedValue({ error: null });
    const { ApiClient } = await import('./api');
    const client = new ApiClient();

    await expect(client.login('faculty@example.edu', 'password', 'instructor'))
      .rejects.toThrow(/valid faculty invite code is required/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`${client.getBaseUrl()}/auth/provision`);
    expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({
      fullName: 'Faculty Member',
      role: 'instructor',
    }));
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });
});
