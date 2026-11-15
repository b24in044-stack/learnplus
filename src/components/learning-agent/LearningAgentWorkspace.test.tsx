// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LearningAssignmentDetail, LearningAssignmentHistory } from '../../types';
import { api } from '../../services/api';
import { LearningAgentWorkspace } from './LearningAgentWorkspace';

vi.mock('../../services/api', () => ({
  api: {
    getLearningAssignmentHistory: vi.fn(),
    getLearningAssignmentDetail: vi.fn(),
    retryLearningAssignmentAnalysis: vi.fn(),
  },
}));

const assignment: LearningAssignmentHistory['completedAssignments'][number] = {
  id: 'assignment-1',
  assignmentNumber: 1,
  name: 'DBMS Practice',
  displayName: 'Assignment 1 — Database Management Systems',
  subject: 'Database Management Systems',
  courseId: 'course-1',
  courseCode: 'DBMS',
  topics: ['Normalization'],
  completionDate: '2026-11-15T08:00:00Z',
  score: 1,
  maximumScore: 1,
  percentage: 100,
  completionStatus: 'RESULTS_PUBLISHED',
  learningAnalysisStatus: 'LEARNING_ANALYSIS_FAILED',
  difficulty: 'Intermediate',
  totalQuestions: 1,
};

const history: LearningAssignmentHistory = {
  overview: {
    totalAssignmentsCompleted: 1,
    totalQuestionsAttempted: 1,
    correctAnswers: 1,
    overallAccuracy: 100,
    overallTopicMastery: [{
      topic: 'Normalization',
      courseId: 'course-1',
      courseCode: 'DBMS',
      attempts: 1,
      correct: 1,
      accuracy: 100,
      estimatedMastery: null,
      evidenceStatus: 'INSUFFICIENT_EVIDENCE',
      assignmentCount: 1,
      repeatedIncorrectAnswers: 0,
      improvementAcrossAssignments: null,
    }],
    topicsRequiringImprovement: [{
      topic: 'Indexing',
      courseId: 'course-1',
      courseCode: 'DBMS',
      attempts: 2,
      correct: 0,
      accuracy: 0,
      estimatedMastery: null,
      evidenceStatus: 'INSUFFICIENT_EVIDENCE',
      assignmentCount: 1,
      repeatedIncorrectAnswers: 2,
      improvementAcrossAssignments: null,
    }],
    strengths: [],
    repeatedIncorrectTopics: [{
      topic: 'Indexing',
      courseId: 'course-1',
      courseCode: 'DBMS',
      attempts: 2,
      correct: 0,
      accuracy: 0,
      estimatedMastery: null,
      evidenceStatus: 'INSUFFICIENT_EVIDENCE',
      assignmentCount: 1,
      repeatedIncorrectAnswers: 2,
      improvementAcrossAssignments: null,
    }],
    difficultyPerformance: [{ difficulty: 'Intermediate', attempted: 1, correct: 1, accuracy: 100 }],
    personalizedLearningPlan: [],
    evidenceNote: 'Mastery estimates require three questions.',
  },
  completedAssignments: [assignment],
};

const detail: LearningAssignmentDetail = {
  assignment,
  details: {
    totalQuestions: 1,
    correctAnswers: 1,
    incorrectAnswers: 0,
    marksObtained: 1,
    maximumScore: 1,
    percentage: 100,
    topicPerformance: [{ topic: 'Normalization', score: 1, total: 1, percentage: 100 }],
    questionResults: [{
      questionId: 'question-1',
      questionText: 'Question on normalization',
      selectedOption: 0,
      selectedAnswer: 'First normal form',
      correctOption: 0,
      correctAnswer: 'First normal form',
      isCorrect: true,
      explanation: 'The relation is in first normal form.',
      topic: 'Normalization',
    }],
    difficultyPerformance: [{ difficulty: 'Intermediate', attempted: 1, correct: 1, accuracy: 100 }],
    strengths: [],
    weaknesses: [],
  },
};

describe('Learning Agent workspace', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows real assignment history and opens its isolated detailed analysis', async () => {
    vi.mocked(api.getLearningAssignmentHistory).mockResolvedValue(history);
    vi.mocked(api.getLearningAssignmentDetail).mockResolvedValue(detail);

    render(<LearningAgentWorkspace onNavigate={vi.fn()} />);
    expect(await screen.findByText('COMPLETED ASSIGNMENTS')).toBeTruthy();
    expect(screen.getByText('Assignments completed')).toBeTruthy();
    expect(screen.getByText('Assignment 1 — Database Management Systems')).toBeTruthy();
    expect(screen.getByText('Topics requiring improvement')).toBeTruthy();
    expect(screen.getByText('Indexing · DBMS')).toBeTruthy();
    expect(screen.getByText(/Repeated incorrect answers: Indexing/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Assignment 1 — Database Management Systems/ }));

    expect(await screen.findByText('INDIVIDUAL ASSIGNMENT ANALYSIS')).toBeTruthy();
    expect(screen.getAllByText('First normal form')).toHaveLength(2);
    expect(api.getLearningAssignmentDetail).toHaveBeenCalledWith('assignment-1');
  });

  it('allows a failed analysis to be retried without losing the assignment', async () => {
    vi.mocked(api.getLearningAssignmentHistory).mockResolvedValue(history);
    vi.mocked(api.retryLearningAssignmentAnalysis).mockResolvedValue({ status: 'LEARNING_ANALYSIS_COMPLETED' });

    render(<LearningAgentWorkspace onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry analysis' }));

    await waitFor(() => {
      expect(api.retryLearningAssignmentAnalysis).toHaveBeenCalledWith('assignment-1');
      expect(api.getLearningAssignmentHistory).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText(/Assignment 1 — Database Management Systems/)).toBeTruthy();
  });
});
