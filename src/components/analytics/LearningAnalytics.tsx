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
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [agentRecommendations, setAgentRecommendations] = useState<AgentRecommendation[]>([]);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'needs_practice'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
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
  }, [loadAttempt]);

  useEffect(() => {
    let active = true;
    setAgentRecommendations([]);
    setRecommendationError(null);
    if (courses.length === 0) return () => { active = false; };

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
  }, [courses.length, loadAttempt]);

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
