// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { api } from '../../services/api';
import { LearningAssignmentHistory } from '../../types';
import { StudyPlanner } from './StudyPlanner';

vi.mock('../../services/api', () => ({
  api: {
    getPlannerSessions: vi.fn(),
    getStudyTasks: vi.fn(),
    getLearningAssignmentHistory: vi.fn(),
  },
}));

const history: LearningAssignmentHistory = {
  overview: {
    totalAssignmentsCompleted: 1,
    totalQuestionsAttempted: 4,
    correctAnswers: 2,
    overallAccuracy: 50,
    overallTopicMastery: [],
    topicsRequiringImprovement: [],
    strengths: [],
    repeatedIncorrectTopics: [],
    difficultyPerformance: [],
    personalizedLearningPlan: [{
      topic: 'Normalization',
      courseId: 'course-1',
      courseCode: 'DBMS',
      priority: 'high',
      action: 'Review course materials, then practice this topic again.',
      reason: '50% measured accuracy across 4 questions.',
      evidenceStatus: 'MEASURED',
    }],
    evidenceNote: '',
  },
  completedAssignments: [],
};

describe('Study Planner Learning Agent integration', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows recommendations derived from completed assignment history', async () => {
    vi.mocked(api.getPlannerSessions).mockResolvedValue([]);
    vi.mocked(api.getStudyTasks).mockResolvedValue([]);
    vi.mocked(api.getLearningAssignmentHistory).mockResolvedValue(history);

    render(<StudyPlanner courses={[]} onNavigate={vi.fn()} />);

    expect(await screen.findByText('Learning Agent recommendations')).toBeTruthy();
    expect(await screen.findByText(/Normalization/)).toBeTruthy();
    expect(screen.getByText('50% measured accuracy across 4 questions.')).toBeTruthy();
  });
});
