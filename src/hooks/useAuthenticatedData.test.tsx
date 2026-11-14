// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { useAuthenticatedData } from './useAuthenticatedData';
import { api } from '../services/api';
import { Assessment, Course, User } from '../types';

vi.mock('../services/api', () => ({
  api: {
    getCourses: vi.fn(),
    getAssessments: vi.fn(),
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    getToken: vi.fn(),
    clearUserData: vi.fn(),
    logout: vi.fn(),
    setToken: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const testUser: User = {
  id: 'student-1',
  name: 'Test Student',
  email: 'student@example.edu',
  role: 'student',
  avatarUrl: '',
  department: 'Computer Science',
  enrolledSince: '2026',
};
const testCourse = { id: 'course-1', code: 'CS 101', title: 'Foundations' } as Course;
const testAssessment = { id: 'assessment-1', title: 'Quiz 1' } as Assessment;

function Harness({ role = 'student' }: { role?: User['role'] }) {
  const auth = useAuth();
  const data = useAuthenticatedData();
  return (
    <div>
      <button onClick={() => void auth.signIn('student@example.edu', 'password', role)}>Sign in</button>
      <button onClick={auth.signOut}>Sign out</button>
      <span>{auth.isAuthenticated ? 'authenticated' : 'signed out'}</span>
      <span>{data.isLoading ? 'loading' : 'not loading'}</span>
      {data.error && <span>{data.error}</span>}
      {data.courses.map((course) => <span key={course.id}>course:{course.id}</span>)}
      {data.assessments.map((assessment) => <span key={assessment.id}>assessment:{assessment.id}</span>)}
    </div>
  );
}

function renderHarness() {
  return render(<AuthProvider><Harness /></AuthProvider>);
}

describe('useAuthenticatedData', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    localStorage.clear();
    window.location.hash = '';
    mockedApi.login.mockResolvedValue({ token: 'test-token', user: testUser });
    mockedApi.getToken.mockReturnValue(null);
    mockedApi.getCurrentUser.mockResolvedValue(testUser);
    mockedApi.getCourses.mockResolvedValue([testCourse]);
    mockedApi.getAssessments.mockResolvedValue([testAssessment]);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('loads courses and assessments only after successful authentication', async () => {
    renderHarness();
    expect(mockedApi.getCourses).not.toHaveBeenCalled();
    expect(mockedApi.getAssessments).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Sign in'));

    expect(await screen.findByText('course:course-1')).toBeTruthy();
    expect(screen.getByText('assessment:assessment-1')).toBeTruthy();
    expect(mockedApi.getCourses).toHaveBeenCalledTimes(1);
    expect(mockedApi.getAssessments).toHaveBeenCalledTimes(1);
  });

  it('does not request student data for administrator sessions', async () => {
    mockedApi.login.mockResolvedValue({
      token: 'admin-token',
      user: { ...testUser, id: 'admin-1', role: 'admin' },
    });
    render(<AuthProvider><Harness role="admin" /></AuthProvider>);

    fireEvent.click(screen.getByText('Sign in'));

    expect(await screen.findByText('authenticated')).toBeTruthy();
    expect(screen.getByText('not loading')).toBeTruthy();
    expect(mockedApi.getCourses).not.toHaveBeenCalled();
    expect(mockedApi.getAssessments).not.toHaveBeenCalled();
  });

  it('loads faculty courses without requesting student-only assessments', async () => {
    mockedApi.login.mockResolvedValue({
      token: 'faculty-token',
      user: { ...testUser, id: 'faculty-1', role: 'instructor' },
    });
    render(<AuthProvider><Harness role="instructor" /></AuthProvider>);

    fireEvent.click(screen.getByText('Sign in'));

    expect(await screen.findByText('course:course-1')).toBeTruthy();
    expect(mockedApi.getCourses).toHaveBeenCalledTimes(1);
    expect(mockedApi.getAssessments).not.toHaveBeenCalled();
  });

  it('waits for a stored session to validate before loading protected data', async () => {
    localStorage.setItem('sa_ai_auth_token', 'stored-token');
    localStorage.setItem('sa_ai_role', 'student');
    mockedApi.getToken.mockReturnValue('stored-token');
    let restoreSession!: (user: User) => void;
    mockedApi.getCurrentUser.mockImplementationOnce(() => new Promise((resolve) => { restoreSession = resolve; }));

    renderHarness();
    expect(mockedApi.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(mockedApi.getCourses).not.toHaveBeenCalled();

    restoreSession(testUser);
    expect(await screen.findByText('course:course-1')).toBeTruthy();
    expect(screen.getByText('assessment:assessment-1')).toBeTruthy();
  });

  it('ends the session on logout and ignores responses that arrive after logout', async () => {
    let resolveCourses!: (courses: Course[]) => void;
    let resolveAssessments!: (assessments: Assessment[]) => void;
    mockedApi.getCourses.mockImplementationOnce(() => new Promise((resolve) => { resolveCourses = resolve; }));
    mockedApi.getAssessments.mockImplementationOnce(() => new Promise((resolve) => { resolveAssessments = resolve; }));

    renderHarness();
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByText('loading')).toBeTruthy());

    fireEvent.click(screen.getByText('Sign out'));
    expect(await screen.findByText('signed out')).toBeTruthy();
    expect(mockedApi.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('course:course-1')).toBeNull();
    expect(screen.queryByText('assessment:assessment-1')).toBeNull();

    resolveCourses([testCourse]);
    resolveAssessments([testAssessment]);
    await waitFor(() => expect(screen.getByText('not loading')).toBeTruthy());
    expect(screen.queryByText('course:course-1')).toBeNull();
    expect(screen.queryByText('assessment:assessment-1')).toBeNull();
  });
});
