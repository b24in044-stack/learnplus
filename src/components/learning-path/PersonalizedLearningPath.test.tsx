// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../services/api';
import { Course } from '../../types';
import { PersonalizedLearningPath } from './PersonalizedLearningPath';

vi.mock('../../services/api', () => ({
  api: {
    getLearningPath: vi.fn(),
    getPersonalizedLearning: vi.fn(),
  },
}));

const courses: Course[] = [{
  id: 'course-cs101',
  code: 'CS 101',
  title: 'Foundations of Computing',
  description: '',
  instructor: '',
  credits: 3,
  progress: 0,
  topicsCount: 0,
  materialsCount: 0,
}];

describe('personalized learning path errors', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the request failure and retries instead of showing an empty-path state', async () => {
    vi.mocked(api.getLearningPath)
      .mockRejectedValueOnce(new Error('Learning path service is unavailable.'))
      .mockResolvedValueOnce([]);
    vi.mocked(api.getPersonalizedLearning).mockResolvedValue({
      task_type: 'personalized_learning',
      data: { recommendations: { recommendations: [] } },
      agent_steps: [],
    });
    render(<PersonalizedLearningPath courses={courses} onNavigate={vi.fn()} />);

    expect(await screen.findByText('Learning path service is unavailable.')).toBeTruthy();
    expect(screen.queryByText('No Learning Path Generated')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Request' }));

    expect(await screen.findByText('No Learning Path Generated')).toBeTruthy();
  });

  it('shows evidence-backed AI recommendations when no saved path exists', async () => {
    vi.mocked(api.getLearningPath).mockResolvedValue([]);
    vi.mocked(api.getPersonalizedLearning).mockResolvedValue({
      task_type: 'personalized_learning',
      data: {
        recommendations: {
          recommendations: [{
            topicId: 'recursion',
            topic: 'Recursion',
            reason: 'Recent graded practice responses indicate this concept needs revision.',
          }],
        },
      },
      agent_steps: [],
    });

    render(<PersonalizedLearningPath courses={courses} onNavigate={vi.fn()} />);

    expect(await screen.findByText('AI recommendations based on your graded practice:')).toBeTruthy();
    expect(screen.getByText('Recursion:')).toBeTruthy();
  });
});
