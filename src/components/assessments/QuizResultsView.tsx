import React from 'react';
import {
  CheckCircle,
  XCircle,
  RotateCcw,
  Bot,
  ArrowRight,
  Award,
  Clock,
  Sparkles,
  BarChart3
} from 'lucide-react';
import { AssessmentResult } from '../../types';
import { NavTab } from '../layout/Sidebar';

interface QuizResultsViewProps {
  result: AssessmentResult;
  onRetake: () => void;
  onNavigate: (tab: NavTab, params?: { topicQuery?: string }) => void;
}

export const QuizResultsView: React.FC<QuizResultsViewProps> = ({
  result,
  onRetake,
  onNavigate
}) => {
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}m ${s}s`;
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Official Score Banner */}
      <div className="p-6 md:p-8 bg-white border border-[#E2E8F0] rounded-xl shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#4338CA] bg-indigo-50 px-2 py-0.5 rounded">
                {result.courseCode}
              </span>
              <span className="text-xs text-[#64748B]">Assessment Score</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0F172A]">
              {result.assessmentTitle}
            </h1>
            <p className="text-xs text-[#64748B]">
              Graded on backend at {result.completedAt} · Time: {formatTime(result.timeSpentSeconds)}
            </p>
          </div>

          <div className="text-right sm:shrink-0 flex sm:flex-col items-center sm:items-end justify-between">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl md:text-4xl font-bold text-[#0F172A] tabular-nums">
                {result.percentage}%
              </span>
              <span className="text-xs text-[#64748B]">
                ({result.score}/{result.totalQuestions})
              </span>
            </div>

            <span
              className={`text-xs font-semibold px-2.5 py-0.5 rounded mt-1 ${
                result.passed
                  ? 'text-[#15803D] bg-green-50'
                  : 'text-[#B91C1C] bg-red-50'
              }`}
            >
              {result.passed ? 'Passing Grade Achieved' : 'Needs Reinforcement'}
            </span>
          </div>
        </div>

        {/* Recommended Agent Next Step Box */}
        <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-[#4338CA] mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-[#0F172A]">
                Suggested Next Step
              </p>
              <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                {result.recommendedFollowUp.reason}
              </p>
            </div>
          </div>

          <button
            onClick={() =>
              onNavigate('tutor', {
                topicQuery: result.recommendedFollowUp.practicePrompt
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] rounded-lg transition-colors shrink-0 shadow-xs"
          >
            <Bot className="w-3.5 h-3.5" />
            Remediate in Tutor
          </button>
        </div>
      </div>

      {/* Topic-Wise Breakdown */}
      <div className="p-6 bg-white border border-[#E2E8F0] rounded-xl shadow-xs space-y-4">
        <h2 className="text-sm font-semibold text-[#0F172A]">
          Topic-Wise Performance Breakdown
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {result.topicBreakdown.map((t, idx) => (
            <div
              key={idx}
              className="p-3.5 bg-slate-50 border border-[#E2E8F0] rounded-lg space-y-2"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#0F172A] truncate">{t.topic}</span>
                <span className="font-semibold text-[#0F172A] tabular-nums">
                  {t.score}/{t.total} ({t.percentage}%)
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full ${
                    t.percentage >= 70 ? 'bg-[#15803D]' : 'bg-[#B45309]'
                  }`}
                  style={{ width: `${t.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Question by Question Detailed Review */}
      <div className="p-6 bg-white border border-[#E2E8F0] rounded-xl shadow-xs space-y-4">
        <h2 className="text-sm font-semibold text-[#0F172A]">
          Question-by-Question Review & Explanations
        </h2>

        <div className="space-y-4 divide-y divide-[#E2E8F0]">
          {result.questionResults.map((q, idx) => (
            <div key={q.questionId} className={`pt-4 ${idx === 0 ? 'pt-0' : ''} space-y-2`}>
              <div className="flex items-start gap-2.5">
              {q.isCorrect === true ? (
                  <CheckCircle className="w-4 h-4 text-[#15803D] mt-0.5 shrink-0" />
              ) : q.isCorrect === false ? (
                  <XCircle className="w-4 h-4 text-[#B91C1C] mt-0.5 shrink-0" />
              ) : null}
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-semibold text-[#64748B]">
                    Question {idx + 1}
                  </span>
                  <p className="text-xs font-semibold text-[#0F172A] mt-0.5">
                    {q.questionText}
                  </p>
                </div>
              </div>

              {/* Explanation card */}
              <div className="ml-6 p-3 bg-slate-50 border border-[#E2E8F0] rounded-lg space-y-1.5 text-xs text-[#334155]">
                <div className="flex items-center gap-2 font-medium">
                  <span className="text-[#64748B]">Evaluation:</span>
                  <span className={q.isCorrect === undefined ? 'text-[#64748B]' : q.isCorrect ? 'text-[#15803D]' : 'text-[#B91C1C]'}>
                    {q.isCorrect === undefined ? 'Grading details withheld' : q.isCorrect ? 'Correct Answer Selected' : 'Incorrect Choice'}
                  </span>
                </div>
                <p className="text-[11px] text-[#64748B] leading-relaxed">
                  <strong className="text-[#334155]">Academic Explanation:</strong> {q.explanation || 'Answer details are not shown for this assessment.'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between p-4 bg-white border border-[#E2E8F0] rounded-xl">
        <button
          onClick={onRetake}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#334155] bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Retake Assessment
        </button>

        <button
          onClick={() => onNavigate('dashboard')}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] rounded-lg transition-colors shadow-xs"
        >
          Return to Overview
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
