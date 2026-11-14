// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

const { apiMock, authClient, registerListener } = vi.hoisted(() => ({
  apiMock: {
    setToken: vi.fn(),
    getCurrentUser: vi.fn(),
    getToken: vi.fn(),
    clearUserData: vi.fn(),
    logout: vi.fn(),
  },
  authClient: { auth: {} as Record<string, ReturnType<typeof vi.fn>> },
  registerListener: vi.fn(),
}));

vi.mock('../services/api', () => ({ api: apiMock }));
vi.mock('../services/supabase', () => ({
  getSupabaseClient: () => authClient,
  isSupabaseConfigured: () => true,
}));

let emitAuthEvent!: (event: string, session: null | {
  access_token: string;
  user: { id: string };
}) => void;

function Harness() {
  const auth = useAuth();
  return (
    <>
      <span>{auth.isAuthenticated ? `authenticated:${auth.user.id}` : 'signed out'}</span>
      <button onClick={auth.signOut}>Sign out</button>
    </>
  );
}

describe('Supabase session restoration', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    localStorage.clear();
    apiMock.getCurrentUser.mockResolvedValue({
      id: 'user-1',
      name: 'Student',
      email: 'student@example.edu',
      role: 'student',
      avatarUrl: '',
      department: '',
      enrolledSince: '',
    });
    registerListener.mockImplementation((callback: typeof emitAuthEvent) => {
      emitAuthEvent = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    authClient.auth.onAuthStateChange = registerListener;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('clears invalid restored credentials and returns to signed-out state', async () => {
    apiMock.getCurrentUser.mockRejectedValueOnce(new Error('expired'));
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(registerListener).toHaveBeenCalled());

    emitAuthEvent('SIGNED_IN', {
      access_token: 'expired-token',
      user: { id: 'user-1' },
    });
    await waitFor(() => expect(apiMock.clearUserData).toHaveBeenCalled());
    expect(apiMock.setToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('ignores a profile response that completes after Supabase signs out', async () => {
    let resolveProfile!: (user: {
      id: string; name: string; email: string; role: 'student';
      avatarUrl: string; department: string; enrolledSince: string;
    }) => void;
    apiMock.getCurrentUser.mockImplementationOnce(() => new Promise((resolve) => { resolveProfile = resolve; }));
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(registerListener).toHaveBeenCalled());

    emitAuthEvent('SIGNED_IN', {
      access_token: 'restored-token',
      user: { id: 'user-1' },
    });
    await waitFor(() => expect(apiMock.getCurrentUser).toHaveBeenCalledTimes(1));
    emitAuthEvent('SIGNED_OUT', null);
    resolveProfile({
      id: 'user-1',
      name: 'Student',
      email: 'student@example.edu',
      role: 'student',
      avatarUrl: '',
      department: '',
      enrolledSince: '',
    });

    await waitFor(() => expect(screen.getByText('signed out')).toBeTruthy());
    expect(screen.queryByText('authenticated:user-1')).toBeNull();
  });

  it('waits for Supabase logout before clearing the authenticated UI', async () => {
    let finishLogout!: () => void;
    apiMock.logout.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishLogout = resolve;
    }));
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(registerListener).toHaveBeenCalled());

    emitAuthEvent('SIGNED_IN', {
      access_token: 'test-token',
      user: { id: 'user-1' },
    });
    await waitFor(() => expect(screen.getByText('authenticated:user-1')).toBeTruthy());

    fireEvent.click(screen.getByText('Sign out'));
    await waitFor(() => expect(apiMock.logout).toHaveBeenCalledTimes(1));
    emitAuthEvent('SIGNED_OUT', null);
    expect(screen.getByText('authenticated:user-1')).toBeTruthy();

    finishLogout();
    await waitFor(() => expect(screen.getByText('signed out')).toBeTruthy());
  });
});
