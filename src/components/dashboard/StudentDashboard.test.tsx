// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { AnalyticsData, Course, LearningAssignmentHistory, StudyPlannerTask } from '../../types';
import { StudentDashboard } from './StudentDashboard';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../services/api', () => ({
  api: {
    getCourses: vi.fn(),
    getAnalytics: vi.fn(),
    getRecommendations: vi.fn(),
    getLearningAssignmentHistory: vi.fn(),
    getStudyTasks: vi.fn(),
    toggleStudyTask: vi.fn(),
  },
}));

const courses: Course[] = [
  {
    id: 'course-a',
    code: 'CS 101',
    title: 'Foundations of Computing',
    description: '',
    instructor: 'Faculty Member',
    credits: 3,
    progress: 50,
    topicsCount: 5,
    materialsCount: 0,
  },
  {
    id: 'course-b',
    code: 'CS 102',
    title: 'Data Structures',
    description: '',
    instructor: 'Faculty Member',
    credits: 3,
    progress: 100,
    topicsCount: 3,
    materialsCount: 0,
  },
];

const analytics: AnalyticsData = {
  averageScore: 84,
  assessmentsCompleted: 2,
  enrolledCoursesCount: 2,
  conceptsMasteredCount: 0,
  totalConceptsCount: 0,
  weeklyActivity: [
    { day: 'Mon', date: '2026-11-02', minutes: 60, eventsCount: 1 },
    { day: 'Tue', date: '2026-11-03', minutes: 30, eventsCount: 1 },
  ],
  scoreProgression: [],
  weakTopics: [],
  conceptMasteryList: [],
};
const assignmentHistory: LearningAssignmentHistory = {
  overview: {
    totalAssignmentsCompleted: 0,
    totalQuestionsAttempted: 0,
    correctAnswers: 0,
    overallAccuracy: null,
    overallTopicMastery: [],
    topicsRequiringImprovement: [],
    strengths: [],
    repeatedIncorrectTopics: [],
    difficultyPerformance: [],
    personalizedLearningPlan: [],
    evidenceNote: '',
  },
  completedAssignments: [],
};

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const initialTasks: StudyPlannerTask[] = [
  {
    id: 'task-1',
    courseId: 'course-a',
    courseCode: 'CS 101',
    title: 'Read chapter 2',
    dueDate: localDateKey(new Date()),
    dueTime: '10:00',
    type: 'review',
    completed: false,
    priority: 'medium',
  },
];

describe('student dashboard', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'student-1',
        name: 'Jordan Lee',
        email: 'jordan@example.edu',
        role: 'student',
        avatarUrl: '',
        department: 'Computer Science',
        enrolledSince: '',
      },
    } as ReturnType<typeof useAuth>);
    vi.mocked(api.getCourses).mockResolvedValue(courses);
    vi.mocked(api.getAnalytics).mockResolvedValue(analytics);
    vi.mocked(api.getRecommendations).mockResolvedValue([]);
    vi.mocked(api.getLearningAssignmentHistory).mockResolvedValue(assignmentHistory);
    vi.mocked(api.getStudyTasks).mockResolvedValue(initialTasks);
    vi.mocked(api.toggleStudyTask).mockResolvedValue([{ ...initialTasks[0], completed: true }]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders learning metrics and courses from API data without inventing certificate totals', async () => {
    render(<StudentDashboard onNavigate={vi.fn()} />);

    expect(await screen.findByText('Foundations of Computing')).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'Learning summary' });
    expect(within(summary).getByText('8')).toBeTruthy();
    expect(within(summary).getByText('1.5')).toBeTruthy();
    expect(within(summary).getByText('—')).toBeTruthy();
    expect(screen.getByText('Jordan Lee')).toBeTruthy();
    expect(await screen.findByText('0 completed · accuracy not yet measured')).toBeTruthy();
    expect(api.getLearningAssignmentHistory).toHaveBeenCalledTimes(1);
  });

  it('navigates from the dashboard to the real completed-assignment workspace', async () => {
    const onNavigate = vi.fn();
    render(<StudentDashboard onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole('button', { name: /Learning Agent/ }));
    expect(onNavigate).toHaveBeenCalledWith('learning-agent');
  });

  it('shows completed assignment totals from the student learning history', async () => {
    vi.mocked(api.getLearningAssignmentHistory).mockResolvedValue({
      ...assignmentHistory,
      overview: {
        ...assignmentHistory.overview,
        totalAssignmentsCompleted: 3,
        overallAccuracy: 76,
      },
    });
    render(<StudentDashboard onNavigate={vi.fn()} />);

    expect(await screen.findByText('3 completed · 76% overall accuracy')).toBeTruthy();
  });

  it('keeps the rest of the dashboard available when assignment history fails', async () => {
    vi.mocked(api.getLearningAssignmentHistory).mockRejectedValue(new Error('History unavailable'));
    render(<StudentDashboard onNavigate={vi.fn()} />);

    expect(await screen.findByText('Foundations of Computing')).toBeTruthy();
    expect(await screen.findByText('Assignment history unavailable: History unavailable')).toBeTruthy();
  });

  it('persists task checkbox changes through the planner API', async () => {
    render(<StudentDashboard onNavigate={vi.fn()} />);

    const task = await screen.findByRole('checkbox', { name: 'Mark Read chapter 2 complete' });
    fireEvent.click(task);

    await waitFor(() => expect(api.toggleStudyTask).toHaveBeenCalledWith('task-1'));
    expect(await screen.findByRole('checkbox', { name: 'Mark Read chapter 2 incomplete' })).toBeTruthy();
  });

  it('filters the course cards by completion status', async () => {
    render(<StudentDashboard onNavigate={vi.fn()} />);
    await screen.findByText('Foundations of Computing');

    fireEvent.click(screen.getByRole('tab', { name: /Completed/ }));

    expect(screen.getByText('Data Structures')).toBeTruthy();
    expect(screen.queryByText('Foundations of Computing')).toBeNull();
  });
});
