// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Course, FacultyAssessmentDraft } from '../../types';
import { InstructorWorkspace } from './InstructorWorkspace';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../services/api', () => ({
  api: {
    getDocuments: vi.fn(),
    getCourseAcademicFoundation: vi.fn(),
    getFacultyCourseRoster: vi.fn(),
    createCourseAcademicResource: vi.fn(),
    generateFacultyAssessmentDraft: vi.fn(),
    publishFacultyAssessment: vi.fn(),
  },
}));

const course: Course = {
  id: 'course-1',
  code: 'CS 101',
  title: 'Foundations of Computing',
  description: '',
  instructor: 'Faculty Member',
  credits: 3,
  progress: 0,
  topicsCount: 0,
  materialsCount: 0,
};

const emptyFoundation = {
  outcomes: [],
  units: [],
  schedules: [],
  announcements: [],
  assignments: [],
};

const draft: FacultyAssessmentDraft = {
  id: 'draft-1',
  courseId: 'course-1',
  courseCode: 'CS 101',
  title: 'Practice Assessment',
  topic: 'Algorithms',
  difficulty: 'Intermediate',
  durationMinutes: 10,
  passingScore: 70,
  questions: [{
    id: 'question-1',
    topicTag: 'Algorithms',
    questionText: 'What is an algorithm?',
    options: ['A procedure', 'A database'],
    correctOptionIndex: 0,
    explanation: 'An algorithm is a finite procedure.',
  }],
  status: 'draft',
  createdAt: '2026-11-15T00:00:00Z',
};

describe('faculty assignments module', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('publishes a manual course assignment with its deadline and points', async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: 'instructor',
      user: { id: 'faculty-1', name: 'Faculty Member', department: 'Computer Science' },
    } as ReturnType<typeof useAuth>);
    vi.mocked(api.getDocuments).mockResolvedValue([]);
    vi.mocked(api.getCourseAcademicFoundation).mockResolvedValue(emptyFoundation);
    vi.mocked(api.getFacultyCourseRoster).mockResolvedValue([]);
    vi.mocked(api.createCourseAcademicResource).mockResolvedValue({ id: 'assignment-1' });

    render(<InstructorWorkspace courses={[course]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Assignments' }));
    fireEvent.change(screen.getByLabelText('Assignment title'), { target: { value: 'Week 1 work' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Complete exercises 1–5.' } });
    fireEvent.change(screen.getByLabelText('Due date (optional)'), { target: { value: '2026-11-30T12:00' } });
    fireEvent.change(screen.getByLabelText('Maximum points'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish assignment to class' }));

    await waitFor(() => expect(api.createCourseAcademicResource).toHaveBeenCalledWith(
      'course-1',
      'assignments',
      expect.objectContaining({
        title: 'Week 1 work',
        description: 'Complete exercises 1–5.',
        dueAt: new Date('2026-11-30T12:00').toISOString(),
        maxPoints: 25,
        status: 'published',
      }),
    ));
    expect((await screen.findByRole('status')).textContent).toContain('Assignment published for enrolled students.');
  });

  it('generates and publishes an AI assessment for the selected course', async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: 'instructor',
      user: { id: 'faculty-1', name: 'Faculty Member', department: 'Computer Science' },
    } as ReturnType<typeof useAuth>);
    vi.mocked(api.getDocuments).mockResolvedValue([]);
    vi.mocked(api.getCourseAcademicFoundation).mockResolvedValue(emptyFoundation);
    vi.mocked(api.getFacultyCourseRoster).mockResolvedValue([]);
    vi.mocked(api.generateFacultyAssessmentDraft).mockResolvedValue(draft);
    vi.mocked(api.publishFacultyAssessment).mockResolvedValue({
      id: 'assessment-1',
      courseId: 'course-1',
      courseCode: 'CS 101',
      title: draft.title,
      topic: draft.topic,
      difficulty: draft.difficulty,
      questionCount: 1,
      durationMinutes: draft.durationMinutes,
      passingScore: draft.passingScore,
      attemptsCount: 0,
      questions: [],
    });

    render(<InstructorWorkspace courses={[course]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Assignments' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI assessment generator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate assessment draft' }));

    expect(await screen.findByLabelText('Assessment title')).toBeTruthy();
    expect(api.generateFacultyAssessmentDraft).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'course-1',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Publish to Class' }));
    await waitFor(() => expect(api.publishFacultyAssessment).toHaveBeenCalledWith(draft));
    expect(await screen.findByText(/Assessment published successfully/)).toBeTruthy();
  });
});
