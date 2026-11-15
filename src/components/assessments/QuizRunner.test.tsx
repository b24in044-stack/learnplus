// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Assessment } from '../../types';
import { QuizRunner } from './QuizRunner';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../services/api', () => ({
  api: {
    startPracticeAssessment: vi.fn(),
    submitAssessment: vi.fn(),
  },
}));

const assessment: Assessment = {
  id: 'assessment-1',
  courseId: 'course-1',
  courseCode: 'DBMS',
  title: 'Database Practice',
  topic: 'Database Management Systems',
  difficulty: 'Intermediate',
  questionCount: 2,
  durationMinutes: 15,
  passingScore: 70,
  attemptsCount: 0,
  aiGenerated: true,
  official: false,
  questions: [
    { id: 'question-1', questionText: 'Question one?', options: ['A', 'B'], explanation: '', topicTag: 'Normalization' },
    { id: 'question-2', questionText: 'Question two?', options: ['A', 'B'], explanation: '', topicTag: 'Transactions' },
  ],
};

describe('practice assignment submission', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('sends unanswered items to the backend for draft recording without publishing results', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'student-1',
        name: 'Student',
        email: 'student@example.edu',
        role: 'student',
        avatarUrl: '',
        department: '',
        enrolledSince: '',
      },
    } as ReturnType<typeof useAuth>);
    vi.mocked(api.startPracticeAssessment).mockResolvedValue();
    vi.mocked(api.submitAssessment).mockRejectedValue(
      new Error('Answer every question before submitting this assignment.'),
    );
    const onComplete = vi.fn();

    render(<QuizRunner assessment={assessment} onCancel={vi.fn()} onComplete={onComplete} />);
    await waitFor(() => expect(api.startPracticeAssessment).toHaveBeenCalledWith('assessment-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit Assessment' }).hasAttribute('disabled')).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Submit Assessment' }));
    expect(screen.getByText(/2 question\(s\) are unanswered/)).toBeTruthy();
    expect(screen.getByText(/in-progress draft/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Submit' }));

    await waitFor(() => {
      expect(api.submitAssessment).toHaveBeenCalledWith(expect.objectContaining({
        assessmentId: 'assessment-1',
        answers: {},
        aiGenerated: true,
      }));
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
