// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAuth, AuthProvider } from './AuthContext';

const { apiMock, authClient, signUp } = vi.hoisted(() => ({
  apiMock: {
    setToken: vi.fn(),
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    getToken: vi.fn(),
    clearUserData: vi.fn(),
    logout: vi.fn(),
    provisionSupabaseAccount: vi.fn(),
    validateFacultyInvite: vi.fn().mockResolvedValue(undefined),
  },
  authClient: { auth: {} as Record<string, ReturnType<typeof vi.fn>> },
  signUp: vi.fn(),
}));

vi.mock('../services/api', () => ({ api: apiMock }));
vi.mock('../services/supabase', () => ({
  getSupabaseClient: () => authClient,
  isSupabaseConfigured: () => true,
}));

let registerStudent!: ReturnType<typeof useAuth>['registerStudent'];
let registerFaculty!: ReturnType<typeof useAuth>['registerFaculty'];
let registrationResult: Awaited<ReturnType<ReturnType<typeof useAuth>['registerStudent']>> | undefined;
const studentProfile = {
  id: 'student-auth-id',
  name: 'Jordan Lee',
  email: 'jordan@example.edu',
  role: 'student' as const,
  avatarUrl: '',
  department: '',
  enrolledSince: '',
};
const facultyProfile = {
  ...studentProfile,
  id: 'faculty-auth-id',
  role: 'instructor' as const,
};
const sessionListener = vi.fn((_callback: unknown) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

function Harness() {
  const auth = useAuth();
  registerStudent = auth.registerStudent;
  registerFaculty = auth.registerFaculty;
  return (
    <div>
      <span>{auth.isAuthenticated ? 'authenticated' : 'signed out'}</span>
      <button onClick={() => void auth.registerStudent('Jordan Lee', 'jordan@example.edu', 'secure-password').then((result) => { registrationResult = result; })}>
        Register student account
      </button>
      <button onClick={() => void auth.registerFaculty('Jordan Lee', 'jordan@example.edu', 'secure-password', 'faculty-secret').then((result) => { registrationResult = result; })}>
        Register faculty account
      </button>
      <button onClick={() => void auth.signIn('jordan@example.edu', 'secure-password', 'student').then((result) => { registrationResult = result; })}>
        Sign in
      </button>
      <button onClick={() => void auth.signIn('jordan@example.edu', 'secure-password', 'instructor').then((result) => { registrationResult = result; })}>
        Sign in faculty
      </button>
    </div>
  );
}

describe('Supabase student registration', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    localStorage.clear();
    registrationResult = undefined;
    apiMock.getCurrentUser.mockResolvedValue(studentProfile);
    apiMock.provisionSupabaseAccount.mockImplementation((_name: string, role = 'student') =>
      Promise.resolve(role === 'instructor' ? facultyProfile : studentProfile));
    signUp.mockResolvedValue({
      data: {
        user: { id: 'student-auth-id' },
        session: { access_token: 'supabase-access-token' },
      },
      error: null,
    });
    authClient.auth.signUp = signUp;
    authClient.auth.onAuthStateChange = sessionListener;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('creates a student account using Supabase Auth and checks the trigger-provisioned profile', async () => {
    render(<AuthProvider><Harness /></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Register student account' }));
    await waitFor(() => expect(registrationResult).toEqual({ success: true }));

    expect(signUp).toHaveBeenCalledWith({
      email: 'jordan@example.edu',
      password: 'secure-password',
      options: {
        data: { full_name: 'Jordan Lee' },
        emailRedirectTo: window.location.origin,
      },
    });
    expect(apiMock.setToken).toHaveBeenCalledWith('supabase-access-token');
    expect(apiMock.provisionSupabaseAccount).toHaveBeenCalledWith('Jordan Lee');
    expect(registrationResult).toEqual({ success: true });
  });

  it('validates the invite and provisions the faculty role on the server', async () => {
    render(<AuthProvider><Harness /></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Register faculty account' }));
    await waitFor(() => expect(registrationResult).toEqual({
      success: true,
    }));

    expect(apiMock.validateFacultyInvite).toHaveBeenCalledWith('faculty-secret');
    expect(signUp).toHaveBeenCalledWith({
      email: 'jordan@example.edu',
      password: 'secure-password',
      options: {
        data: { full_name: 'Jordan Lee', requested_role: 'faculty' },
        emailRedirectTo: window.location.origin,
      },
    });
    expect(apiMock.provisionSupabaseAccount).toHaveBeenCalledWith('Jordan Lee', 'instructor', 'faculty-secret');
    expect(screen.getByText('authenticated')).toBeTruthy();
  });

  it('does not create a Supabase account when faculty invite validation fails', async () => {
    apiMock.validateFacultyInvite.mockRejectedValueOnce(new Error('The faculty invite code is invalid.'));
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Register faculty account' }));

    await waitFor(() => expect(registrationResult).toEqual({
      success: false,
      error: 'The faculty invite code is invalid.',
    }));
    expect(signUp).not.toHaveBeenCalled();
    expect(apiMock.provisionSupabaseAccount).not.toHaveBeenCalled();
  });

  it('does not request an elevated role during public registration', () => {
    const schema = readFileSync(resolve(process.cwd(), 'supabase', 'migrations', '202607050001_student_agent_schema.sql'), 'utf8');
    expect(schema).toMatch(/insert into public\.profiles \(id, email, full_name, role\)[\s\S]*?'student'\s*\)/);
    expect(schema).toContain("trusted_role not in ('student', 'faculty', 'admin')");
  });

  it('reports duplicate email errors without creating an application session', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error('User already registered'),
    });
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Register student account' }));

    await waitFor(() => expect(registrationResult?.success).toBe(false));
    expect(registrationResult?.error).toMatch(/account may already exist/i);
    expect(apiMock.provisionSupabaseAccount).not.toHaveBeenCalled();
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('requires email confirmation when Supabase does not return a session', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'student-auth-id' }, session: null },
      error: null,
    });
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Register student account' }));

    await waitFor(() => expect(registrationResult).toEqual({
      success: true,
      requiresEmailConfirmation: true,
    }));
    expect(apiMock.provisionSupabaseAccount).not.toHaveBeenCalled();
  });

  it('requires invite-code activation after faculty email confirmation', async () => {
    signUp.mockResolvedValue({
      data: { user: { id: 'faculty-auth-id' }, session: null },
      error: null,
    });
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Register faculty account' }));

    await waitFor(() => expect(registrationResult).toEqual({
      success: true,
      requiresEmailConfirmation: true,
    }));
    expect(apiMock.validateFacultyInvite).toHaveBeenCalledWith('faculty-secret');
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: { full_name: 'Jordan Lee', requested_role: 'faculty' },
      }),
    }));
    expect(apiMock.provisionSupabaseAccount).not.toHaveBeenCalled();
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('signs in after email confirmation without attaching a client-selected role', async () => {
    apiMock.login.mockResolvedValue({ token: 'supabase-token', user: studentProfile });
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('authenticated')).toBeTruthy());
    expect(apiMock.login).toHaveBeenCalledWith('jordan@example.edu', 'secure-password', 'student');
  });

  it('requires a valid invite to activate a faculty account after sign-in', async () => {
    apiMock.login.mockRejectedValue(new Error('A faculty invite code is required to activate this account.'));
    render(<AuthProvider><Harness /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in faculty' }));

    await waitFor(() => expect(registrationResult?.success).toBe(false));
    expect(registrationResult?.error).toMatch(/faculty invite code is required/i);
    expect(apiMock.login).toHaveBeenCalledWith('jordan@example.edu', 'secure-password', 'instructor', undefined);
    expect(screen.getByText('signed out')).toBeTruthy();
  });
});
