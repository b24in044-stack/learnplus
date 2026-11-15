import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  GraduationCap,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import {
  AnalyticsData,
  Course,
  Recommendation,
  LearningAssignmentHistory,
  StudyPlannerTask,
  WeakTopic,
} from '../../types';
import { NavTab } from '../layout/Sidebar';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';

interface StudentDashboardProps {
  onNavigate: (tab: NavTab, params?: { courseId?: string; topicQuery?: string }) => void;
}

type ActivityPeriod = 'week' | 'month';
type CourseFilter = 'ongoing' | 'completed';

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const parseTaskDate = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatTaskDate = (value: string) => {
  const date = parseTaskDate(value);
  return date
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : value;
};

const getCourseColor = (index: number) =>
  ['course-art-lavender', 'course-art-blue', 'course-art-pink', 'course-art-mint'][index % 4];

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [assignmentHistory, setAssignmentHistory] = useState<LearningAssignmentHistory | null>(null);
  const [assignmentHistoryError, setAssignmentHistoryError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<StudyPlannerTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([]);
  const [courseFilter, setCourseFilter] = useState<CourseFilter>('ongoing');
  const [activityPeriod, setActivityPeriod] = useState<ActivityPeriod>('week');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));

  const loadDashboardData = async () => {
    setIsLoading(true);
    setError(null);
    setTasksError(null);
    try {
      const [courseData, analyticsData, recommendationData] = await Promise.all([
        api.getCourses(),
        api.getAnalytics(),
        api.getRecommendations(),
      ]);
      setCourses(courseData);
      setAnalytics(analyticsData);
      setRecommendations(recommendationData);
      try {
        setAssignmentHistory(await api.getLearningAssignmentHistory());
        setAssignmentHistoryError(null);
      } catch (historyError) {
        setAssignmentHistory(null);
        setAssignmentHistoryError(historyError instanceof Error ? historyError.message : 'Assignment results could not be loaded.');
      }
      try {
        setTasks(await api.getStudyTasks());
      } catch (taskLoadError) {
        setTasks([]);
        setTasksError(taskLoadError instanceof Error ? taskLoadError.message : 'Tasks could not be loaded.');
      }
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Dashboard data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardData();
  }, []);

  const handleToggleTask = async (taskId: string) => {
    setTasksError(null);
    setPendingTaskIds((current) => [...current, taskId]);
    try {
      setTasks(await api.toggleStudyTask(taskId));
    } catch (toggleError) {
      setTasksError(toggleError instanceof Error ? toggleError.message : 'Task status could not be saved.');
    } finally {
      setPendingTaskIds((current) => current.filter((id) => id !== taskId));
    }
  };

  const today = new Date();
  const weekActivity = analytics?.weeklyActivity ?? [];
  const hoursThisWeek = weekActivity.reduce((sum, day) => sum + day.minutes, 0) / 60;
  const lessonsAvailable = courses.reduce((sum, course) => sum + (course.topicsCount || 0), 0);
  const performance = analytics && analytics.assessmentsCompleted > 0
    ? Math.max(0, Math.min(100, analytics.averageScore))
    : null;
  const filteredCourses = courses.filter((course) =>
    courseFilter === 'completed' ? course.progress >= 100 : course.progress < 100
  );
  const orderedTasks = [...tasks].sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  const tasksForSelectedDate = orderedTasks.filter((task) => task.dueDate.slice(0, 10) === selectedDate);
  const visibleTasks = tasksForSelectedDate.length > 0
    ? tasksForSelectedDate
    : orderedTasks.filter((task) => !task.completed).slice(0, 4);
  const taskListLabel = tasksForSelectedDate.length > 0 ? 'Selected day' : 'Upcoming tasks';
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((startOffset + daysInMonth) / 7) * 7 }, (_, index) => {
      const dayNumber = index - startOffset + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) return null;
      const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), dayNumber);
      return { date, key: localDateKey(date), number: dayNumber };
    });
  }, [calendarMonth]);
  const taskDates = useMemo(
    () => new Set(tasks.map((task) => task.dueDate.slice(0, 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))),
    [tasks]
  );

  if (isLoading) {
    return (
      <div className="dashboard-loading" role="status" aria-label="Loading dashboard">
        <LoadingSkeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <LoadingSkeleton className="h-28 w-full rounded-2xl" count={3} />
        </div>
        <LoadingSkeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <ErrorState title="Dashboard unavailable" message={error} onRetry={loadDashboardData} />
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <div className="dashboard-main-column">
        <section className="dashboard-stat-grid" aria-label="Learning summary">
          <article className="dashboard-stat stat-lavender">
            <div className="stat-icon"><BookOpen size={19} aria-hidden="true" /></div>
            <p>Lessons</p>
            <strong>{lessonsAvailable}</strong>
            <span>Topics in your courses</span>
          </article>
          <article className="dashboard-stat stat-sky">
            <div className="stat-icon"><Clock3 size={19} aria-hidden="true" /></div>
            <p>Hours spent</p>
            <strong>{weekActivity.length ? hoursThisWeek.toFixed(1) : '—'}</strong>
            <span>{weekActivity.length ? 'Recorded this week' : 'No activity data yet'}</span>
          </article>
          <article className="dashboard-stat stat-rose">
            <div className="stat-icon"><Award size={19} aria-hidden="true" /></div>
            <p>Certificates</p>
            <strong>—</strong>
            <span>Not available in your records</span>
          </article>
        </section>

        <section className="dashboard-analytics-grid" aria-label="Learning analytics">
          <article className="dashboard-panel hours-panel">
            <div className="panel-heading">
              <div>
                <h2>Hours spent</h2>
                <p>Study time recorded from your activity</p>
              </div>
              <div className="period-toggle" role="group" aria-label="Activity period">
                <button
                  type="button"
                  aria-pressed={activityPeriod === 'week'}
                  className={activityPeriod === 'week' ? 'selected' : ''}
                  onClick={() => setActivityPeriod('week')}
                >Week</button>
                <button
                  type="button"
                  aria-pressed={activityPeriod === 'month'}
                  className={activityPeriod === 'month' ? 'selected' : ''}
                  onClick={() => setActivityPeriod('month')}
                >Month</button>
              </div>
            </div>
            {activityPeriod === 'week' && weekActivity.length > 0 ? (
              <>
                <div className="activity-chart" role="img" aria-label="Recorded study minutes by day this week">
                  {weekActivity.map((day) => {
                    const maxMinutes = Math.max(30, ...weekActivity.map((item) => item.minutes));
                    const height = day.minutes > 0 ? Math.max(8, (day.minutes / maxMinutes) * 100) : 0;
                    return (
                      <div className="activity-day" key={`${day.date}-${day.day}`}>
                        <span className="activity-value">{day.minutes ? `${Math.round(day.minutes / 60 * 10) / 10}h` : ''}</span>
                        <div className="activity-track">
                          <div className="activity-fill" style={{ height: `${height}%` }} />
                        </div>
                        <span className="activity-label">{day.day}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="chart-caption">
                  <span><i className="chart-legend-dot" /> Study time</span>
                  <strong>{hoursThisWeek.toFixed(1)} hrs total</strong>
                </div>
              </>
            ) : (
              <div className="chart-empty">
                <Clock3 size={23} aria-hidden="true" />
                <p>{activityPeriod === 'month'
                  ? 'Monthly activity is not provided by your analytics data yet.'
                  : 'No recorded study activity for this week.'}</p>
              </div>
            )}
          </article>

          <article className="dashboard-panel performance-panel">
            <div className="panel-heading">
              <div>
                <h2>Performance</h2>
                <p>Based on submitted assessments</p>
              </div>
              <span className="panel-icon"><TrendingUp size={17} aria-hidden="true" /></span>
            </div>
            {performance !== null ? (
              <>
                <div
                  className="performance-gauge"
                  style={{ '--gauge-score': `${performance * 1.8}deg` } as React.CSSProperties}
                  role="img"
                  aria-label={`Assessment average ${Math.round(performance)} percent`}
                >
                  <div className="gauge-center">
                    <strong>{Math.round(performance)}<small>%</small></strong>
                    <span>Average score</span>
                  </div>
                </div>
                <p className="performance-footnote">
                  {analytics?.assessmentsCompleted} assessment{analytics?.assessmentsCompleted === 1 ? '' : 's'} completed
                </p>
              </>
            ) : (
              <div className="chart-empty performance-empty">
                <Target size={23} aria-hidden="true" />
                <p>Complete an assessment to see your performance.</p>
              </div>
            )}
          </article>
        </section>

        <section className="dashboard-panel courses-panel">
          <div className="panel-heading courses-heading">
            <div>
              <h2>My courses</h2>
              <p>Your current learning progress</p>
            </div>
            <button type="button" className="text-link" onClick={() => onNavigate('courses')}>
              All courses <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="course-filter" role="tablist" aria-label="Filter courses">
            <button
              type="button"
              role="tab"
              aria-selected={courseFilter === 'ongoing'}
              className={courseFilter === 'ongoing' ? 'selected' : ''}
              onClick={() => setCourseFilter('ongoing')}
            >Ongoing <span>{courses.filter((course) => course.progress < 100).length}</span></button>
            <button
              type="button"
              role="tab"
              aria-selected={courseFilter === 'completed'}
              className={courseFilter === 'completed' ? 'selected' : ''}
              onClick={() => setCourseFilter('completed')}
            >Completed <span>{courses.filter((course) => course.progress >= 100).length}</span></button>
          </div>
          {filteredCourses.length > 0 ? (
            <div className="course-card-list">
              {filteredCourses.slice(0, 4).map((course, index) => (
                <button
                  type="button"
                  className="course-row"
                  key={course.id}
                  onClick={() => onNavigate('courses', { courseId: course.id })}
                >
                  <span className={`course-art ${getCourseColor(index)}`} aria-hidden="true">
                    <BookOpen size={23} strokeWidth={1.6} />
                    <small>{course.code}</small>
                  </span>
                  <span className="course-details">
                    <span className="course-title">{course.title}</span>
                    <span className="course-meta">
                      <span>{course.code}</span>
                      <i />
                      <span>{course.progress >= 100 ? 'Completed' : `${course.progress}% complete`}</span>
                    </span>
                    <span className="course-progress-track">
                      <span
                        className={`course-progress-fill ${course.progress >= 100 ? 'is-complete' : ''}`}
                        style={{ width: `${Math.max(0, Math.min(100, course.progress))}%` }}
                      />
                    </span>
                  </span>
                  <ArrowRight size={17} className="course-arrow" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<BookOpen className="w-6 h-6" />}
              title={courseFilter === 'completed' ? 'No completed courses yet' : 'No courses available'}
              description={courseFilter === 'completed'
                ? 'Courses will appear here after their progress reaches 100%.'
                : 'Courses assigned to your account will appear here.'}
              actionLabel={courseFilter === 'ongoing' ? 'Explore courses' : undefined}
              onAction={courseFilter === 'ongoing' ? () => onNavigate('courses') : undefined}
            />
          )}
        </section>

        <section className="dashboard-bottom-grid">
          <article className="dashboard-panel insight-panel">
            <div className="panel-heading">
              <div><h2>Focus areas</h2><p>Topics flagged by your assessment data</p></div>
              <Target size={18} className="soft-icon" aria-hidden="true" />
            </div>
            {analytics?.weakTopics?.length ? (
              analytics.weakTopics.slice(0, 3).map((topic: WeakTopic) => (
                <button
                  type="button"
                  className="insight-row"
                  key={topic.id}
                  onClick={() => onNavigate('tutor', { topicQuery: `Help me understand ${topic.concept}.` })}
                >
                  <span><strong>{topic.concept}</strong><small>{topic.courseCode} · {topic.attempts} attempts recorded</small></span>
                  <span className="insight-score">{topic.performanceScore}%</span>
                </button>
              ))
            ) : (
              <p className="small-empty">No focus areas are available from your assessment data.</p>
            )}
          </article>
          <article className="dashboard-panel insight-panel">
            <div className="panel-heading">
              <div><h2>Recommended next</h2><p>Suggestions available for your courses</p></div>
              <Sparkles size={18} className="soft-icon" aria-hidden="true" />
            </div>
            {recommendations.length ? (
              recommendations.slice(0, 3).map((recommendation) => (
                <button
                  type="button"
                  className="recommendation-row"
                  key={recommendation.id}
                  onClick={() => onNavigate('tutor', { topicQuery: `Let's work through: ${recommendation.topic}` })}
                >
                  <span><strong>{recommendation.topic}</strong><small>{recommendation.courseCode} · about {recommendation.estimatedMinutes} min</small></span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ))
            ) : (
              <p className="small-empty">No recommendations are available right now.</p>
            )}
          </article>
        </section>
      </div>

      <aside className="dashboard-profile-column" aria-label="Student profile and tasks">
        <section className="profile-card">
          <div className="profile-card-top">
            <div className="profile-avatar">
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt="" />
                : <span aria-hidden="true">{(user.name || 'S').trim().charAt(0).toUpperCase()}</span>}
            </div>
            <h2>{user.name || 'Student'}</h2>
            <p>{user.role === 'instructor' ? 'Faculty' : 'Student'}{user.department ? ` · ${user.department}` : ''}</p>
            {user.email && <span className="profile-email">{user.email}</span>}
          </div>

          <div className="calendar-section">
            <div className="calendar-heading">
              <h3>{calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
              <div>
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                ><ChevronLeft size={17} /></button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                ><ChevronRight size={17} /></button>
              </div>
            </div>
            <div className="calendar-grid" role="grid" aria-label="Calendar">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                <span className="calendar-weekday" role="columnheader" key={day}>{day}</span>
              ))}
              {calendarDays.map((day, index) => day ? (
                <button
                  type="button"
                  role="gridcell"
                  key={day.key}
                  aria-label={`${day.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}${taskDates.has(day.key) ? ', has tasks' : ''}`}
                  aria-selected={selectedDate === day.key}
                  className={`calendar-day ${selectedDate === day.key ? 'is-selected' : ''} ${localDateKey(today) === day.key ? 'is-today' : ''}`}
                  onClick={() => setSelectedDate(day.key)}
                >
                  {day.number}
                  {taskDates.has(day.key) && <i aria-hidden="true" />}
                </button>
              ) : <span className="calendar-blank" key={`blank-${index}`} />)}
            </div>
            <button type="button" className="calendar-today" onClick={() => {
              const now = new Date();
              setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedDate(localDateKey(now));
            }}>Go to today</button>
          </div>

          <div className="tasks-section">
            <div className="tasks-heading">
              <div><h3>{taskListLabel}</h3><span>{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}</span></div>
              <button type="button" aria-label="Open study planner" onClick={() => onNavigate('planner')}>
                <CalendarDays size={17} />
              </button>
            </div>
            {tasksError && <p className="tasks-error" role="alert">{tasksError}</p>}
            {visibleTasks.length ? (
              <ul className="task-list">
                {visibleTasks.map((task) => (
                  <li key={task.id}>
                    <label className={`task-item ${task.completed ? 'is-complete' : ''}`}>
                      <input
                        type="checkbox"
                        checked={task.completed}
                        disabled={pendingTaskIds.includes(task.id)}
                        onChange={() => void handleToggleTask(task.id)}
                        aria-label={`Mark ${task.title} ${task.completed ? 'incomplete' : 'complete'}`}
                      />
                      <span className="task-check"><Check size={12} aria-hidden="true" /></span>
                      <span className="task-copy">
                        <strong>{task.title}</strong>
                        <small>{task.courseCode} · {formatTaskDate(task.dueDate)}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="tasks-empty">
                <FileText size={20} aria-hidden="true" />
                <p>{tasksError ? 'Tasks are unavailable until the service reconnects.' : 'No upcoming tasks in your planner.'}</p>
              </div>
            )}
            <button type="button" className="planner-link" onClick={() => onNavigate('planner')}>
              Open study planner <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </section>

        <button type="button" className="learning-path-card" onClick={() => onNavigate('learning-path')}>
          <span className="learning-path-icon"><GraduationCap size={20} aria-hidden="true" /></span>
          <span><strong>Keep your momentum</strong><small>Explore your personalized learning path</small></span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate('learning-agent')}
          className="flex items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-left"
        >
          <span>
            <strong className="block text-sm text-[#0F172A]">Learning Agent</strong>
            <small className="mt-1 block text-xs text-[#64748B]">
              {assignmentHistory
                ? `${assignmentHistory.overview.totalAssignmentsCompleted} completed · ${
                  assignmentHistory.overview.overallAccuracy === null
                    ? 'accuracy not yet measured'
                    : `${assignmentHistory.overview.overallAccuracy}% overall accuracy`
                }`
                : assignmentHistoryError
                  ? `Assignment history unavailable: ${assignmentHistoryError}`
                  : 'Loading completed assignment results…'}
            </small>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </aside>
    </div>
  );
};
