import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  BarChart3,
  Award,
  CheckCircle,
  AlertCircle,
  Calendar,
  Clock,
  ArrowRight,
  Bot
} from 'lucide-react';
import { AnalyticsData, Course } from '../../types';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { NavTab } from '../layout/Sidebar';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { ErrorState } from '../ui/ErrorState';

interface LearningAnalyticsProps {
  courses: Course[];
  onNavigate: (tab: NavTab, params?: { topicQuery?: string }) => void;
}

interface AgentRecommendation {
  id: string;
  topic: string;
  masteryEstimate: number;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const LearningAnalytics: React.FC<LearningAnalyticsProps> = ({ courses, onNavigate }) => {
  const { role } = useAuth();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [agentRecommendations, setAgentRecommendations] = useState<AgentRecommendation[]>([]);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'needs_practice'>('all');
  const [selectedFacultyCourseId, setSelectedFacultyCourseId] = useState(courses[0]?.id ?? '');
  const [facultyRoster, setFacultyRoster] = useState<Awaited<ReturnType<typeof api.getFacultyCourseRoster>>>([]);
  const [facultyRosterLoading, setFacultyRosterLoading] = useState(true);
  const [facultyRosterError, setFacultyRosterError] = useState<string | null>(null);
  const [facultyRosterFilter, setFacultyRosterFilter] = useState<'all' | 'needs_support' | 'no_assessment'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (role !== 'student') {
      setIsLoading(false);
      return () => {
        active = false;
      };
    }
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.getAnalytics();
        if (active) setAnalytics(data);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Learning analytics could not be loaded.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadData();
    return () => {
      active = false;
    };
  }, [loadAttempt, role]);

  useEffect(() => {
    let active = true;
    setAgentRecommendations([]);
    setRecommendationError(null);
    if (role !== 'student' || courses.length === 0) return () => { active = false; };

    void api.getAgentRecommendations().then((workflow) => {
      if (!active) return;
      const recommendationData = workflow.data.recommendations;
      const items = isRecord(recommendationData) && Array.isArray(recommendationData.recommendations)
        ? recommendationData.recommendations
        : [];
      setAgentRecommendations(items.flatMap((item, index) => {
        if (
          !isRecord(item)
          || typeof item.topic !== 'string'
          || typeof item.masteryEstimate !== 'number'
          || typeof item.reason !== 'string'
        ) return [];
        return [{
          id: typeof item.topicId === 'string' ? item.topicId : `${item.topic}-${index}`,
          topic: item.topic,
          masteryEstimate: item.masteryEstimate,
          reason: item.reason,
        }];
      }));
    }).catch((loadError: unknown) => {
      if (active) {
        setRecommendationError(
          loadError instanceof Error ? loadError.message : 'Personalized recommendations could not be loaded.'
        );
      }
    });

    return () => {
      active = false;
    };
  }, [courses.length, loadAttempt, role]);

  useEffect(() => {
    if (!courses.some((course) => course.id === selectedFacultyCourseId)) {
      setSelectedFacultyCourseId(courses[0]?.id ?? '');
    }
  }, [courses, selectedFacultyCourseId]);

  useEffect(() => {
    let active = true;
    if (role !== 'instructor') return () => { active = false; };
    if (!selectedFacultyCourseId) {
      setFacultyRoster([]);
      setFacultyRosterError(null);
      setFacultyRosterLoading(false);
      return () => { active = false; };
    }

    setFacultyRosterLoading(true);
    setFacultyRosterError(null);
    void api.getFacultyCourseRoster(selectedFacultyCourseId).then((roster) => {
      if (active) setFacultyRoster(roster);
    }).catch((loadError: unknown) => {
      if (active) {
        setFacultyRosterError(
          loadError instanceof Error ? loadError.message : 'Course reports could not be loaded.'
        );
      }
    }).finally(() => {
      if (active) setFacultyRosterLoading(false);
    });

    return () => {
      active = false;
    };
  }, [loadAttempt, role, selectedFacultyCourseId]);

  if (role === 'instructor') {
    const selectedCourse = courses.find((course) => course.id === selectedFacultyCourseId);
    const scoredRoster = facultyRoster.flatMap((student) => {
      const score = Number.parseFloat(student.score.replace('%', ''));
      return Number.isFinite(score) ? [{ ...student, numericScore: score }] : [];
    });
    const averageScore = scoredRoster.length
      ? Math.round(scoredRoster.reduce((total, student) => total + student.numericScore, 0) / scoredRoster.length)
      : null;
    const supportCount = facultyRoster.filter((student) => student.status.toLowerCase().includes('support')).length;
    const visibleRoster = facultyRoster.filter((student) => {
      if (facultyRosterFilter === 'needs_support') return student.status.toLowerCase().includes('support');
      if (facultyRosterFilter === 'no_assessment') return !Number.isFinite(Number.parseFloat(student.score.replace('%', '')));
      return true;
    });

    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#4338CA]">Reports &amp; Analytics</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Faculty Course Reports</h1>
            <p className="mt-1 text-sm text-slate-600">Course-scoped enrollment and assessment summaries.</p>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Course
            <select
              aria-label="Course report"
              value={selectedFacultyCourseId}
              onChange={(event) => setSelectedFacultyCourseId(event.target.value)}
              className="min-w-64 rounded-lg border border-slate-300 bg-white px-3 py-2"
              disabled={courses.length === 0}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.code} · {course.title}</option>
              ))}
            </select>
          </label>
        </div>

        {facultyRosterLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <LoadingSkeleton className="h-24 w-full rounded-xl" count={4} />
          </div>
        ) : facultyRosterError ? (
          <ErrorState
            title="Course reports unavailable"
            message={facultyRosterError}
            onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
          />
        ) : !selectedCourse ? (
          <EmptyState
            icon={<BarChart3 className="w-6 h-6" />}
            title="No Assigned Courses"
            description="Course reports are available for courses assigned to your faculty account."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card className="p-5">
                <p className="text-sm text-slate-500">Enrolled students</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{facultyRoster.length}</p>
              </Card>
              <Card className="p-5">
                <p className="text-sm text-slate-500">Students with scores</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{scoredRoster.length}</p>
              </Card>
              <Card className="p-5">
                <p className="text-sm text-slate-500">Cohort mean score</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{averageScore === null ? '—' : `${averageScore}%`}</p>
              </Card>
              <Card className="p-5">
                <p className="text-sm text-slate-500">Flagged for support</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{supportCount}</p>
              </Card>
            </div>

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">{selectedCourse.code} · {selectedCourse.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">Student progress available to this course&apos;s assigned faculty.</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  Filter
                  <select
                    aria-label="Filter course report"
                    value={facultyRosterFilter}
                    onChange={(event) => setFacultyRosterFilter(event.target.value as typeof facultyRosterFilter)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="all">All students</option>
                    <option value="needs_support">Needs support</option>
                    <option value="no_assessment">No assessment score</option>
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Student</th>
                      <th className="px-5 py-3 font-semibold">Mean score</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Weak area</th>
                      <th className="px-5 py-3 font-semibold">Last activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleRoster.map((student) => (
                      <tr key={student.id}>
                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-900">{student.name}</div>
                          <div className="text-xs text-slate-500">{student.email}</div>
                        </td>
                        <td className="px-5 py-4 text-slate-700">{student.score}</td>
                        <td className="px-5 py-4 text-slate-700">{student.status}</td>
                        <td className="px-5 py-4 text-slate-700">{student.weakArea}</td>
                        <td className="px-5 py-4 text-slate-700">{student.lastActive}</td>
                      </tr>
                    ))}
                    {visibleRoster.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-500">No students match this filter.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <LoadingSkeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <LoadingSkeleton className="h-24 w-full rounded-xl" count={4} />
        </div>
        <LoadingSkeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!analytics) {
    if (error) {
      return (
        <div className="p-8 max-w-xl mx-auto">
          <ErrorState
            title="Learning analytics unavailable"
            message={error}
            onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
          />
        </div>
      );
    }
    return (
      <div className="p-8 max-w-xl mx-auto">
        <EmptyState
          icon={<BarChart3 className="w-6 h-6" />}
          title="No Learning Records"
          description="Learning telemetry will populate here once you participate in courses and complete diagnostic quizzes."
        />
      </div>
    );
  }

  const totalWeeklyMinutes = analytics.weeklyActivity
    ? analytics.weeklyActivity.reduce((acc, curr) => acc + curr.minutes, 0)
    : 0;

  const totalWeeklyHours = (totalWeeklyMinutes / 60).toFixed(1);

  const masteryPercentage = analytics.totalConceptsCount > 0
    ? Math.round((analytics.conceptsMasteredCount / analytics.totalConceptsCount) * 100)
    : 0;

  const filteredConcepts = (analytics.conceptMasteryList || []).filter(c => {
    if (selectedFilter === 'needs_practice') return c.status === 'Needs Practice';
    return true;
  });
  const remediationItems = agentRecommendations.length > 0
    ? agentRecommendations.map((item) => ({
      id: item.id,
      concept: item.topic,
      performanceScore: Math.round(item.masteryEstimate),
      suggestedAction: item.reason,
    }))
    : analytics.weakTopics;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">
          Learning Analytics & Mastery Evaluation
        </h1>
        <p className="text-xs text-[#64748B] mt-1">
          Empirical assessment performance and Bayesian knowledge-tracing estimates
        </p>
      </div>

      {/* Primary KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <span className="text-xs font-semibold text-[#64748B]">Average Exam Score</span>
          <p className="mt-2 text-2xl font-bold text-[#0F172A] tabular-nums">
            {analytics.assessmentsCompleted > 0 ? `${analytics.averageScore}%` : '—'}
          </p>
          <span className="text-[11px] text-[#64748B] mt-1 block">
            {analytics.assessmentsCompleted > 0
              ? 'Based on completed diagnostic quizzes'
              : 'No quizzes submitted yet'}
          </span>
        </Card>

        <Card className="p-5">
          <span className="text-xs font-semibold text-[#64748B]">Verified Submissions</span>
          <p className="mt-2 text-2xl font-bold text-[#0F172A] tabular-nums">
            {analytics.assessmentsCompleted}
          </p>
          <span className="text-[11px] text-[#64748B] mt-1 block">
            Across {courses.length} active course{courses.length === 1 ? '' : 's'}
          </span>
        </Card>

        <Card className="p-5">
          <span className="text-xs font-semibold text-[#64748B]">Concepts Mastered</span>
          <p className="mt-2 text-2xl font-bold text-[#0F172A] tabular-nums">
            {analytics.conceptsMasteredCount}{' '}
            <span className="text-sm font-normal text-[#94A3B8]">
              / {analytics.totalConceptsCount}
            </span>
          </p>
          <span className="text-[11px] text-[#64748B] mt-1 block">
            {masteryPercentage}% curriculum mastery estimate
          </span>
        </Card>

        <Card className="p-5">
          <span className="text-xs font-semibold text-[#64748B]">Weekly Engagement</span>
          <p className="mt-2 text-2xl font-bold text-[#0F172A] tabular-nums">
            {totalWeeklyMinutes}{' '}
            <span className="text-sm font-normal text-[#94A3B8]">min</span>
          </p>
          <span className="text-[11px] text-[#64748B] mt-1 block">
            {totalWeeklyHours} hours recorded
          </span>
        </Card>
      </div>

      {/* Score Progression Trend Chart */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#0F172A]">Assessment Score Progression</h2>
            <p className="text-xs text-[#64748B]">Sequential performance across diagnostic evaluations</p>
          </div>
          <Badge variant="neutral">Target Pass Threshold: 70%</Badge>
        </div>

        {analytics.scoreProgression && analytics.scoreProgression.length > 0 ? (
          <div className="relative pt-6 pb-2" aria-label="Score progression bar chart">
            <div className="h-44 w-full flex items-end justify-between gap-4 border-b border-[#E2E8F0] px-4">
              {analytics.scoreProgression.map((item, idx) => {
                const heightPercent = item.score;
                const isPassing = item.score >= 70;
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-2 group relative">
                    {/* Tooltip */}
                    <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-md pointer-events-none whitespace-nowrap z-20">
                      <span className="font-bold">{item.assessmentTitle}</span>: {item.score}%
                    </div>

                    <span className="text-[11px] font-bold text-[#0F172A] tabular-nums">
                      {item.score}%
                    </span>

                    <div
                      className={`w-full max-w-[36px] rounded-t-md transition-all ${
                        isPassing ? 'bg-[#4338CA]' : 'bg-[#B45309]'
                      }`}
                      style={{ height: `${heightPercent}%` }}
                    />

                    <span className="text-[10px] text-[#64748B] text-center truncate max-w-[70px]">
                      {item.date}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-[#94A3B8]">
            No score progression data recorded yet.
          </div>
        )}
      </Card>

      {/* Concept Mastery Breakdown & Frequently Missed Concepts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Concept Mastery List (2 Cols) */}
        <Card className="lg:col-span-2 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#0F172A]">
              Concept Mastery Tracker
            </h2>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                onClick={() => setSelectedFilter('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  selectedFilter === 'all'
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                All Concepts ({analytics.conceptMasteryList.length})
              </button>
              <button
                onClick={() => setSelectedFilter('needs_practice')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  selectedFilter === 'needs_practice'
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                Needs Practice
              </button>
            </div>
          </div>

          <div className="divide-y divide-[#E2E8F0]">
            {filteredConcepts.map((item, idx) => (
              <div key={idx} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="indigo">{item.courseCode}</Badge>
                    <h3 className="text-xs font-semibold text-[#0F172A] truncate">
                      {item.concept}
                    </h3>
                  </div>
                  <span className="text-[11px] text-[#64748B] mt-0.5 block">
                    {item.totalAttempts} diagnostic attempt{item.totalAttempts === 1 ? '' : 's'} recorded
                  </span>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <span className="text-xs font-bold text-[#0F172A] tabular-nums">
                      {item.mastery}%
                    </span>
                    <div className="w-20 bg-slate-100 rounded-full h-1.5 mt-1 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full ${
                          item.mastery >= 80
                            ? 'bg-[#15803D]'
                            : item.mastery >= 65
                            ? 'bg-[#4338CA]'
                            : 'bg-[#B45309]'
                        }`}
                        style={{ width: `${item.mastery}%` }}
                      />
                    </div>
                  </div>

                  <Badge
                    variant={
                      item.status === 'Mastered'
                        ? 'success'
                        : item.status === 'Developing'
                        ? 'indigo'
                        : 'error'
                    }
                  >
                    {item.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Frequently Missed Concepts (1 Col) */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#B91C1C]" />
            <h2 className="text-sm font-semibold text-[#0F172A]">
              Frequently Missed Concepts
            </h2>
          </div>

          <p className="text-xs text-[#64748B]">
            {agentRecommendations.length > 0
              ? 'Topics selected from your estimated mastery and graded practice evidence:'
              : 'Concepts with lowest pass rates identified for cognitive remediation:'}
          </p>

          {recommendationError && (
            <p role="status" className="text-[11px] text-[#64748B]">
              AI recommendations are unavailable: {recommendationError}
            </p>
          )}

          <div className="space-y-3">
            {remediationItems.map((wt) => (
              <div
                key={wt.id}
                className="p-3 bg-slate-50 border border-[#E2E8F0] rounded-lg space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#0F172A]">
                    {wt.concept}
                  </span>
                  <Badge variant="error" className="tabular-nums">
                    {wt.performanceScore}%
                  </Badge>
                </div>
                <p className="text-[11px] text-[#64748B] leading-relaxed">
                  {wt.suggestedAction}
                </p>
                <button
                  onClick={() =>
                    onNavigate('tutor', {
                      topicQuery: `Help me understand ${wt.concept}`
                    })
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#4338CA] hover:underline"
                >
                  <Bot className="w-3 h-3" />
                  Practice Now
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
