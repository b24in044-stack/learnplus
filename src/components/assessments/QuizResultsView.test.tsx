// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssessmentResult } from '../../types';
import { QuizResultsView } from './QuizResultsView';

vi.mock('../../services/api', () => ({
  api: {
    retryLearningAssignmentAnalysis: vi.fn(),
  },
}));

import { api } from '../../services/api';

const result: AssessmentResult = {
  submissionId: 'submission-1',
  assessmentId: 'assessment-1',
  courseId: 'course-1',
  assessmentTitle: 'DBMS Practice',
  courseCode: 'DBMS',
  score: 1,
  totalQuestions: 2,
  percentage: 50,
  passed: false,
  completedAt: '2026-11-15T08:00:00Z',
  timeSpentSeconds: 30,
  topicBreakdown: [],
  questionResults: [],
  recommendedFollowUp: {
    topic: 'Normalization',
    reason: 'Review topics with the lowest accuracy.',
    practicePrompt: 'Help me review Normalization based on this AI practice result.',
  },
  aiGenerated: true,
  official: false,
};

describe('QuizResultsView tutor handoff', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('passes the completed assignment course and evidence-based prompt to the tutor', () => {
    const onNavigate = vi.fn();
    render(<QuizResultsView result={result} onRetake={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remediate in Tutor' }));

    expect(onNavigate).toHaveBeenCalledWith('tutor', {
      courseId: 'course-1',
      topicQuery: result.recommendedFollowUp.practicePrompt,
    });
  });

  it('starts learning analysis only after published results are displayed and navigates to Learning Agent', async () => {
    vi.mocked(api.retryLearningAssignmentAnalysis).mockResolvedValue({
      status: 'LEARNING_ANALYSIS_COMPLETED',
    });
    const onNavigate = vi.fn();
    render(
      <QuizResultsView
        result={{ ...result, status: 'RESULTS_PUBLISHED', learningAnalysisStatus: 'LEARNING_ANALYSIS_PENDING' }}
        onRetake={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole('heading', { name: 'DBMS Practice' })).toBeTruthy();
    await waitFor(() => {
      expect(api.retryLearningAssignmentAnalysis).toHaveBeenCalledWith('assessment-1');
      expect(screen.getByText('Learning analysis: learning analysis completed.')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open Learning Agent' }));
    expect(onNavigate).toHaveBeenCalledWith('learning-agent');
  });

  it('retains the published result and exposes a manual retry if analysis fails', async () => {
    vi.mocked(api.retryLearningAssignmentAnalysis).mockRejectedValue(new Error('Analysis unavailable'));
    render(
      <QuizResultsView
        result={{ ...result, status: 'RESULTS_PUBLISHED', learningAnalysisStatus: 'LEARNING_ANALYSIS_PENDING' }}
        onRetake={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'DBMS Practice' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('Analysis unavailable');
    expect(screen.getByRole('button', { name: 'Retry learning analysis' })).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
  });
});
