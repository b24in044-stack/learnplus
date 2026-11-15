// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Course } from '../../types';
import { api } from '../../services/api';
import { AssessmentList } from './AssessmentList';

vi.mock('../../services/api', () => ({
  api: {
    getAssessments: vi.fn(),
    generatePracticeAssessment: vi.fn(),
  },
}));

const courses: Course[] = [{
  id: 'course-1',
  code: 'DBMS',
  title: 'Database Management Systems',
  description: '',
  instructor: 'Faculty',
  credits: 3,
  progress: 10,
  topicsCount: 0,
  materialsCount: 0,
}];

describe('assignment module', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens custom assignment generation from the Assignment module', async () => {
    vi.mocked(api.getAssessments).mockResolvedValue([]);

    render(
      <AssessmentList
        courses={courses}
        onStartQuiz={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create my own assignment' }));

    expect(await screen.findByRole('heading', { name: 'Create my own practice assignment' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to Assignments/ })).toBeTruthy();
  });
});
