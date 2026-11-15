// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Course } from '../../types';
import { api } from '../../services/api';
import { AssignmentGenerationWorkspace } from './AssignmentGenerationWorkspace';

vi.mock('../../services/api', () => ({
  api: {
    generatePracticeAssessment: vi.fn(),
  },
}));

vi.mock('./QuizRunner', () => ({
  QuizRunner: ({ assessment }: { assessment: { title: string } }) => (
    <p>Generated: {assessment.title}</p>
  ),
}));

vi.mock('./QuizResultsView', () => ({
  QuizResultsView: () => <p>Assignment results</p>,
}));

const courses: Course[] = [{
  id: 'course-1',
  code: 'DBMS',
  title: 'Database Management Systems',
  description: 'Database concepts',
  instructor: 'Faculty',
  credits: 3,
  progress: 10,
  topicsCount: 2,
  materialsCount: 0,
  topics: [
    { id: 'topic-1', courseId: 'course-1', title: 'Normalization', order: 1, isCompleted: false, prerequisites: [], estimatedMinutes: 30, resourcesCount: 0 },
    { id: 'topic-2', courseId: 'course-1', title: 'Transactions', order: 2, isCompleted: false, prerequisites: [], estimatedMinutes: 30, resourcesCount: 0 },
  ],
}, {
  id: 'course-2',
  code: 'MATH 101',
  title: 'Discrete Mathematics',
  description: 'Discrete mathematics concepts',
  instructor: 'Faculty',
  credits: 3,
  progress: 10,
  topicsCount: 1,
  materialsCount: 0,
  topics: [
    { id: 'topic-3', courseId: 'course-2', title: 'Graph Theory', order: 1, isCompleted: false, prerequisites: [], estimatedMinutes: 30, resourcesCount: 0 },
  ],
}];

describe('Assignment Generation Agent workflow', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('sends the selected subject, optional topics, difficulty, and count to the backend', async () => {
    vi.mocked(api.generatePracticeAssessment).mockResolvedValue({
      assessmentId: 'assessment-1',
      courseId: 'course-2',
      courseCode: 'MATH 101',
      title: 'Discrete Mathematics Practice',
      topic: 'Graph Theory',
      topics: ['Graph Theory'],
      difficulty: 'Advanced',
      format: 'mcq',
      aiGenerated: true,
      official: false,
      durationMinutes: 15,
      passingScore: 70,
      questions: [{
        id: 'question-1',
        question: 'What is a graph?',
        topic: 'Graph Theory',
        format: 'mcq',
        options: ['A', 'B'],
      }],
    });

    render(<AssignmentGenerationWorkspace courses={courses} onNavigate={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'course-2' } });
    fireEvent.click(screen.getByLabelText('Graph Theory'));
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'Advanced' } });
    fireEvent.change(screen.getByLabelText('Number of questions'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate assignment/i }));

    await waitFor(() => {
      expect(api.generatePracticeAssessment).toHaveBeenCalledWith(expect.objectContaining({
        courseId: 'course-2',
        courseCode: 'MATH 101',
        topics: ['Graph Theory'],
        difficulty: 'Advanced',
        questionCount: 3,
      }));
    });
    expect(await screen.findByText('Generated: Discrete Mathematics Practice')).toBeTruthy();
  });

  it('reports provider errors and keeps the generation form available for retry', async () => {
    vi.mocked(api.generatePracticeAssessment).mockRejectedValue(new Error('Groq is unavailable.'));
    render(<AssignmentGenerationWorkspace courses={courses} onNavigate={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Generate assignment/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Groq is unavailable.');
    expect(screen.getByLabelText('Subject')).toBeTruthy();
  });
});
