// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useAuth } from '../../context/AuthContext';
import { Sidebar } from './Sidebar';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const props = {
  currentTab: 'dashboard' as const,
  onSelectTab: vi.fn(),
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenNotifications: vi.fn(),
  isMobileOpen: false,
};

function renderSidebar(role: 'student' | 'instructor') {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'user-1', name: 'Jordan Lee', avatarUrl: '', department: '', role },
    role,
    switchRole: vi.fn(),
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  return render(<Sidebar {...props} />);
}

describe('role-specific File Storage navigation', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not expose File Storage to students', () => {
    renderSidebar('student');

    expect(screen.queryByRole('button', { name: 'File Storage' })).toBeNull();
  });

  it('keeps File Storage available to faculty', () => {
    renderSidebar('instructor');

    expect(screen.getByRole('button', { name: 'File Storage' })).toBeTruthy();
  });
});
