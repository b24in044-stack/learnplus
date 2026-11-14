// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '../../services/api';
import { LearningAnalytics } from './LearningAnalytics';

vi.mock('../../services/api', () => ({
  api: {
    getAnalytics: vi.fn(),
    getAgentRecommendations: vi.fn(),
  },
}));

const course = {
  id: 'course-cs101',
  code: 'CS 101',
  title: 'Foundations of Computing',
  description: '',
  instructor: '',
  credits: 3,
  progress: 0,
  topicsCount: 0,
  materialsCount: 0,
};

describe('learning analytics errors', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the request failure and retries instead of showing an empty-record state', async () => {
    vi.mocked(api.getAnalytics)
      .mockRejectedValueOnce(new Error('Progress service is unavailable.'))
      .mockResolvedValueOnce({
        averageScore: 0,
        assessmentsCompleted: 0,
        enrolledCoursesCount: 0,
        conceptsMasteredCount: 0,
        totalConceptsCount: 0,
        weeklyActivity: [],
        scoreProgression: [],
        weakTopics: [],
        conceptMasteryList: [],
      });
    render(<LearningAnalytics courses={[]} onNavigate={vi.fn()} />);

    expect(await screen.findByText('Progress service is unavailable.')).toBeTruthy();
    expect(screen.queryByText('No Learning Records')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Request' }));

    expect(await screen.findByText('Average Exam Score')).toBeTruthy();
    expect(screen.queryByText('Progress service is unavailable.')).toBeNull();
  });

  it('uses personalized agent recommendations in the existing remediation section', async () => {
    vi.mocked(api.getAnalytics).mockResolvedValue({
      averageScore: 0,
      assessmentsCompleted: 0,
      enrolledCoursesCount: 1,
      conceptsMasteredCount: 0,
      totalConceptsCount: 0,
      weeklyActivity: [],
      scoreProgression: [],
      weakTopics: [],
      conceptMasteryList: [],
    });
    vi.mocked(api.getAgentRecommendations).mockResolvedValue({
      task_type: 'recommendations',
      data: {
        recommendations: {
          recommendations: [{
            topicId: 'functions',
            topic: 'Functions',
            masteryEstimate: 42.5,
            reason: 'Recent graded practice responses indicate this concept needs revision.',
          }],
        },
      },
      agent_steps: [],
    });

    render(<LearningAnalytics courses={[course]} onNavigate={vi.fn()} />);

    expect(await screen.findByText('Topics selected from your estimated mastery and graded practice evidence:')).toBeTruthy();
    expect(screen.getByText('Functions')).toBeTruthy();
    expect(screen.getByText('43%')).toBeTruthy();
  });
});
