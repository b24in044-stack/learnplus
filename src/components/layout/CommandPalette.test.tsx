// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';

const props = {
  isOpen: true,
  onClose: vi.fn(),
  onNavigate: vi.fn(),
  courses: [],
  assessments: [],
};

describe('role-specific File Storage commands', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not expose file management to students', () => {
    render(<CommandPalette {...props} role="student" />);

    expect(screen.queryByText('Upload or View Study Materials')).toBeNull();
  });

  it('keeps file management available to faculty', () => {
    render(<CommandPalette {...props} role="instructor" />);

    expect(screen.getByText('Upload or View Study Materials')).toBeTruthy();
  });
});
