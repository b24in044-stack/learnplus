// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const { authState } = vi.hoisted(() => ({
  authState: {
    role: 'admin',
    isAuthenticated: true,
    isRestoringSession: false,
    isPasswordRecovery: false,
    user: { id: 'trusted-user-id' },
    sessionVersion: 1,
  },
}));

vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: React.PropsWithChildren) => children,
  useAuth: () => authState,
}));

vi.mock('./context/ApiStatusContext', () => ({
  ApiStatusProvider: ({ children }: React.PropsWithChildren) => children,
}));

vi.mock('./hooks/useAuthenticatedData', () => ({
  useAuthenticatedData: () => ({
    courses: [],
    assessments: [],
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

vi.mock('./components/layout/Sidebar', () => ({
  Sidebar: ({ currentTab, onSelectTab, onOpenNotifications, onOpenSettings }: {
    currentTab: string;
    onSelectTab: (tab: string) => void;
    onOpenNotifications: () => void;
    onOpenSettings: () => void;
  }) => (
    <nav aria-label="Test navigation" data-current-tab={currentTab}>
      <button onClick={() => onSelectTab('admin')}>Course Management</button>
      <button onClick={() => onSelectTab('attendance')}>Attendance Reports</button>
      <button onClick={() => onSelectTab('projects')}>Projects & Research</button>
      <button onClick={onOpenNotifications}>Inbox</button>
      <button onClick={onOpenSettings}>Settings</button>
    </nav>
  ),
}));
vi.mock('./components/layout/Header', () => ({
  Header: ({ onOpenNotifications, onOpenSettings }: {
    onOpenNotifications: () => void;
    onOpenSettings: () => void;
  }) => (
    <header>
      <button onClick={onOpenNotifications}>Header notifications</button>
      <button onClick={onOpenSettings}>Header settings</button>
    </header>
  ),
}));
vi.mock('./components/layout/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./components/layout/NotificationDrawer', () => ({
  NotificationDrawer: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => isOpen
    ? <div data-testid="inbox"><button onClick={onClose}>Close inbox</button></div>
    : null,
}));
vi.mock('./components/settings/SettingsModal', () => ({
  SettingsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => isOpen
    ? <div data-testid="settings-modal"><button onClick={onClose}>Close settings</button></div>
    : null,
}));
vi.mock('./components/auth/LoginPage', () => ({ LoginPage: () => null }));
vi.mock('./components/auth/RegistrationPage', () => ({ RegistrationPage: () => null }));
vi.mock('./components/dashboard/StudentDashboard', () => ({
  StudentDashboard: () => <div data-testid="student-dashboard" />,
}));
vi.mock('./components/instructor/InstructorWorkspace', () => ({
  InstructorWorkspace: () => <div data-testid="faculty-dashboard" />,
}));
vi.mock('./components/admin/AdminWorkspace', () => ({
  AdminWorkspace: () => <div data-testid="admin-dashboard" />,
}));
vi.mock('./components/academic/AttendanceWorkspace', () => ({
  AttendanceWorkspace: () => <div data-testid="admin-attendance" />,
}));
vi.mock('./components/academic/ProjectResearchWorkspace', () => ({
  ProjectResearchWorkspace: () => <div data-testid="admin-projects" />,
}));

const adminRoutes = [
  ['Course Management', 'admin', 'admin-dashboard'],
  ['Attendance Reports', 'attendance', 'admin-attendance'],
  ['Projects & Research', 'projects', 'admin-projects'],
] as const;

const waitForHash = (hash: string) => waitFor(() => expect(window.location.hash).toBe(`#${hash}`));

describe('role-based hash routing', () => {
  afterEach(() => {
    cleanup();
    authState.role = 'admin';
    window.history.replaceState(null, '', '/');
  });

  it.each([
    ['student', '#dashboard', 'student-dashboard'],
    ['instructor', '#instructor', 'faculty-dashboard'],
    ['admin', '#admin', 'admin-dashboard'],
  ])('routes %s to its role dashboard from an authenticated registration hash', async (role, expectedHash, dashboard) => {
    authState.role = role;
    window.history.replaceState(null, '', '/#register');

    render(<App />);

    expect(await screen.findByTestId(dashboard)).toBeTruthy();
    expect(window.location.hash).toBe(expectedHash);
    expect(screen.queryByTestId('student-dashboard')).toBe(
      role === 'student' ? screen.getByTestId('student-dashboard') : null
    );
  });

  it.each(adminRoutes)('navigates to %s by clicking its admin navigation item', async (label, hash, pageTestId) => {
    window.history.replaceState(null, '', '/#admin');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: label }));

    await waitForHash(hash);
    expect(await screen.findByTestId(pageTestId)).toBeTruthy();
  });

  it.each(adminRoutes)('opens #%s directly and retains it after a simulated refresh', async (_label, hash, pageTestId) => {
    window.history.replaceState(null, '', `/#${hash}`);
    const firstRender = render(<App />);
    expect(await screen.findByTestId(pageTestId)).toBeTruthy();
    expect(window.location.hash).toBe(`#${hash}`);

    firstRender.unmount();
    render(<App />);
    expect(await screen.findByTestId(pageTestId)).toBeTruthy();
    expect(window.location.hash).toBe(`#${hash}`);
  });

  it('restores admin routes through browser back and forward navigation', async () => {
    window.history.replaceState(null, '', '/#admin');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Attendance Reports' }));
    await screen.findByTestId('admin-attendance');
    fireEvent.click(screen.getByRole('button', { name: 'Projects & Research' }));
    await screen.findByTestId('admin-projects');
    fireEvent.click(screen.getByRole('button', { name: 'Course Management' }));
    await screen.findByTestId('admin-dashboard');

    await act(async () => { window.history.back(); });
    await waitForHash('projects');
    expect(await screen.findByTestId('admin-projects')).toBeTruthy();

    await act(async () => { window.history.back(); });
    await waitForHash('attendance');
    expect(await screen.findByTestId('admin-attendance')).toBeTruthy();

    await act(async () => { window.history.back(); });
    await waitForHash('admin');
    expect(await screen.findByTestId('admin-dashboard')).toBeTruthy();

    await act(async () => { window.history.forward(); });
    await waitForHash('attendance');
    expect(await screen.findByTestId('admin-attendance')).toBeTruthy();

    await act(async () => { window.history.forward(); });
    await waitForHash('projects');
    expect(await screen.findByTestId('admin-projects')).toBeTruthy();

    await act(async () => { window.history.forward(); });
    await waitForHash('admin');
    expect(await screen.findByTestId('admin-dashboard')).toBeTruthy();
  });

  it.each([
    ['Inbox', 'inbox', 'inbox'],
    ['Settings', 'settings', 'settings-modal'],
  ])('opens %s from navigation and supports direct links and browser history', async (label, hash, overlayTestId) => {
    window.history.replaceState(null, '', '/#attendance');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: label }));

    await waitForHash(hash);
    expect(await screen.findByTestId(overlayTestId)).toBeTruthy();
    expect(screen.getByTestId('admin-attendance')).toBeTruthy();

    await act(async () => { window.history.back(); });
    await waitForHash('attendance');
    await waitFor(() => expect(screen.queryByTestId(overlayTestId)).toBeNull());

    await act(async () => { window.history.forward(); });
    await waitForHash(hash);
    expect(await screen.findByTestId(overlayTestId)).toBeTruthy();
  });

  it.each([
    ['inbox', 'inbox'],
    ['settings', 'settings-modal'],
  ])('supports direct #%s links and close navigation', async (hash, overlayTestId) => {
    window.history.replaceState(null, '', `/#${hash}`);
    render(<App />);

    expect(await screen.findByTestId(overlayTestId)).toBeTruthy();
    expect(screen.getByTestId('admin-dashboard')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: hash === 'inbox' ? 'Close inbox' : 'Close settings' }));
    await waitForHash('admin');
    expect(screen.queryByTestId(overlayTestId)).toBeNull();
  });

  it.each([
    ['inbox', 'inbox'],
    ['settings', 'settings-modal'],
  ])('restores direct #%s links after a simulated refresh', async (hash, overlayTestId) => {
    window.history.replaceState(null, '', `/#${hash}`);
    const firstRender = render(<App />);
    expect(await screen.findByTestId(overlayTestId)).toBeTruthy();

    firstRender.unmount();
    render(<App />);
    expect(await screen.findByTestId(overlayTestId)).toBeTruthy();
    expect(window.location.hash).toBe(`#${hash}`);
  });
});
