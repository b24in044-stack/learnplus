import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, CheckCircle2, RefreshCw, Sparkles, Target, TrendingUp } from 'lucide-react';
import {
  LearningAssignmentDetail,
  LearningAssignmentHistory,
  LearningTopicPerformance,
} from '../../types';
import { api } from '../../services/api';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { NavTab } from '../layout/Sidebar';

interface LearningAgentWorkspaceProps {
  onNavigate: (tab: NavTab, params?: { topicQuery?: string }) => void;
}

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
};

const evidenceLabel = (topic: LearningTopicPerformance) =>
  topic.evidenceStatus === 'MEASURED'
    ? `${topic.estimatedMastery}% estimated mastery`
    : 'Insufficient assessment evidence';

export const LearningAgentWorkspace: React.FC<LearningAgentWorkspaceProps> = ({ onNavigate }) => {
  const [history, setHistory] = useState<LearningAssignmentHistory | null>(null);
  const [selected, setSelected] = useState<LearningAssignmentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setHistory(await api.getLearningAssignmentHistory());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Learning Agent history could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const openAssignment = async (id: string) => {
    setIsLoadingDetail(true);
    setDetailError(null);
    try {
      setSelected(await api.getLearningAssignmentDetail(id));
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : 'Assignment analysis could not be loaded.');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const retryAnalysis = async (id: string) => {
    setRetryingId(id);
    setDetailError(null);
    try {
      await api.retryLearningAssignmentAnalysis(id);
      await loadHistory();
      if (selected?.assignment.id === id) {
        setSelected(await api.getLearningAssignmentDetail(id));
      }
    } catch (retryError) {
      setDetailError(retryError instanceof Error ? retryError.message : 'Learning analysis could not be retried.');
    } finally {
      setRetryingId(null);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-[#64748B]" role="status">Loading completed assignments…</div>;
  }
  if (error || !history) {
    return <ErrorState message={error || 'Learning Agent history is unavailable.'} onRetry={() => void loadHistory()} className="mt-12" />;
  }

  if (selected) {
    const details = selected.details;
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setDetailError(null);
          }}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#4338CA]"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Back to Learning Agent
        </button>
        <header className="rounded-2xl bg-white border border-[#E2E8F0] p-6 shadow-xs">
          <p className="text-[11px] font-bold tracking-[0.14em] text-[#64748B]">INDIVIDUAL ASSIGNMENT ANALYSIS</p>
          <h1 className="mt-1 text-xl font-bold text-[#0F172A]">{selected.assignment.displayName}</h1>
          <p className="mt-1 text-sm text-[#64748B]">
            {selected.assignment.name} · {selected.assignment.courseCode} · Completed {formatDate(selected.assignment.completionDate)}
          </p>
          <p className="mt-2 text-xs text-[#64748B]">
            This report uses only this assignment. Overall topic mastery is calculated separately from all completed assignments.
          </p>
        </header>

        {detailError && <p className="text-sm text-red-700" role="alert">{detailError}</p>}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Assignment score summary">
          {[
            ['Total questions', details.totalQuestions],
            ['Correct answers', details.correctAnswers],
            ['Incorrect answers', details.incorrectAnswers],
            ['Marks obtained', `${details.marksObtained}/${details.maximumScore}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-[#E2E8F0] bg-white p-4">
              <p className="text-xs text-[#64748B]">{label}</p>
              <p className="mt-1 text-lg font-bold text-[#0F172A]">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#0F172A]">Assignment score</h2>
              <p className="mt-1 text-xs text-[#64748B]">{selected.assignment.percentage}% · {selected.assignment.completionStatus}</p>
            </div>
            <span className="text-2xl font-bold text-[#4338CA]">{selected.assignment.percentage}%</span>
          </div>
        </section>

        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-[#0F172A]">Topic-wise performance</h2>
          {details.topicPerformance.map((topic) => (
            <div key={topic.topic} className="flex items-center justify-between gap-3 border-b border-[#F1F5F9] pb-2 last:border-0">
              <span className="text-sm text-[#334155]">{topic.topic}</span>
              <span className="text-xs font-semibold text-[#0F172A]">{topic.score}/{topic.total} ({topic.percentage}%)</span>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#0F172A]">Responses and explanations</h2>
          {details.questionResults.map((question, index) => (
            <article key={question.questionId} className="border-b border-[#E2E8F0] pb-4 last:border-0 last:pb-0">
              <div className="flex gap-2">
                {question.isCorrect
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="Correct" />
                  : <Target className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-label="Incorrect" />}
                <div>
                  <p className="text-xs font-semibold text-[#64748B]">Question {index + 1} · {question.topic || 'Topic unavailable'}</p>
                  <p className="mt-1 text-sm font-semibold text-[#0F172A]">{question.questionText}</p>
                  <p className="mt-2 text-xs text-[#334155]"><strong>Your answer:</strong> {String(question.selectedAnswer ?? 'Not answered')}</p>
                  <p className="mt-1 text-xs text-[#334155]"><strong>Correct answer:</strong> {question.correctAnswer || 'No answer key available'}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#64748B]"><strong>Explanation:</strong> {question.explanation || 'No explanation was provided.'}</p>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
            <h2 className="text-sm font-bold text-[#0F172A]">Difficulty-wise performance</h2>
            {details.difficultyPerformance.map((item) => (
              <p key={item.difficulty} className="mt-2 text-xs text-[#334155]">
                {item.difficulty}: {item.correct}/{item.attempted} ({item.accuracy}%)
              </p>
            ))}
          </div>
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
            <h2 className="text-sm font-bold text-[#0F172A]">Strengths and revision areas</h2>
            <p className="mt-2 text-xs text-green-800">
              Strengths: {details.strengths.map((item) => item.topic).join(', ') || 'No strong topic is established by this assignment alone.'}
            </p>
            <p className="mt-2 text-xs text-amber-800">
              Review: {details.weaknesses.map((item) => item.topic).join(', ') || 'No topic requires additional review based on this assignment.'}
            </p>
          </div>
        </section>
      </div>
    );
  }

  const overview = history.overview;
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <header className="rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-950 p-6 text-white md:p-8">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-1 h-5 w-5 shrink-0 text-indigo-300" aria-hidden="true" />
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-indigo-200">AI AGENT NETWORK</p>
            <h1 className="mt-1 text-xl font-bold">Learning Agent</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Learning intelligence is based only on assignments that were fully answered, backend graded, and published.
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Learning overview">
        {[
          ['Assignments completed', overview.totalAssignmentsCompleted],
          ['Questions attempted', overview.totalQuestionsAttempted],
          ['Overall accuracy', overview.overallAccuracy === null ? '—' : `${overview.overallAccuracy}%`],
          ['Topics assessed', overview.overallTopicMastery.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[#E2E8F0] bg-white p-4">
            <p className="text-xs text-[#64748B]">{label}</p>
            <p className="mt-1 text-xl font-bold text-[#0F172A]">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#4338CA]" aria-hidden="true" />
            <h2 className="text-sm font-bold text-[#0F172A]">Overall topic mastery</h2>
          </div>
          {overview.overallTopicMastery.length ? (
            <div className="mt-4 space-y-3">
              {overview.overallTopicMastery.map((topic) => (
                <div key={`${topic.courseId || 'course'}-${topic.topic}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#334155]">
                      {topic.topic}{topic.courseCode ? ` · ${topic.courseCode}` : ''}
                    </span>
                    <span className="text-[#64748B]">{topic.correct}/{topic.attempts} correct · {evidenceLabel(topic)}</span>
                  </div>
                  {topic.estimatedMastery !== null && (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-indigo-600" style={{ width: `${topic.estimatedMastery}%` }} />
                    </div>
                  )}
                  {topic.improvementAcrossAssignments !== null && (
                    <p className="mt-1 text-[11px] text-[#64748B]">
                      Change from earliest to latest assignment: {topic.improvementAcrossAssignments > 0 ? '+' : ''}{topic.improvementAcrossAssignments}%
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[#64748B]">Complete a generated assignment to build topic evidence.</p>
          )}
          <p className="mt-4 text-[11px] text-[#64748B]">{overview.evidenceNote}</p>
        </div>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <h2 className="text-sm font-bold text-[#0F172A]">Personalized learning plan</h2>
          {overview.personalizedLearningPlan.length ? (
            <ul className="mt-3 space-y-3">
              {overview.personalizedLearningPlan.map((item) => (
                <li key={`${item.courseId || 'course'}-${item.topic}`} className="rounded-lg bg-amber-50 p-3">
                  <p className="text-xs font-bold text-[#0F172A]">
                    {item.topic}{item.courseCode ? ` · ${item.courseCode}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-[#475569]">{item.reason}</p>
                  <p className="mt-1 text-xs text-[#475569]">{item.action}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-[#64748B]">No revision recommendations are supported by the current completed-assignment evidence.</p>
          )}
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => onNavigate('planner')}
          >
            Open Study Planner
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold tracking-[0.08em] text-[#0F172A]">COMPLETED ASSIGNMENTS</h2>
            <p className="mt-1 text-xs text-[#64748B]">Chronological history from your published results.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadHistory()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        {history.completedAssignments.length ? (
          <div className="space-y-3">
            {history.completedAssignments.map((assignment) => (
              <article key={assignment.id} className="flex flex-col gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => void openAssignment(assignment.id)} className="min-w-0 text-left">
                  <span className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
                    <BookOpen className="h-4 w-4 shrink-0 text-[#4338CA]" aria-hidden="true" />
                    {assignment.displayName}
                  </span>
                  <span className="mt-1 block text-xs text-[#64748B]">
                    {assignment.name} · {assignment.courseCode} · {assignment.topics.join(', ') || 'Topics not listed'}
                  </span>
                  <span className="mt-1 block text-[11px] text-[#64748B]">
                    Completed {formatDate(assignment.completionDate)} · {assignment.completionStatus}
                  </span>
                </button>
                <div className="flex items-center gap-3 sm:shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#0F172A]">{assignment.percentage}%</p>
                    <p className="text-[11px] text-[#64748B]">{assignment.score}/{assignment.maximumScore}</p>
                  </div>
                  {assignment.learningAnalysisStatus !== 'LEARNING_ANALYSIS_COMPLETED' && (
                    <Button
                      type="button"
                      variant="outline"
                      isLoading={retryingId === assignment.id}
                      disabled={retryingId !== null}
                      onClick={() => void retryAnalysis(assignment.id)}
                    >
                      {assignment.learningAnalysisStatus === 'LEARNING_ANALYSIS_FAILED' ? 'Retry analysis' : 'Analyze'}
                    </Button>
                  )}
                  <Button type="button" variant="secondary" onClick={() => void openAssignment(assignment.id)}>
                    View analysis
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen className="w-5 h-5" />}
            title="No completed assignments yet"
            description="Assignments appear here only after submission, backend grading, and result publication."
            actionLabel="Generate an assignment"
            onAction={() => onNavigate('assignment-agent')}
          />
        )}
        {isLoadingDetail && <p className="text-xs text-[#64748B]" role="status">Loading assignment analysis…</p>}
        {detailError && !selected && <p className="text-xs text-red-700" role="alert">{detailError}</p>}
      </section>
    </div>
  );
};
