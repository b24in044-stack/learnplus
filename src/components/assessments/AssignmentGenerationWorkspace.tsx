import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import { Assessment, AssessmentResult, Course } from '../../types';
import { api } from '../../services/api';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { QuizResultsView } from './QuizResultsView';
import { QuizRunner } from './QuizRunner';
import { NavTab } from '../layout/Sidebar';

interface AssignmentGenerationWorkspaceProps {
  courses: Course[];
  onNavigate: (tab: NavTab, params?: { topicQuery?: string }) => void;
  onBack: () => void;
}

export const AssignmentGenerationWorkspace: React.FC<AssignmentGenerationWorkspaceProps> = ({
  courses,
  onNavigate,
  onBack,
}) => {
  const [courseId, setCourseId] = useState(courses[0]?.id || '');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Assessment['difficulty']>('Intermediate');
  const [questionCount, setQuestionCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const selectedCourse = courses.find((course) => course.id === courseId);
  const availableTopics = useMemo(
    () => selectedCourse?.topics?.map((topic) => topic.title).filter(Boolean) || [],
    [selectedCourse],
  );

  useEffect(() => {
    if (!courses.some((course) => course.id === courseId)) {
      setCourseId(courses[0]?.id || '');
      setSelectedTopics([]);
    }
  }, [courseId, courses]);

  const toggleTopic = (topic: string) => {
    setSelectedTopics((current) =>
      current.includes(topic) ? current.filter((value) => value !== topic) : [...current, topic],
    );
  };

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCourse) {
      setError('Choose a subject before generating an assignment.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const generated = await api.generatePracticeAssessment({
        courseId: selectedCourse.id,
        courseCode: selectedCourse.code,
        topics: selectedTopics,
        difficulty,
        learningObjectives: selectedCourse.description ? [selectedCourse.description] : [],
        questionCount,
      });
      setActiveAssessment({
        id: generated.assessmentId,
        courseId: generated.courseId,
        courseCode: generated.courseCode || selectedCourse.code,
        title: generated.title,
        topic: generated.topic,
        difficulty: generated.difficulty,
        questionCount: generated.questions.length,
        durationMinutes: generated.durationMinutes,
        passingScore: generated.passingScore,
        attemptsCount: 0,
        aiGenerated: true,
        official: false,
        questions: generated.questions.map((question) => ({
          id: question.id,
          questionText: question.question,
          options: question.options,
          explanation: '',
          topicTag: question.topic,
        })),
      });
      setResult(null);
    } catch (generationError) {
      setError(generationError instanceof Error
        ? generationError.message
        : 'The Assignment Generation Agent could not generate an assignment.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!courses.length) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#4338CA]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Assignments
        </button>
        <EmptyState
          icon={<BookOpen className="w-5 h-5" />}
          title="No enrolled subjects"
          description="An assigned subject is required before the Assignment Generation Agent can create practice work."
        />
      </div>
    );
  }

  if (activeAssessment && result) {
    return (
      <div>
        <button type="button" onClick={onBack} className="mx-auto mt-5 flex items-center gap-2 text-sm font-semibold text-[#4338CA]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Assignments
        </button>
        <QuizResultsView
          result={result}
          onRetake={() => {
            setActiveAssessment(null);
            setResult(null);
          }}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  if (activeAssessment) {
    return (
      <QuizRunner
        assessment={activeAssessment}
        onCancel={() => setActiveAssessment(null)}
        onComplete={setResult}
      />
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#4338CA]">
        <ArrowLeft size={16} aria-hidden="true" /> Back to Assignments
      </button>
      <header className="rounded-2xl bg-gradient-to-br from-indigo-700 to-violet-700 p-6 text-white md:p-8">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-indigo-100">ASSIGNMENTS</p>
            <h1 className="mt-1 text-xl font-bold">Create my own practice assignment</h1>
            <p className="mt-2 max-w-2xl text-sm text-indigo-100">
              Choose an enrolled subject and topics, then generate a personal practice assignment. Your answers are graded and saved by the backend.
            </p>
          </div>
        </div>
      </header>

      <form onSubmit={generate} className="space-y-5 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-xs md:p-7">
        <div>
          <label htmlFor="assignment-subject" className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
            Subject
          </label>
          <select
            id="assignment-subject"
            required
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setSelectedTopics([]);
            }}
            className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#4338CA]"
          >
            {courses.map((course) => (
              <option key={course.id} value={course.id}>{course.code} — {course.title}</option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-[#0F172A]">Topics (optional)</legend>
          {availableTopics.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {availableTopics.map((topic) => (
                <label key={topic} className="flex min-h-11 items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#334155]">
                  <input
                    type="checkbox"
                    checked={selectedTopics.includes(topic)}
                    onChange={() => toggleTopic(topic)}
                    className="h-4 w-4 accent-[#4338CA]"
                  />
                  {topic}
                </label>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-[#64748B]">
              No topic list is configured for this subject. Leave this empty to generate across the subject.
            </p>
          )}
          <p className="mt-2 text-[11px] text-[#64748B]">
            Leave all topics unchecked to let the agent cover the selected subject.
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="assignment-difficulty" className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
              Difficulty
            </label>
            <select
              id="assignment-difficulty"
              required
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as Assessment['difficulty'])}
              className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#4338CA]"
            >
              <option>Beginner</option>
              <option>Intermediate</option>
              <option>Advanced</option>
            </select>
          </div>
          <div>
            <label htmlFor="assignment-count" className="mb-1.5 block text-xs font-semibold text-[#0F172A]">
              Number of questions
            </label>
            <input
              id="assignment-count"
              required
              type="number"
              min={1}
              max={10}
              value={questionCount}
              onChange={(event) => setQuestionCount(Number(event.target.value))}
              className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#4338CA]"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4">
          <p className="max-w-xl text-[11px] text-[#64748B]">
            Only fully answered, backend-graded, published results are included in your Learning Agent history.
          </p>
          <Button type="submit" variant="primary" isLoading={isGenerating} disabled={isGenerating || !courseId}>
            Generate assignment <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </form>
    </div>
  );
};
