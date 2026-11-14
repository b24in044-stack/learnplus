import React, { useState, useEffect, useRef } from 'react';
import {
  Clock,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Send,
  Loader2
} from 'lucide-react';
import { Assessment, AssessmentResult } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

interface QuizRunnerProps {
  assessment: Assessment;
  onCancel: () => void;
  onComplete: (result: AssessmentResult) => void;
}

export const QuizRunner: React.FC<QuizRunnerProps> = ({
  assessment,
  onCancel,
  onComplete
}) => {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState(assessment.durationMinutes * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs to avoid stale closures in setInterval and prevent duplicate submissions
  const answersRef = useRef<Record<string, number>>({});
  const isSubmittingRef = useRef(false);
  const timeRemainingRef = useRef(timeRemainingSeconds);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    timeRemainingRef.current = timeRemainingSeconds;
  }, [timeRemainingSeconds]);

  const currentQuestion = assessment.questions[currentIndex];
  const totalQuestions = assessment.questions.length;
  const answeredCount = Object.keys(answers).length;

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setShowConfirmModal(false);
    setError(null);

    const timeSpent = assessment.durationMinutes * 60 - timeRemainingRef.current;

    try {
      const result = await api.submitAssessment({
        assessmentId: assessment.id,
        studentId: user.id,
        answers: answersRef.current,
        timeSpentSeconds: Math.max(1, timeSpent),
        aiGenerated: assessment.aiGenerated
      });
      onComplete(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error submitting assessment to backend');
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  // Safe timer lifecycle
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSelectOption = (optionIndex: number) => {
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: optionIndex
    }));
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between p-4 bg-white border border-[#E2E8F0] rounded-xl shadow-xs">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          disabled={isSubmitting}
          onClick={onCancel}
        >
          Exit Quiz
        </Button>

        <div className="text-center">
          <Badge variant="indigo">{assessment.courseCode}</Badge>
          <h1 className="text-xs font-semibold text-[#0F172A] mt-0.5">
            {assessment.title}
          </h1>
        </div>

        {/* Accessible Timer Display */}
        <div
          role="timer"
          aria-live="polite"
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-[#E2E8F0] rounded-lg"
        >
          <Clock className="w-3.5 h-3.5 text-[#4338CA]" />
          <span className="text-xs font-mono font-bold text-[#0F172A] tabular-nums">
            {formatTime(timeRemainingSeconds)}
          </span>
        </div>
      </div>

      {/* Question Palette / Indicator Strip */}
      <div className="flex items-center justify-between p-3 bg-white border border-[#E2E8F0] rounded-xl text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          {assessment.questions.map((q, idx) => {
            const isAnswered = answers[q.id] !== undefined;
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIndex(idx)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  isCurrent
                    ? 'ring-2 ring-[#4338CA] bg-[#4338CA] text-white'
                    : isAnswered
                    ? 'bg-indigo-100 text-[#4338CA]'
                    : 'bg-slate-100 text-[#64748B] hover:bg-slate-200'
                }`}
                aria-label={`Jump to question ${idx + 1}`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-[#64748B] shrink-0 pl-3">
          <span className="font-semibold text-[#0F172A] tabular-nums">{answeredCount}</span> of {totalQuestions} answered
        </div>
      </div>

      {/* Current Question Body */}
      <div className="p-6 md:p-8 bg-white border border-[#E2E8F0] rounded-xl shadow-xs space-y-6">
        <div className="flex items-center justify-between text-xs text-[#64748B]">
          <span className="font-semibold text-[#4338CA]">
            Question {currentIndex + 1} of {totalQuestions}
          </span>
          <span className="text-[11px] font-medium text-[#64748B]">
            Topic: {currentQuestion.topicTag}
          </span>
        </div>

        {/* Question Text */}
        <h2 className="text-base font-semibold text-[#0F172A] leading-relaxed">
          {currentQuestion.questionText}
        </h2>

        {/* Code Snippet if applicable */}
        {currentQuestion.codeSnippet && (
          <div className="p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-lg overflow-x-auto">
            <pre>
              <code>{currentQuestion.codeSnippet}</code>
            </pre>
          </div>
        )}

        {/* Multiple Choice Options */}
        <div className="space-y-3 pt-2" role="radiogroup" aria-label="Question choices">
          {currentQuestion.options.map((option, optIdx) => {
            const isSelected = answers[currentQuestion.id] === optIdx;
            return (
              <button
                key={optIdx}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelectOption(optIdx)}
                className={`w-full p-4 text-left rounded-xl border transition-all flex items-start gap-3.5 cursor-pointer ${
                  isSelected
                    ? 'border-[#4338CA] bg-indigo-50/50 shadow-xs'
                    : 'border-[#E2E8F0] hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                    isSelected
                      ? 'border-[#4338CA] bg-[#4338CA] text-white'
                      : 'border-[#CBD5E1] bg-white'
                  }`}
                >
                  {isSelected && <span className="w-2 h-2 rounded-full bg-white" />}
                </div>

                <div className="flex-1 min-w-0">
                  <span className="text-xs text-[#0F172A] leading-relaxed">
                    {option}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between p-4 bg-white border border-[#E2E8F0] rounded-xl">
        <Button
          variant="outline"
          size="sm"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          disabled={currentIndex === 0 || isSubmitting}
          onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
        >
          Previous
        </Button>

        {currentIndex === totalQuestions - 1 ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Send className="w-3.5 h-3.5" />}
            isLoading={isSubmitting}
            onClick={() => setShowConfirmModal(true)}
            className="bg-[#15803D] hover:bg-green-800"
          >
            Submit Assessment
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCurrentIndex((prev) => Math.min(totalQuestions - 1, prev + 1))}
            disabled={isSubmitting}
          >
            <span>Next</span>
            <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        )}
      </div>

      {/* Submission Confirmation Modal */}
      <Dialog
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="Ready to Submit Assessment?"
        description="Your responses will be transmitted to the backend assessment layer for official evaluation."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setShowConfirmModal(false)}
            >
              Back to Questions
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
              onClick={handleSubmit}
            >
              Confirm & Submit
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-xs text-[#334155]">
          <div className="p-3 bg-slate-50 border border-[#E2E8F0] rounded-lg space-y-1">
            <div className="flex justify-between">
              <span>Answered questions:</span>
              <span className="font-bold tabular-nums">{answeredCount} of {totalQuestions}</span>
            </div>
            {answeredCount < totalQuestions && (
              <div className="flex items-center gap-1.5 text-amber-800 font-medium pt-1">
                <AlertTriangle className="w-3.5 h-3.5 text-[#B45309] shrink-0" />
                <span>You have {totalQuestions - answeredCount} unanswered question(s).</span>
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-[#B91C1C]">
          {error}
        </div>
      )}
    </div>
  );
};
