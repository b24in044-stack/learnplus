// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentResult } from '../../types';
import { QuizResultsView } from './QuizResultsView';

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
  it('passes the completed assignment course and evidence-based prompt to the tutor', () => {
    const onNavigate = vi.fn();
    render(<QuizResultsView result={result} onRetake={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remediate in Tutor' }));

    expect(onNavigate).toHaveBeenCalledWith('tutor', {
      courseId: 'course-1',
      topicQuery: result.recommendedFollowUp.practicePrompt,
    });
  });
});
